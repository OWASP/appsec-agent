/**
 * Tests for Moonshot RoleSpec mapping: client options, tool-name resolution
 * (parity with resolveClaudeTools), and message building.
 */

import {
  buildMoonshotMessages,
  resolveMoonshotToolNames,
  roleSpecToMoonshotClientOptions,
  DEFAULT_MOONSHOT_BASE_URL,
} from '../providers/moonshot_role_spec';
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

describe('resolveMoonshotToolNames', () => {
  it('derives tools from capabilities', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true, write: true, shell: true } });
    expect(resolveMoonshotToolNames(spec)).toEqual(['Read', 'Grep', 'Write', 'Bash']);
  });

  it('maps graphviz capability to Graphviz (parity with Claude no-op)', () => {
    const spec = baseSpec({ capabilities: { read: true, graphviz: true } });
    expect(resolveMoonshotToolNames(spec)).toEqual(['Read', 'Graphviz']);
  });

  it('honors allowedTools as a verbatim override', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true }, allowedTools: ['Write'] });
    expect(resolveMoonshotToolNames(spec)).toEqual(['Write']);
  });

  it('returns an empty list when noTools is set', () => {
    const spec = baseSpec({ capabilities: { read: true, grep: true }, noTools: true });
    expect(resolveMoonshotToolNames(spec)).toEqual([]);
  });

  it('prefers allowedTools over noTools (diff noTools -> Write only)', () => {
    const spec = baseSpec({ capabilities: {}, noTools: true, allowedTools: ['Write'] });
    expect(resolveMoonshotToolNames(spec)).toEqual(['Write']);
  });
});

describe('roleSpecToMoonshotClientOptions', () => {
  const original = process.env.MOONSHOT_API_KEY;
  const originalBase = process.env.MOONSHOT_BASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = original;
    if (originalBase === undefined) delete process.env.MOONSHOT_BASE_URL;
    else process.env.MOONSHOT_BASE_URL = originalBase;
  });

  it('throws a clear error when the API key is missing', () => {
    delete process.env.MOONSHOT_API_KEY;
    expect(() => roleSpecToMoonshotClientOptions()).toThrow(/MOONSHOT_API_KEY is not set/);
  });

  it('defaults the base URL', () => {
    process.env.MOONSHOT_API_KEY = 'k';
    delete process.env.MOONSHOT_BASE_URL;
    expect(roleSpecToMoonshotClientOptions().baseURL).toBe(DEFAULT_MOONSHOT_BASE_URL);
  });

  it('honors a base URL override', () => {
    process.env.MOONSHOT_API_KEY = 'k';
    process.env.MOONSHOT_BASE_URL = 'https://example.test/v1';
    expect(roleSpecToMoonshotClientOptions().baseURL).toBe('https://example.test/v1');
  });
});

describe('buildMoonshotMessages', () => {
  it('produces a system + user pair', () => {
    const messages = buildMoonshotMessages(baseSpec(), 'do it');
    expect(messages).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'do it' },
    ]);
  });

  it('injects the schema and the word json when an output schema is set', () => {
    const schema = { type: 'object', required: ['x'] };
    const messages = buildMoonshotMessages(baseSpec({ outputSchema: schema }), 'go');
    expect(messages[0].content).toMatch(/json/i);
    expect(messages[0].content).toContain(JSON.stringify(schema));
  });
});
