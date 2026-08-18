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
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface MockChatChoice {
  message?: MockChatMessage;
  delta?: MockChatDelta;
  finish_reason?: string | null;
  // Kimi-native per-choice usage layout (e.g. kimi-k3).
  usage?: MockChatUsage;
}

export interface MockChatCompletion {
  choices: MockChatChoice[];
  usage?: MockChatUsage;
}

export type MockChatChunk = MockChatCompletion;

type ChatResponse = MockChatCompletion | MockChatChunk[];

let scriptedChatResponses: ChatResponse[] = [];
let chatResponseCursor = 0;
let modelList: string[] = ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code-highspeed'];
const createCalls: Array<Record<string, unknown>> = [];

export function __setChatResponses(responses: ChatResponse[]): void {
  scriptedChatResponses = responses;
  chatResponseCursor = 0;
}

export function __setModelList(models: string[]): void {
  modelList = models;
}

export function __getCreateCalls(): Array<Record<string, unknown>> {
  return createCalls;
}

export function __reset(): void {
  scriptedChatResponses = [];
  chatResponseCursor = 0;
  modelList = ['kimi-k2.6', 'kimi-k3', 'kimi-k2.7-code-highspeed'];
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
    list: async (): Promise<{ data: Array<{ id: string }> }> => ({
      data: modelList.map((id) => ({ id })),
    }),
  };
}
