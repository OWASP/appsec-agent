/**
 * Tests for DeepInfra RoleSpec mapping: client options, reasoning-effort
 * validation, tool-name resolution (parity with resolveClaudeTools), and
 * message building.
 */

import {
  buildDeepInfraMessages,
  resolveDeepInfraToolNames,
  resolveReasoningEffort,
  roleSpecToDeepInfraClientOptions,
  DEFAULT_DEEPINFRA_BASE_URL,
  DEFAULT_REASONING_EFFORT,
} from '../providers/deepinfra_role_spec';
import type { RoleSpec } from '../providers/role_spec';

function baseSpec(overrides: Partial<RoleSpec> = {}): RoleSpec {
  return {
    roleId: 'test',
    systemPrompt: 'system',
    maxTurns: 5,
    capabilities: {},
    ...overrides,
  };
}

describe('resolveDeepInfraToolNames', () => {
  it('derives tools from capabilities', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true, write: true, shell: true } });
    expect(resolveDeepInfraToolNames(spec)).toEqual(['Read', 'Grep', 'Write', 'Bash']);
  });

  it('maps graphviz capability to Graphviz (parity with Claude no-op)', () => {
    const spec = baseSpec({ capabilities: { read: true, graphviz: true } });
    expect(resolveDeepInfraToolNames(spec)).toEqual(['Read', 'Graphviz']);
  });

  it('honors allowedTools as a verbatim override', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true }, allowedTools: ['Write'] });
    expect(resolveDeepInfraToolNames(spec)).toEqual(['Write']);
  });

  it('returns an empty list when noTools is set', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true }, noTools: true });
    expect(resolveDeepInfraToolNames(spec)).toEqual([]);
  });

  it('prefers allowedTools over noTools (diff noTools -> Write only)', () => {
    const spec = baseSpec({ capabilities: {}, noTools: true, allowedTools: ['Write'] });
    expect(resolveDeepInfraToolNames(spec)).toEqual(['Write']);
  });
});

describe('resolveReasoningEffort', () => {
  it('defaults to medium when unset', () => {
    expect(resolveReasoningEffort(undefined)).toBe(DEFAULT_REASONING_EFFORT);
    expect(resolveReasoningEffort('')).toBe('medium');
  });

  it('accepts and normalizes valid values', () => {
    expect(resolveReasoningEffort('none')).toBe('none');
    expect(resolveReasoningEffort('LOW')).toBe('low');
    expect(resolveReasoningEffort(' high ')).toBe('high');
  });

  it('throws a clear error for unrecognized values', () => {
    expect(() => resolveReasoningEffort('extreme')).toThrow(/Invalid DEEPINFRA_REASONING_EFFORT/);
  });
});

describe('roleSpecToDeepInfraClientOptions', () => {
  const original = process.env.DEEPINFRA_API_KEY;
  const originalBase = process.env.DEEPINFRA_BASE_URL;
  const originalReasoning = process.env.DEEPINFRA_REASONING_EFFORT;

  afterEach(() => {
    if (original === undefined) delete process.env.DEEPINFRA_API_KEY;
    else process.env.DEEPINFRA_API_KEY = original;
    if (originalBase === undefined) delete process.env.DEEPINFRA_BASE_URL;
    else process.env.DEEPINFRA_BASE_URL = originalBase;
    if (originalReasoning === undefined) delete process.env.DEEPINFRA_REASONING_EFFORT;
    else process.env.DEEPINFRA_REASONING_EFFORT = originalReasoning;
  });

  it('throws a clear error when the API key is missing', () => {
    delete process.env.DEEPINFRA_API_KEY;
    expect(() => roleSpecToDeepInfraClientOptions()).toThrow(/DEEPINFRA_API_KEY is not set/);
  });

  it('defaults the base URL and reasoning effort', () => {
    process.env.DEEPINFRA_API_KEY = 'k';
    delete process.env.DEEPINFRA_BASE_URL;
    delete process.env.DEEPINFRA_REASONING_EFFORT;
    const opts = roleSpecToDeepInfraClientOptions();
    expect(opts.baseURL).toBe(DEFAULT_DEEPINFRA_BASE_URL);
    expect(opts.reasoningEffort).toBe('medium');
    expect(opts.maxRetries).toBe(5);
  });

  it('honors a base URL override', () => {
    process.env.DEEPINFRA_API_KEY = 'k';
    process.env.DEEPINFRA_BASE_URL = 'https://example.test/v1';
    expect(roleSpecToDeepInfraClientOptions().baseURL).toBe('https://example.test/v1');
  });

  it('honors a reasoning-effort override', () => {
    process.env.DEEPINFRA_API_KEY = 'k';
    process.env.DEEPINFRA_REASONING_EFFORT = 'none';
    expect(roleSpecToDeepInfraClientOptions().reasoningEffort).toBe('none');
  });
});

describe('buildDeepInfraMessages', () => {
  it('produces a system + user pair', () => {
    const messages = buildDeepInfraMessages(baseSpec(), 'do it');
    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'do it' },
    ]);
  });

  it('injects the schema and the word json when an output schema is set', () => {
    const schema = { type: 'object', required: ['x'] };
    const messages = buildDeepInfraMessages(baseSpec({ outputSchema: schema }), 'go');
    expect(messages[0].content).toMatch(/json/i);
    expect(messages[0].content).toContain(JSON.stringify(schema));
  });
});
