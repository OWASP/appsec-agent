/**
 * Tests for Codex model resolution and cost estimation.
 */

import { estimateCodexCostUsd, resolveCodexModel } from '../providers/codex_model';

describe('codex_model', () => {
  describe('resolveCodexModel', () => {
    it('maps Claude family aliases', () => {
      expect(resolveCodexModel('opus')).toBe('o3');
      expect(resolveCodexModel('sonnet')).toBe('gpt-4.1');
      expect(resolveCodexModel('haiku')).toBe('gpt-4.1-mini');
    });

    it('passes through OpenAI model ids', () => {
      expect(resolveCodexModel('gpt-4.1')).toBe('gpt-4.1');
      expect(resolveCodexModel('o3')).toBe('o3');
    });
  });

  describe('estimateCodexCostUsd', () => {
    it('returns positive cost for non-zero usage', () => {
      const cost = estimateCodexCostUsd('gpt-4.1', {
        input_tokens: 1000,
        output_tokens: 500,
      });
      expect(cost).toBeGreaterThan(0);
    });
  });
});
