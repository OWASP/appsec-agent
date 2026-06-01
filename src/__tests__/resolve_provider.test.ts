/**
 * Tests for provider resolution (AGENT_PROVIDER env).
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

jest.mock('../providers/codex_provider', () => ({
  defaultCodexProvider: { provider: 'codex' },
}));

import { defaultClaudeProvider } from '../providers/claude_provider';
import { normalizeProviderId, resolveProvider } from '../providers/resolve_provider';

describe('resolve_provider', () => {
  const original = process.env.AGENT_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.AGENT_PROVIDER;
    } else {
      process.env.AGENT_PROVIDER = original;
    }
  });

  describe('normalizeProviderId', () => {
    it('defaults to claude', () => {
      expect(normalizeProviderId(undefined)).toBe('claude');
    });

    it('accepts codex', () => {
      expect(normalizeProviderId('codex')).toBe('codex');
    });

    it('rejects unknown providers', () => {
      expect(() => normalizeProviderId('gpt')).toThrow(/Invalid provider/);
    });
  });

  describe('resolveProvider', () => {
    it('returns ClaudeProvider when AGENT_PROVIDER is claude', () => {
      process.env.AGENT_PROVIDER = 'claude';
      expect(resolveProvider()).toBe(defaultClaudeProvider);
    });

    it('returns CodexProvider when AGENT_PROVIDER is codex', () => {
      process.env.AGENT_PROVIDER = 'codex';
      expect(resolveProvider().provider).toBe('codex');
    });
  });
});
