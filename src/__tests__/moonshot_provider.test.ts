/**
 * Tests for MoonshotProvider: the streaming agent loop, tool execution,
 * parallel tool_calls pairing, usage mapping, structured output, and
 * error_max_turns.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  __reset,
  __setChatResponses,
  __getCreateCalls,
  type MockChatChunk,
} from './mocks/openai_sdk';
import { __resetModelListCache } from '../providers/moonshot_model';
import { MoonshotProvider } from '../providers/moonshot_provider';
import type { QueryMessage, ResultMessage } from '../providers/query_message';
import type { RoleSpec } from '../providers/role_spec';

function usageChunk(prompt: number, completion: number, cached = 0): MockChatChunk {
  return {
    choices: [{ finish_reason: null }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      prompt_tokens_details: { cached_tokens: cached },
    },
  };
}

function textTurn(text: string, prompt = 100, completion = 20): MockChatChunk[] {
  return [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    usageChunk(prompt, completion),
  ];
}

/**
 * kimi-k3 nests usage per-choice on the final chunk (`choices[0].usage`) and
 * leaves top-level `chunk.usage` null, unlike kimi-k2.6. See the Kimi streaming
 * docs. This shape ensures the provider reads usage from both locations.
 */
function k3TextTurn(text: string, prompt = 100, completion = 20, cached = 0): MockChatChunk[] {
  return [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    {
      choices: [
        {
          delta: {},
          finish_reason: 'stop',
          usage: {
            prompt_tokens: prompt,
            completion_tokens: completion,
            ...(cached > 0 ? { cached_tokens: cached } : {}),
          },
        },
      ],
    },
  ];
}

function toolCallTurn(
  calls: Array<{ index: number; id: string; name: string; args: string }>,
): MockChatChunk[] {
  const deltas: MockChatChunk[] = calls.map((c) => ({
    choices: [
      {
        delta: {
          tool_calls: [{ index: c.index, id: c.id, function: { name: c.name, arguments: c.args } }],
        },
        finish_reason: null,
      },
    ],
  }));
  return [...deltas, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }, usageChunk(80, 10)];
}

async function collect(gen: AsyncGenerator<QueryMessage>): Promise<QueryMessage[]> {
  const out: QueryMessage[] = [];
  for await (const msg of gen) out.push(msg);
  return out;
}

function baseSpec(overrides: Partial<RoleSpec> = {}): RoleSpec {
  return {
    roleId: 'test',
    systemPrompt: 'system',
    maxTurns: 5,
    capabilities: {},
    ...overrides,
  };
}

