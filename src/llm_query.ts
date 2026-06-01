/**
 * LLM query entry point (delegates to Claude SDK for legacy callers/tests).
 *
 * Author: Sam Li
 */

import { query as anthropicQuery, Options } from '@anthropic-ai/claude-agent-sdk';

export type {
  StreamEventMessage,
  AssistantMessage,
  ResultMessage,
  QueryMessage,
} from './providers/query_message';

/** @deprecated Prefer resolveProvider().run({ prompt, roleSpec }). */
export async function* llmQuery(params: {
  prompt: string;
  options: Options;
}): AsyncGenerator<import('./providers/query_message').QueryMessage> {
  for await (const msg of anthropicQuery(params)) {
    yield msg as import('./providers/query_message').QueryMessage;
  }
}
