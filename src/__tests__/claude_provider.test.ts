/**
 * Tests for ClaudeProvider (Anthropic-only model runtime).
 */

import { ClaudeProvider } from '../providers/claude_provider';
import type { RoleSpec } from '../providers/role_spec';

const mockQuery = jest.fn();
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: (params: unknown) => mockQuery(params),
}));

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider();
  const roleSpec: RoleSpec = {
    roleId: 'simple_query_agent',
    systemPrompt: 'You are a helpful assistant.',
    maxTurns: 1,
    capabilities: {},
    noTools: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('has provider id claude', () => {
    expect(provider.provider).toBe('claude');
  });

  it('maps RoleSpec to Claude Options and forwards to query()', async () => {
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        yield { type: 'result', is_error: false };
      },
    });

    for await (const _ of provider.run({ prompt: 'Hello', roleSpec })) {
      // drain
    }

    expect(mockQuery).toHaveBeenCalledWith({
      prompt: 'Hello',
      options: expect.objectContaining({
        systemPrompt: roleSpec.systemPrompt,
        maxTurns: 1,
      }),
    });
  });

  it('yields SDK messages as QueryMessage passthrough', async () => {
    const sdkMessages = [
      { type: 'tool_progress', tool_name: 'Read' },
      { type: 'result', is_error: false, total_cost_usd: 0.01 },
    ];
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const m of sdkMessages) yield m;
      },
    });

    const out: unknown[] = [];
    for await (const msg of provider.run({ prompt: 'Hi', roleSpec })) {
      out.push(msg);
    }

    expect(out).toEqual(sdkMessages);
  });

  it('propagates SDK errors', async () => {
    mockQuery.mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        throw new Error('SDK failure');
      },
    });

    const gen = provider.run({ prompt: 'Hi', roleSpec });
    await expect(gen.next()).rejects.toThrow('SDK failure');
  });
});
