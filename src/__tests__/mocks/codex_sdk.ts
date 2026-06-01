/**
 * Jest stub for @openai/codex-sdk (ESM-only; CI stays mock-only).
 */

export const Codex = jest.fn();

export type CodexOptions = {
  codexPathOverride?: string;
  baseUrl?: string;
  apiKey?: string;
  config?: Record<string, unknown>;
  env?: Record<string, string>;
};

export type Input = string | Array<{ type: string; text?: string; path?: string }>;

export type ThreadOptions = Record<string, unknown>;
export type TurnOptions = { outputSchema?: unknown; signal?: AbortSignal };

export type ThreadEvent =
  | { type: 'item.updated'; item: { id: string; type: string; text?: string } }
  | { type: 'item.completed'; item: { id: string; type: string; text?: string } }
  | {
      type: 'turn.completed';
      usage: {
        input_tokens: number;
        output_tokens: number;
        cached_input_tokens: number;
        reasoning_output_tokens: number;
      };
    }
  | { type: 'turn.failed'; error: { message: string } }
  | { type: 'error'; message: string };
