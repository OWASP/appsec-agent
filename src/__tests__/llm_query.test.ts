/**
 * Tests for LLM query adapter (delegates to ClaudeProvider).
 */

import { llmQuery } from '../llm_query';

const mockQuery = jest.fn();
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: unknown) => mockQuery(params),
}));

describe('llmQuery', () => {
  const defaultOptions = { systemPrompt: 'You are a helpful assistant.', maxTurns: 1 };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('yields messages from Anthropic via ClaudeProvider', async () => {
    const messages = [
      {
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Hi' }] } },
      { type: 'result', is_error: false, num_turns: 1 },
    ];
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const m of messages) yield m;
      },
    });

    const out: unknown[] = [];
    for await (const msg of llmQuery({ prompt: 'Hello', options: defaultOptions })) {
      out.push(msg);
    }

    expect(mockQuery).toHaveBeenCalledWith({ prompt: 'Hello', options: defaultOptions });
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: 'stream_event' });
    expect(out[1]).toMatchObject({ type: 'assistant' });
    expect(out[2]).toMatchObject({ type: 'result', is_error: false });
  });

  it('propagates Anthropic errors', async () => {
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new Error('Anthropic 503');
      },
    });
    const gen = llmQuery({ prompt: 'Hi', options: defaultOptions });
    const result = await gen.next().catch((e: Error) => e);
    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('Anthropic 503');
  });

  it('yields error results from Anthropic without transformation', async () => {
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'result', is_error: true, subtype: 'error' };
      },
    });

    const out: unknown[] = [];
    for await (const msg of llmQuery({ prompt: 'Hi', options: defaultOptions })) {
      out.push(msg);
    }

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'result', is_error: true });
  });
});
