/**
 * Tests for LLM query adapter (failover from Anthropic to OpenAI).
 */

import { llmQuery } from '../llm_query';

const mockQuery = jest.fn();
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: unknown) => mockQuery(params)
}));

const mockCreate = jest.fn();
jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate
      }
    }
  }))
}));

describe('llmQuery', () => {
  const defaultOptions = { systemPrompt: 'You are a helpful assistant.', maxTurns: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.FAILOVER_ENABLED;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_BASE_URL;
    delete process.env.OPENAI_FALLBACK_MODEL;
  });

  describe('primary path (Anthropic)', () => {
    it('yields messages from Anthropic and does not call OpenAI when primary succeeds', async () => {
      const messages = [
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } },
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
        { type: 'result', is_error: false, num_turns: 1 }
      ];
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const m of messages) yield m;
        }
      });

      const out: unknown[] = [];
      for await (const msg of llmQuery({ prompt: 'Hello', options: defaultOptions })) {
        out.push(msg);
      }

      expect(mockQuery).toHaveBeenCalledWith({ prompt: 'Hello', options: defaultOptions });
      expect(mockCreate).not.toHaveBeenCalled();
      expect(out).toHaveLength(3);
      expect(out[0]).toMatchObject({ type: 'stream_event' });
      expect(out[1]).toMatchObject({ type: 'assistant' });
      expect(out[2]).toMatchObject({ type: 'result', is_error: false });
    });

    it('rethrows when Anthropic fails and failover is disabled', async () => {
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Anthropic 503');
        }
      });
      const gen = llmQuery({ prompt: 'Hi', options: defaultOptions });
      const result = await gen.next().catch((e: Error) => e);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Anthropic 503');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('rethrows when Anthropic fails and OPENAI_API_KEY is not set', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Anthropic 503');
        }
      });
      const gen = llmQuery({ prompt: 'Hi', options: defaultOptions });
      const result = await gen.next().catch((e: Error) => e);
      expect(result).toBeInstanceOf(Error);
      expect((result as Error).message).toBe('Anthropic 503');
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it('when primary yields result with is_error true and failover enabled, runs fallback and does not yield the error result', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '' } } };
          yield { type: 'assistant', message: { content: [] } };
          yield { type: 'result', is_error: true, subtype: 'success' };
        }
      });
      async function* mockOpenAIStream() {
        yield { choices: [{ delta: { content: 'Fallback answer' } }] };
      }
      mockCreate.mockResolvedValue(mockOpenAIStream());

      const out: unknown[] = [];
      for await (const msg of llmQuery({ prompt: 'Hi', options: defaultOptions })) {
        out.push(msg);
      }

      expect(mockCreate).toHaveBeenCalled();
      const resultMessages = out.filter((m: any) => m.type === 'result');
      expect(resultMessages).toHaveLength(1);
      expect(resultMessages[0]).toMatchObject({ type: 'result', is_error: false });
      expect(out.some((m: any) => m.type === 'assistant' && m.message?.content?.[0]?.text === 'Fallback answer')).toBe(true);
    });
  });

  describe('fallback path (OpenAI)', () => {
    it('calls OpenAI and yields normalized stream_event, assistant, result when failover enabled', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('Anthropic 503');
        }
      });

      async function* mockOpenAIStream() {
        yield { choices: [{ delta: { content: 'Hello' } }] };
        yield { choices: [{ delta: { content: ' world' } }] };
      }
      mockCreate.mockResolvedValue(mockOpenAIStream());

      const out: unknown[] = [];
      for await (const msg of llmQuery({ prompt: 'Hi', options: defaultOptions })) {
        out.push(msg);
      }

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4o',
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hi' }
          ],
          stream: true
        })
      );
      expect(out).toHaveLength(4); // 2 stream_events + 1 assistant + 1 result
      expect(out[0]).toMatchObject({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } } });
      expect(out[1]).toMatchObject({ type: 'stream_event', event: { delta: { text: ' world' } } });
      expect(out[2]).toMatchObject({ type: 'assistant', message: { content: [{ type: 'text', text: 'Hello world' }] } });
      expect(out[3]).toMatchObject({ type: 'result', is_error: false });
    });

    it('uses OPENAI_FALLBACK_MODEL from env when set', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.OPENAI_FALLBACK_MODEL = 'gpt-4o-mini';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('fail');
        }
      });

      async function* emptyStream() {}
      mockCreate.mockResolvedValue(emptyStream());

      for await (const _ of llmQuery({ prompt: 'Hi', options: defaultOptions })) {}

      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o-mini' }));
    });

    it('derives system prompt from options.agents when no options.systemPrompt', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('fail');
        }
      });

      async function* emptyStream() {}
      mockCreate.mockResolvedValue(emptyStream());

      const optionsWithAgents = {
        agents: {
          'code-reviewer': {
            description: 'Reviews code',
            prompt: 'You are a code reviewer.',
            tools: ['Read'],
            model: 'sonnet' as const
          }
        },
        permissionMode: 'bypassPermissions' as const
      };

      for await (const _ of llmQuery({ prompt: 'Review this', options: optionsWithAgents as import('@anthropic-ai/claude-agent-sdk').Options })) {}

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are a code reviewer.' },
            { role: 'user', content: 'Review this' }
          ]
        })
      );
    });

    it('uses default system prompt when options have no systemPrompt and no valid agents', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('fail');
        }
      });

      async function* emptyStream() {}
      mockCreate.mockResolvedValue(emptyStream());

      const emptyOptions = {} as import('@anthropic-ai/claude-agent-sdk').Options;
      for await (const _ of llmQuery({ prompt: 'Hi', options: emptyOptions })) {}

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are a helpful assistant.' },
            { role: 'user', content: 'Hi' }
          ]
        })
      );
    });

    it('uses OPENAI_BASE_URL when set in env', async () => {
      process.env.FAILOVER_ENABLED = 'true';
      process.env.OPENAI_API_KEY = 'sk-test';
      process.env.OPENAI_BASE_URL = 'https://api.custom-openai.com/v1';
      mockQuery.mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw new Error('fail');
        }
      });

      async function* emptyStream() {}
      mockCreate.mockResolvedValue(emptyStream());

      for await (const _ of llmQuery({ prompt: 'Hi', options: defaultOptions })) {}

      const OpenAIConstructor = require('openai').default;
      expect(OpenAIConstructor).toHaveBeenCalledWith(
        expect.objectContaining({ apiKey: 'sk-test', baseURL: 'https://api.custom-openai.com/v1' })
      );
    });
  });
});
