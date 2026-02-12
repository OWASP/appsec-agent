/**
 * LLM query adapter with optional failover from Anthropic to OpenAI.
 * Reads failover config from environment variables (no hard-coding).
 *
 * Author: Sam Li
 */

import { query as anthropicQuery, Options } from '@anthropic-ai/claude-agent-sdk';
import OpenAI from 'openai';

/** Message types yielded by the adapter; same shape as Claude SDK for compatibility. */
export type StreamEventMessage = {
  type: 'stream_event';
  event: { type: string; delta?: { type: string; text?: string } };
};
export type AssistantMessage = {
  type: 'assistant';
  message: { content: Array<{ type: 'text'; text: string }> };
};
export type ResultMessage = {
  type: 'result';
  is_error: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  subtype?: string;
  errors?: unknown[];
  error_message?: string;
};
/** Passthrough for SDK-only types (e.g. tool_progress) when using Anthropic. */
export type QueryMessage =
  | StreamEventMessage
  | AssistantMessage
  | ResultMessage
  | { type: string; [key: string]: unknown };

function getFailoverConfig(): {
  failoverEnabled: boolean;
  openaiApiKey: string | undefined;
  openaiBaseUrl: string | undefined;
  openaiFallbackModel: string;
} {
  const failoverEnabled =
    (process.env.FAILOVER_ENABLED ?? '')
      .toLowerCase()
      .trim() === 'true';
  const openaiApiKey = process.env.OPENAI_API_KEY?.trim() || undefined;
  const openaiBaseUrl = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const openaiFallbackModel =
    process.env.OPENAI_FALLBACK_MODEL?.trim() || 'gpt-4o';
  return { failoverEnabled, openaiApiKey, openaiBaseUrl, openaiFallbackModel };
}

function getSystemPromptFromOptions(options: Options): string {
  if (options.systemPrompt && typeof options.systemPrompt === 'string') {
    return options.systemPrompt;
  }
  if (options.agents && typeof options.agents === 'object') {
    const keys = Object.keys(options.agents);
    if (keys.length > 0) {
      const first = options.agents[keys[0]];
      if (first && typeof (first as { prompt?: string }).prompt === 'string') {
        return (first as { prompt: string }).prompt;
      }
    }
  }
  return 'You are a helpful assistant.';
}

/** Approximate USD per 1M tokens (input, output) for common OpenAI models. Used for fallback cost display. */
const OPENAI_COST_PER_1M: Record<string, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o-nano': { input: 0.1, output: 0.4 },
  'gpt-4-turbo': { input: 10, output: 30 },
  'gpt-3.5-turbo': { input: 0.5, output: 1.5 }
};

function estimateOpenAICostUsd(
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  const rates =
    OPENAI_COST_PER_1M[model] ??
    (model.includes('mini') ? OPENAI_COST_PER_1M['gpt-4o-mini'] : null) ??
    (model.includes('nano') ? OPENAI_COST_PER_1M['gpt-4o-nano'] : null) ??
    OPENAI_COST_PER_1M['gpt-4o'];
  const inputCost = (promptTokens / 1_000_000) * rates.input;
  const outputCost = (completionTokens / 1_000_000) * rates.output;
  return inputCost + outputCost;
}

async function* openaiFallbackStream(
  prompt: string,
  systemPrompt: string,
  model: string,
  openaiApiKey: string,
  openaiBaseUrl?: string
): AsyncGenerator<QueryMessage> {
  const clientConfig: { apiKey: string; baseURL?: string } = {
    apiKey: openaiApiKey
  };
  if (openaiBaseUrl) {
    clientConfig.baseURL = openaiBaseUrl;
  }
  const openai = new OpenAI(clientConfig);

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt }
  ];

  const stream = await openai.chat.completions.create({
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true }
  });

  let fullText = '';
  let promptTokens = 0;
  let completionTokens = 0;
  for await (const chunk of stream) {
    if (chunk.usage) {
      promptTokens = chunk.usage.prompt_tokens ?? 0;
      completionTokens = chunk.usage.completion_tokens ?? 0;
    }
    const delta = chunk.choices[0]?.delta?.content;
    if (typeof delta === 'string' && delta) {
      fullText += delta;
      yield {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: delta }
        }
      } as StreamEventMessage;
    }
  }

  yield {
    type: 'assistant',
    message: { content: [{ type: 'text', text: fullText }] }
  } as AssistantMessage;

  const totalCostUsd =
    promptTokens + completionTokens > 0
      ? estimateOpenAICostUsd(model, promptTokens, completionTokens)
      : undefined;

  yield {
    type: 'result',
    is_error: false,
    num_turns: 1,
    ...(totalCostUsd !== undefined && { total_cost_usd: totalCostUsd })
  } as ResultMessage;
}

/**
 * Run LLM query with optional failover to OpenAI when Anthropic fails.
 * Yields the same message types as the Claude SDK (stream_event, assistant, result).
 * Treats a primary result with is_error: true as failure and runs fallback when enabled
 * (so the caller does not see the primary error message before the fallback response).
 */
export async function* llmQuery(params: {
  prompt: string;
  options: Options;
}): AsyncGenerator<QueryMessage> {
  const { prompt, options } = params;
  const { failoverEnabled, openaiApiKey, openaiBaseUrl, openaiFallbackModel } =
    getFailoverConfig();

  let primaryErrorResult: QueryMessage | null = null;

  try {
    for await (const msg of anthropicQuery({ prompt, options })) {
      if (msg.type === 'result' && (msg as ResultMessage).is_error) {
        primaryErrorResult = msg as QueryMessage;
        break;
      }
      yield msg as QueryMessage;
    }
    if (primaryErrorResult === null) return;
    if (failoverEnabled && openaiApiKey) {
      const systemPrompt = getSystemPromptFromOptions(options);
      yield* openaiFallbackStream(
        prompt,
        systemPrompt,
        openaiFallbackModel,
        openaiApiKey,
        openaiBaseUrl
      );
      return;
    }
    yield primaryErrorResult;
  } catch (primaryError) {
    if (!failoverEnabled || !openaiApiKey) {
      throw primaryError;
    }
    const systemPrompt = getSystemPromptFromOptions(options);
    yield* openaiFallbackStream(
      prompt,
      systemPrompt,
      openaiFallbackModel,
      openaiApiKey,
      openaiBaseUrl
    );
  }
}