describe('MoonshotProvider', () => {
  const originalKey = process.env.MOONSHOT_API_KEY;
  let workDir: string;

  beforeEach(() => {
    __reset();
    __resetModelListCache();
    process.env.MOONSHOT_API_KEY = 'test-key';
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonshot-prov-'));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = originalKey;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('streams text and emits a final result with mapped usage', async () => {
    __setChatResponses([textTurn('hello world', 123, 45)]);
    const provider = new MoonshotProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));

    const deltas = msgs.filter((m) => m.type === 'stream_event');
    expect(deltas.length).toBeGreaterThan(0);

    const assistant = msgs.find((m) => m.type === 'assistant') as { message: { content: Array<{ text: string }> } };
    expect(assistant.message.content[0].text).toBe('hello world');

    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(false);
    expect(result.usage?.input_tokens).toBe(123);
    expect(result.usage?.output_tokens).toBe(45);
    expect(result.num_turns).toBe(1);
    expect(result.total_cost_usd).toBeGreaterThan(0);
  });

  it('captures Kimi-native per-choice usage (kimi-k3 choices[0].usage) into cost', async () => {
    __setChatResponses([k3TextTurn('k3 answer', 5000, 800, 1200)]);
    const provider = new MoonshotProvider();
    const msgs = await collect(
      provider.run({ prompt: 'hi', roleSpec: baseSpec({ model: 'kimi-k3' }) }),
    );

    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(false);
    expect(result.usage?.input_tokens).toBe(5000);
    expect(result.usage?.output_tokens).toBe(800);
    expect(result.usage?.cache_read_input_tokens).toBe(1200);
    expect(result.total_cost_usd).toBeGreaterThan(0);
  });

  it('maps cached prompt tokens to cache_read_input_tokens', async () => {
    __setChatResponses([[
      { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] },
      usageChunk(200, 10, 150),
    ]]);
    const provider = new MoonshotProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.usage?.cache_read_input_tokens).toBe(150);
  });

  it('executes a tool call and feeds the result back keyed by tool_call_id', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'file-contents');
    __setChatResponses([
      toolCallTurn([{ index: 0, id: 'call_1', name: 'Read', args: JSON.stringify({ path: 'a.txt' }) }]),
      textTurn('done'),
    ]);

    const provider = new MoonshotProvider();
    const spec = baseSpec({ capabilities: { read: true }, workingDirectory: workDir });
    const msgs = await collect(provider.run({ prompt: 'read it', roleSpec: spec }));

    const progress = msgs.filter((m) => m.type === 'tool_progress');
    expect(progress).toHaveLength(1);

    const secondCall = __getCreateCalls()[1];
    const messages = secondCall.messages as Array<{ role: string; tool_call_id?: string; content?: string }>;
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('call_1');
    expect(toolMsg?.content).toContain('file-contents');
  });

  it('pairs each parallel tool call with its own tool message (split across chunks)', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'AAA');
    __setChatResponses([
      // ids/names/args arrive fragmented across chunks and must reassemble by index.
      [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_a', function: { name: 'Re' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"path":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'ad', arguments: '"a.txt"}' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 1, id: 'call_b', function: { name: 'Grep', arguments: '{"pattern":"A"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        usageChunk(50, 5),
      ],
      textTurn('final'),
    ]);

    const provider = new MoonshotProvider();
    const spec = baseSpec({ capabilities: { read: true, grep: true }, workingDirectory: workDir });
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: spec }));
    expect(msgs.filter((m) => m.type === 'tool_progress')).toHaveLength(2);

    const messages = __getCreateCalls()[1].messages as Array<{ role: string; tool_call_id?: string }>;
    const toolIds = messages.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    expect(toolIds).toEqual(['call_a', 'call_b']);
  });

  it('validates structured output against the schema', async () => {
    const schema = { type: 'object', required: ['ok'] };
    __setChatResponses([textTurn(JSON.stringify({ ok: true }))]);
    const provider = new MoonshotProvider();
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: baseSpec({ outputSchema: schema }) }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(false);
    expect(result.structured_output).toEqual({ ok: true });
  });

  it('flags schema violations as errors', async () => {
    const schema = { type: 'object', required: ['ok'] };
    __setChatResponses([textTurn(JSON.stringify({ nope: 1 }))]);
    const provider = new MoonshotProvider();
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: baseSpec({ outputSchema: schema }) }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(true);
    expect(result.error_message).toMatch(/missing required property: ok/);
  });

  it('sets error_max_turns when the loop exhausts maxTurns still calling tools', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'x');
    __setChatResponses([
      toolCallTurn([{ index: 0, id: 'c1', name: 'Read', args: JSON.stringify({ path: 'a.txt' }) }]),
    ]);
    const provider = new MoonshotProvider();
    const spec = baseSpec({ maxTurns: 1, capabilities: { read: true }, workingDirectory: workDir });
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: spec }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(true);
    expect(result.subtype).toBe('error_max_turns');
  });

  it('proxies MCP tool calls through the injected bridge and closes it', async () => {
    const call = jest.fn().mockResolvedValue('mcp-result');
    const close = jest.fn().mockResolvedValue(undefined);
    const bridge = {
      tools: [
        {
          type: 'function' as const,
          function: { name: 'mcp__appsec-internal__queryImportGraph', description: 'd', parameters: { type: 'object' } },
        },
      ],
      call,
      close,
    };
    const bridgeFactory = jest.fn().mockResolvedValue(bridge);

    __setChatResponses([
      toolCallTurn([
        { index: 0, id: 'm1', name: 'mcp__appsec-internal__queryImportGraph', args: JSON.stringify({ path: 'a.ts' }) },
      ]),
      textTurn('done'),
    ]);

    const provider = new MoonshotProvider(undefined, bridgeFactory);
    const spec = baseSpec({
      capabilities: {},
      mcp: { url: 'https://mcp.test', name: 'appsec-internal', toolNames: ['queryImportGraph'] },
    });
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: spec }));

    expect(bridgeFactory).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('mcp__appsec-internal__queryImportGraph', { path: 'a.ts' });
    expect(close).toHaveBeenCalledTimes(1);

    const messages = __getCreateCalls()[1].messages as Array<{ role: string; content?: string }>;
    const toolMsg = messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBe('mcp-result');
    expect((msgs.find((m) => m.type === 'result') as ResultMessage).is_error).toBe(false);
  });

  it('surfaces a missing API key as an error result rather than throwing', async () => {
    delete process.env.MOONSHOT_API_KEY;
    const provider = new MoonshotProvider();
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(true);
    expect(result.error_message).toMatch(/MOONSHOT_API_KEY is not set/);
  });
});
