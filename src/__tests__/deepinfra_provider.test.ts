/**
 * Tests for DeepInfraProvider: the streaming agent loop, tool execution,
 * parallel tool_calls pairing, usage/cost mapping, reasoning-effort, structured
 * output, and error_max_turns / truncation handling.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  __reset,
  __setChatResponses,
  __setModelList,
  __getCreateCalls,
  type MockChatChunk,
} from './mocks/openai_sdk';
import { __resetModelListCache } from '../providers/deepinfra_model';
import { DeepInfraProvider } from '../providers/deepinfra_provider';
import type { QueryMessage, ResultMessage } from '../providers/query_message';
import type { RoleSpec } from '../providers/role_spec';

function usageChunk(
  prompt: number,
  completion: number,
  cached = 0,
  estimatedCost = 0,
  cacheWrite = 0,
): MockChatChunk {
  return {
    choices: [{ finish_reason: null }],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: completion,
      prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: cacheWrite || null },
      ...(estimatedCost > 0 ? { estimated_cost: estimatedCost } : {}),
    },
  };
}

function textTurn(text: string, prompt = 100, completion = 20, estimatedCost = 0.001): MockChatChunk[] {
  return [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
    usageChunk(prompt, completion, 0, estimatedCost),
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

describe('DeepInfraProvider', () => {
  const originalKey = process.env.DEEPINFRA_API_KEY;
  const originalReasoning = process.env.DEEPINFRA_REASONING_EFFORT;
  let workDir: string;

  beforeEach(() => {
    __reset();
    __resetModelListCache();
    process.env.DEEPINFRA_API_KEY = 'test-key';
    delete process.env.DEEPINFRA_REASONING_EFFORT;
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deepinfra-prov-'));
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.DEEPINFRA_API_KEY;
    else process.env.DEEPINFRA_API_KEY = originalKey;
    if (originalReasoning === undefined) delete process.env.DEEPINFRA_REASONING_EFFORT;
    else process.env.DEEPINFRA_REASONING_EFFORT = originalReasoning;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('streams text and emits a final result with mapped usage and exact cost', async () => {
    __setChatResponses([textTurn('hello world', 123, 45, 0.0021)]);
    const provider = new DeepInfraProvider();
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
    expect(result.total_cost_usd).toBeCloseTo(0.0021, 8);
  });

  it('sums estimated_cost across multiple turns', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'x');
    __setChatResponses([
      // toolCallTurn's usageChunk carries no estimated_cost (0.002 injected below via override)
      [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'Read', arguments: '{"path":"a.txt"}' } }] } }] },
        { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
        usageChunk(80, 10, 0, 0.0005),
      ],
      textTurn('done', 100, 20, 0.001),
    ]);
    const provider = new DeepInfraProvider();
    const spec = baseSpec({ capabilities: { read: true }, workingDirectory: workDir });
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: spec }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.total_cost_usd).toBeCloseTo(0.0015, 8);
  });

  it('falls back to cached /v1/models pricing when estimated_cost is absent', async () => {
    __setModelList([
      { id: 'moonshotai/Kimi-K2.6', tags: ['chat'], pricing: { input_tokens: 0.75, output_tokens: 3.5 } },
    ]);
    __setChatResponses([[
      { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] },
      usageChunk(200, 100, 0, 0),
    ]]);
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    // 200/1e6 * 0.75 + 100/1e6 * 3.5 = 0.00015 + 0.00035 = 0.0005
    expect(result.total_cost_usd).toBeCloseTo(0.0005, 8);
  });

  it('maps cached prompt tokens and cache-write tokens', async () => {
    __setChatResponses([[
      { choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }] },
      usageChunk(200, 10, 150, 0.001, 40),
    ]]);
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.usage?.cache_read_input_tokens).toBe(150);
    expect(result.usage?.cache_creation_input_tokens).toBe(40);
  });

  it('reads usage nested per-choice when top-level usage is absent (defensive fallback)', async () => {
    __setChatResponses([[
      { choices: [{ delta: { content: 'answer' }, finish_reason: null }] },
      {
        choices: [
          {
            delta: {},
            finish_reason: 'stop',
            usage: { prompt_tokens: 5000, completion_tokens: 800, estimated_cost: 0.01 },
          },
        ],
      },
    ]]);
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(false);
    expect(result.usage?.input_tokens).toBe(5000);
    expect(result.usage?.output_tokens).toBe(800);
    expect(result.total_cost_usd).toBeCloseTo(0.01, 8);
  });

  it('sends reasoning_effort on every request, defaulting to medium', async () => {
    __setChatResponses([textTurn('hi')]);
    const provider = new DeepInfraProvider();
    await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    expect(__getCreateCalls()[0].reasoning_effort).toBe('medium');
  });

  it('honors DEEPINFRA_REASONING_EFFORT overrides', async () => {
    process.env.DEEPINFRA_REASONING_EFFORT = 'none';
    __setChatResponses([textTurn('hi')]);
    const provider = new DeepInfraProvider();
    await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    expect(__getCreateCalls()[0].reasoning_effort).toBe('none');
  });

  it('sends an explicit max_tokens budget so large reports are not clipped', async () => {
    // Model with a large context window (>= the default budget) -> full budget.
    __setModelList([{ id: 'moonshotai/Kimi-K2.6', tags: ['chat'], contextLength: 262144 }]);
    __setChatResponses([textTurn('hi')]);
    const provider = new DeepInfraProvider();
    await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    expect(__getCreateCalls()[0].max_tokens).toBe(64000);
  });

  it('clamps max_tokens to the model context window when it is smaller than the budget', async () => {
    __setModelList([{ id: 'moonshotai/Kimi-K2.6', tags: ['chat'], contextLength: 8192 }]);
    __setChatResponses([textTurn('hi')]);
    const provider = new DeepInfraProvider();
    await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    expect(__getCreateCalls()[0].max_tokens).toBe(8192);
  });

  it('falls back to the flat max_tokens budget when the context window is unknown', async () => {
    // Default mock entries carry no context_length, so detection yields none.
    __setChatResponses([textTurn('hi')]);
    const provider = new DeepInfraProvider();
    await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    expect(__getCreateCalls()[0].max_tokens).toBe(64000);
  });

  it('surfaces a truncated response (finish_reason: length) as an error', async () => {
    __setChatResponses([[
      { choices: [{ delta: { content: 'partial...' }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      usageChunk(100, 4096, 0, 0.05),
    ]]);
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'hi', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(true);
    expect(result.error_message).toMatch(/truncated/i);
    // Usage/cost should still be reported even though the run is flagged as an error.
    expect(result.total_cost_usd).toBeCloseTo(0.05, 8);
  });

  it('executes a tool call and feeds the result back keyed by tool_call_id', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'file-contents');
    __setChatResponses([
      toolCallTurn([{ index: 0, id: 'call_1', name: 'Read', args: JSON.stringify({ path: 'a.txt' }) }]),
      textTurn('done'),
    ]);

    const provider = new DeepInfraProvider();
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

    const provider = new DeepInfraProvider();
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
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: baseSpec({ outputSchema: schema }) }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(false);
    expect(result.structured_output).toEqual({ ok: true });
  });

  it('flags schema violations as errors', async () => {
    const schema = { type: 'object', required: ['ok'] };
    __setChatResponses([textTurn(JSON.stringify({ nope: 1 }))]);
    const provider = new DeepInfraProvider();
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
    const provider = new DeepInfraProvider();
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

    const provider = new DeepInfraProvider(undefined, bridgeFactory);
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
    delete process.env.DEEPINFRA_API_KEY;
    const provider = new DeepInfraProvider();
    const msgs = await collect(provider.run({ prompt: 'go', roleSpec: baseSpec() }));
    const result = msgs.find((m) => m.type === 'result') as ResultMessage;
    expect(result.is_error).toBe(true);
    expect(result.error_message).toMatch(/DEEPINFRA_API_KEY is not set/);
  });
});
