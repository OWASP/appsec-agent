/**
 * Normalized stream message types shared by all model providers.
 *
 * Author: Sam Li
 */

/** Message types yielded by providers; same shape as Claude SDK for compatibility. */
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
  structured_output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
};
/** Passthrough for SDK-only types (e.g. tool_progress) when using Anthropic. */
export type QueryMessage =
  | StreamEventMessage
  | AssistantMessage
  | ResultMessage
  | { type: string; [key: string]: unknown };
