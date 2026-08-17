/**
 * Moonshot (Kimi) provider: an OpenAI-compatible chat-completions client driven
 * as an agent loop (local Read/Grep/Write/Bash tools + optional MCP bridge),
 * normalizing everything to the shared `QueryMessage` shape.
 *
 * Author: Sam Li
 */

import OpenAI from 'openai';
import { ModelProvider } from './types';
import type { QueryMessage, ResultMessage } from './query_message';
import type { RoleSpec } from './role_spec';
import {
  DEFAULT_MOONSHOT_MODEL,
  estimateMoonshotCostUsd,
  listMoonshotModels,
  resolveMoonshotModel,
} from './moonshot_model';
import {
  buildMoonshotMessages,
  resolveMoonshotToolNames,
  roleSpecToMoonshotClientOptions,
  type MoonshotChatMessage,
} from './moonshot_role_spec';
import { buildLocalTools, type OpenAiToolDefinition } from './moonshot_tools';
import { connectMcpBridge, type McpBridge } from './moonshot_mcp_bridge';
import { parseAndValidateStructuredOutput } from './structured_output';

type MoonshotClientFactory = () => OpenAI;
type McpBridgeFactory = (mcp: NonNullable<RoleSpec['mcp']>) => Promise<McpBridge>;

function defaultMoonshotClientFactory(): OpenAI {
  const opts = roleSpecToMoonshotClientOptions();
  return new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: opts.timeout,
    maxRetries: opts.maxRetries,
  });
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface StreamChunk {
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

interface TurnResult {
  text: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
}

function parseToolArguments(raw: string): Record<string, unknown> {
  if (!raw || raw.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export class MoonshotProvider extends ModelProvider {
  readonly provider = 'moonshot' as const;

  constructor(
    private readonly clientFactory: MoonshotClientFactory = defaultMoonshotClientFactory,
    private readonly mcpBridgeFactory: McpBridgeFactory = connectMcpBridge,
  ) {
    super();
  }

  async *run(params: { prompt: string; roleSpec: RoleSpec }): AsyncGenerator<QueryMessage> {
    const { prompt, roleSpec } = params;
    let bridge: McpBridge | null = null;

    try {
      const client = this.clientFactory();
      const model = await this.resolveModel(client, roleSpec.model);

      const toolNames = resolveMoonshotToolNames(roleSpec);
      const { definitions: localDefs, handlers } = buildLocalTools(
        toolNames,
        roleSpec.workingDirectory ?? process.cwd(),
      );

      let toolDefs: OpenAiToolDefinition[] = [...localDefs];
      if (roleSpec.mcp) {
        bridge = await this.mcpBridgeFactory(roleSpec.mcp);
        toolDefs = [...toolDefs, ...bridge.tools];
      }

      const messages = buildMoonshotMessages(roleSpec, prompt) as MoonshotChatMessage[];
      const maxTurns = Math.max(1, roleSpec.maxTurns || 1);

      let assistantText = '';
      let turnsUsed = 0;
      let hitMaxTurns = false;
      const usageTotals = { input: 0, output: 0, cacheRead: 0 };

      for (let turn = 0; turn < maxTurns; turn++) {
        turnsUsed = turn + 1;

        // Only force JSON mode for tool-less structured roles. When tools are
        // present, json_object makes the model emit JSON immediately instead of
        // exploring first, so we rely on the system-prompt JSON instruction plus
        // post-run validation (the same net the Codex path uses).
        const forceJsonMode = roleSpec.outputSchema && toolDefs.length === 0;

        const stream = (await client.chat.completions.create({
          model,
          messages: messages as never,
          tools: toolDefs.length > 0 ? (toolDefs as never) : undefined,
          tool_choice: toolDefs.length > 0 ? 'auto' : undefined,
          stream: true,
          stream_options: { include_usage: true },
          ...(forceJsonMode ? { response_format: { type: 'json_object' } } : {}),
        })) as AsyncIterable<StreamChunk>;

        const turnResult = yield* this.consumeStream(stream, usageTotals);

        if (turnResult.toolCalls.length === 0) {
          assistantText = turnResult.text;
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: turnResult.text }] },
          } as QueryMessage;
          hitMaxTurns = false;
          break;
        }

        // Append the assistant tool-call message verbatim, then answer each call
        // with its own tool message keyed by tool_call_id.
        messages.push({
          role: 'assistant',
          content: turnResult.text,
          tool_calls: turnResult.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: tc.arguments },
          })),
        } as unknown as MoonshotChatMessage);

        for (const tc of turnResult.toolCalls) {
          yield { type: 'tool_progress', tool_name: tc.name } as unknown as QueryMessage;
          const output = await this.executeTool(tc, handlers, bridge);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: output,
          } as unknown as MoonshotChatMessage);
        }

        if (turn === maxTurns - 1) {
          hitMaxTurns = true;
        }
      }

      yield this.buildResult({
        model,
        assistantText,
        outputSchema: roleSpec.outputSchema,
        usageTotals,
        turnsUsed,
        hitMaxTurns,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: 'result',
        is_error: true,
        error_message: message,
      } as ResultMessage;
    } finally {
      if (bridge) {
        try {
          await bridge.close();
        } catch {
          // best-effort transport cleanup
        }
      }
    }
  }

  private async resolveModel(client: OpenAI, requested?: string): Promise<string> {
    const resolved = resolveMoonshotModel(requested);
    try {
      const available = await listMoonshotModels(
        client as unknown as { models: { list(): Promise<{ data: Array<{ id: string }> }> } },
      );
      if (available.length > 0 && !available.includes(resolved)) {
        console.warn(
          `⚠️  Model "${resolved}" not found in Moonshot's available models; ` +
            `falling back to "${DEFAULT_MOONSHOT_MODEL}".`,
        );
        return available.includes(DEFAULT_MOONSHOT_MODEL) ? DEFAULT_MOONSHOT_MODEL : available[0];
      }
    } catch {
      // Fail-open: never block a run on model-list detection.
    }
    return resolved;
  }

  private async *consumeStream(
    stream: AsyncIterable<StreamChunk>,
    usageTotals: { input: number; output: number; cacheRead: number },
  ): AsyncGenerator<QueryMessage, TurnResult> {
    let text = '';
    let finishReason: string | null = null;
    const toolCallsByIndex = new Map<number, AccumulatedToolCall>();

    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (choice?.delta?.content) {
        text += choice.delta.content;
        yield {
          type: 'stream_event',
          event: {
            type: 'content_block_delta',
            delta: { type: 'text_delta', text: choice.delta.content },
          },
        } as QueryMessage;
      }
      if (choice?.delta?.tool_calls) {
        for (const delta of choice.delta.tool_calls) {
          const existing = toolCallsByIndex.get(delta.index) ?? { id: '', name: '', arguments: '' };
          if (delta.id) existing.id = delta.id;
          if (delta.function?.name) existing.name += delta.function.name;
          if (delta.function?.arguments) existing.arguments += delta.function.arguments;
          toolCallsByIndex.set(delta.index, existing);
        }
      }
      if (choice?.finish_reason) {
        finishReason = choice.finish_reason;
      }
      if (chunk.usage) {
        usageTotals.input += chunk.usage.prompt_tokens ?? 0;
        usageTotals.output += chunk.usage.completion_tokens ?? 0;
        usageTotals.cacheRead += chunk.usage.prompt_tokens_details?.cached_tokens ?? 0;
      }
    }

    const toolCalls = [...toolCallsByIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, tc]) => tc)
      .filter((tc) => tc.id && tc.name);

    return { text, toolCalls, finishReason };
  }

  private async executeTool(
    tc: AccumulatedToolCall,
    handlers: Map<string, (args: Record<string, unknown>) => Promise<unknown>>,
    bridge: McpBridge | null,
  ): Promise<string> {
    const args = parseToolArguments(tc.arguments);
    try {
      if (tc.name.startsWith('mcp__')) {
        if (!bridge) {
          return JSON.stringify({ error: `MCP tool "${tc.name}" requested but no MCP server is configured.` });
        }
        return await bridge.call(tc.name, args);
      }
      const handler = handlers.get(tc.name);
      if (!handler) {
        return JSON.stringify({ error: `Unknown tool: ${tc.name}` });
      }
      const result = await handler(args);
      return typeof result === 'string' ? result : JSON.stringify(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return JSON.stringify({ error: message });
    }
  }

  private buildResult(input: {
    model: string;
    assistantText: string;
    outputSchema?: Record<string, unknown>;
    usageTotals: { input: number; output: number; cacheRead: number };
    turnsUsed: number;
    hitMaxTurns: boolean;
  }): ResultMessage {
    const { model, assistantText, outputSchema, usageTotals, turnsUsed, hitMaxTurns } = input;

    const result: ResultMessage = {
      type: 'result',
      is_error: false,
      num_turns: turnsUsed,
    };

    if (usageTotals.input > 0 || usageTotals.output > 0) {
      result.usage = {
        input_tokens: usageTotals.input,
        output_tokens: usageTotals.output,
      };
      if (usageTotals.cacheRead > 0) {
        result.usage.cache_read_input_tokens = usageTotals.cacheRead;
      }
      const cost = estimateMoonshotCostUsd(model, {
        input_tokens: usageTotals.input,
        output_tokens: usageTotals.output,
      });
      if (cost > 0) {
        result.total_cost_usd = cost;
      }
    }

    if (hitMaxTurns) {
      result.is_error = true;
      result.subtype = 'error_max_turns';
      result.error_message = `Reached max turns (${turnsUsed}) before completing.`;
      return result;
    }

    if (outputSchema) {
      const validation = parseAndValidateStructuredOutput(assistantText, outputSchema);
      if (validation.ok) {
        result.structured_output = validation.value;
      } else {
        result.is_error = true;
        result.errors = validation.errors;
        result.error_message = validation.errors.join('; ');
      }
    }

    return result;
  }
}

export const defaultMoonshotProvider = new MoonshotProvider();
