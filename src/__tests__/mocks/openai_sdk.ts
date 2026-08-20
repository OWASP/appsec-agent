/**
 * Jest stub for the `openai` package so provider tests never hit the network.
 *
 * Tests set `__setChatResponses` / `__setModelList` to script behavior, then
 * assert against `__getCreateCalls()` to inspect what the provider sent.
 */

export interface MockChatMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

/** Streaming deltas arrive fragmented, so tool_calls carry partial fields + index. */
export interface MockChatDelta {
  role?: string;
  content?: string | null;
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

export interface MockChatUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_tokens?: number;
  /** DeepInfra's exact per-request cost, preferred over token-rate estimates. */
  estimated_cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number | null };
}

export interface MockChatChoice {
  message?: MockChatMessage;
  delta?: MockChatDelta;
  finish_reason?: string | null;
  // Some OpenAI-compatible backends nest usage per-choice on the final chunk
  // instead of at the top level.
  usage?: MockChatUsage;
}

export interface MockChatCompletion {
  choices: MockChatChoice[];
  usage?: MockChatUsage;
}

export type MockChatChunk = MockChatCompletion;

type ChatResponse = MockChatCompletion | MockChatChunk[];

export interface MockModelPricing {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
}

export interface MockModelEntry {
  id: string;
  tags?: string[];
  pricing?: MockModelPricing;
  /** Total context window (input + output); DeepInfra reports it as max_tokens. */
  contextLength?: number;
}

const DEFAULT_MODEL_ENTRIES: MockModelEntry[] = [
  {
    id: 'moonshotai/Kimi-K2.6',
    tags: ['chat', 'reasoning'],
    pricing: { input_tokens: 0.75, output_tokens: 3.5, cache_read_tokens: 0.15 },
  },
  {
    id: 'moonshotai/Kimi-K3',
    tags: ['chat'],
    pricing: { input_tokens: 2.85, output_tokens: 14.25, cache_read_tokens: 0.285 },
  },
  {
    id: 'moonshotai/Kimi-K2.7-Code',
    tags: ['chat', 'reasoning'],
    pricing: { input_tokens: 0.68, output_tokens: 3.4, cache_read_tokens: 0.136 },
  },
  // A non-chat model, so tests can verify it is excluded from the allowlist.
  { id: 'black-forest-labs/FLUX-1-dev', tags: ['image-gen'] },
];

let scriptedChatResponses: ChatResponse[] = [];
let chatResponseCursor = 0;
let modelEntries: MockModelEntry[] = DEFAULT_MODEL_ENTRIES;
const createCalls: Array<Record<string, unknown>> = [];

export function __setChatResponses(responses: ChatResponse[]): void {
  scriptedChatResponses = responses;
  chatResponseCursor = 0;
}

/** Accepts bare ids (defaulted to a chat-tagged, unpriced entry) or full entries. */
export function __setModelList(models: Array<string | MockModelEntry>): void {
  modelEntries = models.map((m) => (typeof m === 'string' ? { id: m, tags: ['chat'] } : m));
}

export function __getCreateCalls(): Array<Record<string, unknown>> {
  return createCalls;
}

export function __reset(): void {
  scriptedChatResponses = [];
  chatResponseCursor = 0;
  modelEntries = DEFAULT_MODEL_ENTRIES;
  createCalls.length = 0;
}

function nextChatResponse(): ChatResponse {
  const response = scriptedChatResponses[chatResponseCursor];
  if (chatResponseCursor < scriptedChatResponses.length - 1) {
    chatResponseCursor += 1;
  }
  return response;
}

export class APIError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'APIError';
    this.status = status;
  }
}

export default class OpenAI {
  apiKey?: string;
  baseURL?: string;

  constructor(opts: { apiKey?: string; baseURL?: string; timeout?: number; maxRetries?: number } = {}) {
    this.apiKey = opts.apiKey;
    this.baseURL = opts.baseURL;
  }

  chat = {
    completions: {
      create: async (params: Record<string, unknown>): Promise<unknown> => {
        createCalls.push(params);
        const response = nextChatResponse();
        if (params.stream) {
          const chunks = Array.isArray(response) ? response : [response];
          return (async function* () {
            for (const chunk of chunks) {
              yield chunk;
            }
          })();
        }
        return Array.isArray(response) ? response[response.length - 1] : response;
      },
    },
  };

  models = {
    list: async (): Promise<{
      data: Array<{
        id: string;
        metadata: { tags?: string[]; pricing?: MockModelPricing; max_tokens?: number; context_length?: number };
      }>;
    }> => ({
      data: modelEntries.map((m) => ({
        id: m.id,
        metadata: {
          tags: m.tags,
          pricing: m.pricing,
          ...(m.contextLength !== undefined
            ? { max_tokens: m.contextLength, context_length: m.contextLength }
            : {}),
        },
      })),
    }),
  };
}
