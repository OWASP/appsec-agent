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
    stream: true
  });

  let fullText = '';
  for await (const chunk of stream) {
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

  yield {
    type: 'result',
    is_error: false,
    num_turns: 1
  } as ResultMessage;
}

/**
 * Run LLM query with optional failover to OpenAI when Anthropic fails.
 * Yields the same message types as the Claude SDK (stream_event, assistant, result).
 */
export async function* llmQuery(params: {
  prompt: string;
  options: Options;
}): AsyncGenerator<QueryMessage> {
  const { prompt, options } = params;
  const { failoverEnabled, openaiApiKey, openaiBaseUrl, openaiFallbackModel } =
    getFailoverConfig();

  try {
    for await (const msg of anthropicQuery({ prompt, options })) {
      yield msg as QueryMessage;
    }
    return;
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
