/**
 * DeepInfra provider: an OpenAI-compatible chat-completions client driven as
 * an agent loop (local Read/Grep/Write/Bash tools + optional MCP bridge),
 * normalizing everything to the shared `QueryMessage` shape.
 *
 * DeepInfra (https://deepinfra.com) is a HIPAA- and SOC 2-certified inference
 * cloud hosting open-weight models (Kimi, DeepSeek, GLM, Qwen, gpt-oss, ...).
 *
 * Author: Sam Li
 */

import OpenAI from 'openai';
import { ModelProvider } from './types';
import type { QueryMessage, ResultMessage } from './query_message';
import type { RoleSpec } from './role_spec';
import {
  DEFAULT_DEEPINFRA_MODEL,
  estimateCostFromPricing,
  listDeepInfraModels,
  resolveDeepInfraMaxOutputTokens,
  resolveDeepInfraModel,
} from './deepinfra_model';
import {
  buildDeepInfraMessages,
  resolveDeepInfraToolNames,
  roleSpecToDeepInfraClientOptions,
  type DeepInfraChatMessage,
  type ReasoningEffort,
} from './deepinfra_role_spec';
import { buildLocalTools, type OpenAiToolDefinition } from './deepinfra_tools';
import { connectMcpBridge, type McpBridge } from './deepinfra_mcp_bridge';
import { parseAndValidateStructuredOutput } from './structured_output';

type DeepInfraClientFactory = () => { client: OpenAI; reasoningEffort: ReasoningEffort };
type McpBridgeFactory = (mcp: NonNullable<RoleSpec['mcp']>) => Promise<McpBridge>;

function defaultDeepInfraClientFactory(): { client: OpenAI; reasoningEffort: ReasoningEffort } {
  const opts = roleSpecToDeepInfraClientOptions();
  const client = new OpenAI({
    apiKey: opts.apiKey,
    baseURL: opts.baseURL,
    timeout: opts.timeout,
    maxRetries: opts.maxRetries,
  });
  return { client, reasoningEffort: opts.reasoningEffort };
}

interface AccumulatedToolCall {
  id: string;
  name: string;
  arguments: string;
}

interface DeepInfraUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  estimated_cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number | null };
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
    // Some OpenAI-compatible backends nest usage per-choice on the final
    // chunk instead of at the top level; consumeStream checks both.
    usage?: DeepInfraUsage;
  }>;
  usage?: DeepInfraUsage;
}

interface TurnResult {
  text: string;
  toolCalls: AccumulatedToolCall[];
  finishReason: string | null;
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
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

export class DeepInfraProvider extends ModelProvider {
  readonly provider = 'deepinfra' as const;

  constructor(
    private readonly clientFactory: DeepInfraClientFactory = defaultDeepInfraClientFactory,
    private readonly mcpBridgeFactory: McpBridgeFactory = connectMcpBridge,
  ) {
    super();
  }

  async *run(params: { prompt: string; roleSpec: RoleSpec }): AsyncGenerator<QueryMessage> {
    const { prompt, roleSpec } = params;
    let bridge: McpBridge | null = null;

    try {
      const { client, reasoningEffort } = this.clientFactory();
      const model = await this.resolveModel(client, roleSpec.model);
      const maxOutputTokens = await this.resolveMaxOutputTokens(client, model);

      const toolNames = resolveDeepInfraToolNames(roleSpec);
      const { definitions: localDefs, handlers } = buildLocalTools(
        toolNames,
        roleSpec.workingDirectory ?? process.cwd(),
      );

      let toolDefs: OpenAiToolDefinition[] = [...localDefs];
      if (roleSpec.mcp) {
        bridge = await this.mcpBridgeFactory(roleSpec.mcp);
        toolDefs = [...toolDefs, ...bridge.tools];
      }

      const messages = buildDeepInfraMessages(roleSpec, prompt) as DeepInfraChatMessage[];
      const maxTurns = Math.max(1, roleSpec.maxTurns || 1);

      let assistantText = '';
      let turnsUsed = 0;
      let hitMaxTurns = false;
      let lastFinishReason: string | null = null;
      const usageTotals: UsageTotals = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, costUsd: 0 };

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
          reasoning_effort: reasoningEffort as never,
          max_tokens: maxOutputTokens,
          ...(forceJsonMode ? { response_format: { type: 'json_object' } } : {}),
        })) as AsyncIterable<StreamChunk>;

        const turnResult = yield* this.consumeStream(stream, usageTotals);
        lastFinishReason = turnResult.finishReason;

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
        } as unknown as DeepInfraChatMessage);

        for (const tc of turnResult.toolCalls) {
          yield { type: 'tool_progress', tool_name: tc.name } as unknown as QueryMessage;
          const output = await this.executeTool(tc, handlers, bridge);
          messages.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: output,
          } as unknown as DeepInfraChatMessage);
        }

        if (turn === maxTurns - 1) {
          hitMaxTurns = true;
        }
      }

      if (usageTotals.costUsd === 0 && (usageTotals.input > 0 || usageTotals.output > 0)) {
        usageTotals.costUsd = await this.estimateFallbackCostUsd(client, model, {
          input_tokens: usageTotals.input,
          output_tokens: usageTotals.output,
        });
      }

      yield this.buildResult({
        assistantText,
        outputSchema: roleSpec.outputSchema,
        usageTotals,
        turnsUsed,
        hitMaxTurns,
        finishReason: lastFinishReason,
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
    const resolved = resolveDeepInfraModel(requested);
    try {
      const info = await listDeepInfraModels(
        client as unknown as Parameters<typeof listDeepInfraModels>[0],
      );
      if (info.ids.length === 0) {
        return resolved;
      }
      const byLower = new Map(info.ids.map((id) => [id.toLowerCase(), id] as const));
      const match = byLower.get(resolved.toLowerCase());
      if (match) {
        return match;
      }
      console.warn(
        `⚠️  Model "${resolved}" not found in DeepInfra's chat models; ` +
          `falling back to "${DEFAULT_DEEPINFRA_MODEL}".`,
      );
      return byLower.get(DEFAULT_DEEPINFRA_MODEL.toLowerCase()) ?? info.ids[0];
    } catch {
      // Fail-open: never block a run on model-list detection.
      return resolved;
    }
  }

  /**
   * Resolve the completion-token budget (`max_tokens`) to send for `model`.
   * Uses the model's context window (from the cached `/v1/models` metadata) to
   * clamp a generous default so large structured reports are not clipped at
   * DeepInfra's conservative implicit limit, while never over-requesting.
   * Fails open to the flat default when model-list detection is unavailable.
   */
  private async resolveMaxOutputTokens(client: OpenAI, model: string): Promise<number> {
    try {
      const info = await listDeepInfraModels(
        client as unknown as Parameters<typeof listDeepInfraModels>[0],
      );
      return resolveDeepInfraMaxOutputTokens(info.contextLengthById.get(model));
    } catch {
      return resolveDeepInfraMaxOutputTokens();
    }
  }

  private async estimateFallbackCostUsd(
    client: OpenAI,
    model: string,
    usage: { input_tokens: number; output_tokens: number },
  ): Promise<number> {
    try {
      const info = await listDeepInfraModels(
        client as unknown as Parameters<typeof listDeepInfraModels>[0],
      );
      return estimateCostFromPricing(info.pricingById.get(model), usage);
    } catch {
      return 0;
    }
  }

  private async *consumeStream(
    stream: AsyncIterable<StreamChunk>,
    usageTotals: UsageTotals,
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
      // Usage arrives on a final chunk; some backends nest it per-choice
      // instead of at the top level (top-level usage null in that case), so
      // check both.
      const usage = chunk.usage ?? choice?.usage;
      if (usage) {
        usageTotals.input += usage.prompt_tokens ?? 0;
        usageTotals.output += usage.completion_tokens ?? 0;
        usageTotals.cacheRead +=
          usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0;
        usageTotals.cacheCreation += usage.prompt_tokens_details?.cache_write_tokens ?? 0;
        // DeepInfra reports exact per-request cost; prefer it over the
        // token-rate estimate computed after the loop.
        usageTotals.costUsd += usage.estimated_cost ?? 0;
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
    assistantText: string;
    outputSchema?: Record<string, unknown>;
    usageTotals: UsageTotals;
    turnsUsed: number;
    hitMaxTurns: boolean;
    finishReason: string | null;
  }): ResultMessage {
    const { assistantText, outputSchema, usageTotals, turnsUsed, hitMaxTurns, finishReason } = input;

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
      if (usageTotals.cacheCreation > 0) {
        result.usage.cache_creation_input_tokens = usageTotals.cacheCreation;
      }
      if (usageTotals.costUsd > 0) {
        result.total_cost_usd = usageTotals.costUsd;
      }
    }

    if (hitMaxTurns) {
      result.is_error = true;
      result.subtype = 'error_max_turns';
      result.error_message = `Reached max turns (${turnsUsed}) before completing.`;
      return result;
    }

    if (finishReason === 'length') {
      result.is_error = true;
      result.error_message =
        `Model response was truncated (finish_reason: "length") after ${turnsUsed} turn(s). ` +
        'The output may be incomplete; consider raising max output tokens or simplifying the request.';
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

export const defaultDeepInfraProvider = new DeepInfraProvider();
