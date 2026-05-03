/**
 * Tests for src/schemas/learned_guidance.ts (v2.5.0 / parent-app plan §3.8).
 *
 * Schema is the cross-repo contract between the appsec-agent
 * `learned_guidance_synthesizer` role and the parent app's
 * `learnedGuidanceSynthesizer.runSynthesizerAgent` spawn wrapper. Anything
 * that drifts here breaks the parent app's `extractBulletsFromAgentOutput`
 * fail-closed path, so we keep the validator tight and exercise both
 * happy-path and rejection cases.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  parseLearnedGuidanceInputs,
  loadLearnedGuidanceInputs,
  buildLearnedGuidanceUserPrompt,
  emptyLearnedGuidanceOutput,
  LEARNED_GUIDANCE_OUTPUT_SCHEMA,
  MAX_BULLET_LEN,
} from '../../schemas/learned_guidance';

describe('learned_guidance schema', () => {
  describe('parseLearnedGuidanceInputs', () => {
    it('accepts a minimal single-bucket input', () => {
      const out = parseLearnedGuidanceInputs({
        buckets: [
          {
            cwe: 'CWE-79',
            signal_count: 5,
            example_dismissal_reasons: ['React auto-escapes JSX'],
          },
        ],
      });
      expect(out.buckets).toHaveLength(1);
      expect(out.buckets[0].cwe).toBe('CWE-79');
      expect(out.buckets[0].signal_count).toBe(5);
      expect(out.buckets[0].example_dismissal_reasons).toEqual(['React auto-escapes JSX']);
    });

    it('accepts a bucket with zero example reasons', () => {
      const out = parseLearnedGuidanceInputs({
        buckets: [{ cwe: 'CWE-352', signal_count: 7, example_dismissal_reasons: [] }],
      });
      expect(out.buckets[0].example_dismissal_reasons).toEqual([]);
    });

    it('floors a fractional signal_count to an integer', () => {
      const out = parseLearnedGuidanceInputs({
        buckets: [
          { cwe: 'CWE-89', signal_count: 5.7, example_dismissal_reasons: [] },
        ],
      });
      expect(out.buckets[0].signal_count).toBe(5);
    });

    it('truncates over-long example reasons in place', () => {
      const longReason = 'x'.repeat(2_500);
      const out = parseLearnedGuidanceInputs({
        buckets: [
          {
            cwe: 'CWE-22',
            signal_count: 1,
            example_dismissal_reasons: [longReason],
          },
        ],
      });
      expect(out.buckets[0].example_dismissal_reasons[0]).toHaveLength(2_000);
    });

    it.each([
      [null, 'must be a JSON object'],
      [undefined, 'must be a JSON object'],
      ['not an object', 'must be a JSON object'],
      [{}, 'must include a "buckets" array'],
      [{ buckets: 'no' }, 'must include a "buckets" array'],
      [{ buckets: [] }, 'at least one bucket'],
    ])('rejects malformed top-level shape: %p', (input, expected) => {
      expect(() => parseLearnedGuidanceInputs(input)).toThrow(expected);
    });

    it.each([
      [{ buckets: [null] }, 'Each bucket must be an object'],
      [{ buckets: [{ cwe: '', signal_count: 1, example_dismissal_reasons: [] }] }, 'non-empty string "cwe"'],
      [{ buckets: [{ cwe: 'CWE-1', signal_count: -1, example_dismissal_reasons: [] }] }, 'non-negative numeric "signal_count"'],
      [{ buckets: [{ cwe: 'CWE-1', signal_count: 'one', example_dismissal_reasons: [] }] }, 'non-negative numeric "signal_count"'],
      [{ buckets: [{ cwe: 'CWE-1', signal_count: 1, example_dismissal_reasons: 'no' }] }, 'array "example_dismissal_reasons"'],
      [{ buckets: [{ cwe: 'CWE-1', signal_count: 1, example_dismissal_reasons: [42] }] }, 'must all be strings'],
    ])('rejects malformed bucket: %p', (input, expected) => {
      expect(() => parseLearnedGuidanceInputs(input)).toThrow(expected);
    });

    it('rejects too many buckets', () => {
      const tooMany = Array.from({ length: 201 }, (_, i) => ({
        cwe: `CWE-${i}`,
        signal_count: 1,
        example_dismissal_reasons: [],
      }));
      expect(() => parseLearnedGuidanceInputs({ buckets: tooMany })).toThrow('200 buckets');
    });

    it('rejects too many reasons per bucket', () => {
      const tooManyReasons = Array.from({ length: 201 }, (_, i) => `reason ${i}`);
      expect(() =>
        parseLearnedGuidanceInputs({
          buckets: [{ cwe: 'CWE-1', signal_count: 1, example_dismissal_reasons: tooManyReasons }],
        }),
      ).toThrow('200 example_dismissal_reasons');
    });

    it('rejects an over-long cwe identifier', () => {
      const longCwe = 'CWE-' + 'x'.repeat(100);
      expect(() =>
        parseLearnedGuidanceInputs({
          buckets: [{ cwe: longCwe, signal_count: 1, example_dismissal_reasons: [] }],
        }),
      ).toThrow('exceeds 64 chars');
    });
  });

  describe('loadLearnedGuidanceInputs', () => {
    let tmpFile: string;
    beforeEach(() => {
      tmpFile = path.join(os.tmpdir(), `cllg-inputs-${Date.now()}-${Math.random()}.json`);
    });
    afterEach(() => {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    });

    it('round-trips a valid file', () => {
      fs.writeFileSync(
        tmpFile,
        JSON.stringify({
          buckets: [
            { cwe: 'CWE-79', signal_count: 5, example_dismissal_reasons: ['x'] },
          ],
        }),
      );
      const out = loadLearnedGuidanceInputs(tmpFile);
      expect(out.buckets).toHaveLength(1);
    });

    it('throws when the file is missing', () => {
      expect(() => loadLearnedGuidanceInputs('/nonexistent/cllg-inputs.json'))
        .toThrow('not found');
    });

    it('throws when the file is not valid JSON', () => {
      fs.writeFileSync(tmpFile, '{not json');
      expect(() => loadLearnedGuidanceInputs(tmpFile)).toThrow('Failed to parse');
    });
  });

  describe('buildLearnedGuidanceUserPrompt', () => {
    it('includes the CWE label, signal count, and each reason', () => {
      const prompt = buildLearnedGuidanceUserPrompt({
        buckets: [
          {
            cwe: 'CWE-79',
            signal_count: 7,
            example_dismissal_reasons: ['React auto-escapes', 'helmet middleware mitigates'],
          },
        ],
      });
      expect(prompt).toContain('CWE-79');
      expect(prompt).toContain('7 signals');
      expect(prompt).toContain('React auto-escapes');
      expect(prompt).toContain('helmet middleware mitigates');
    });

    it('uses singular form for a single signal', () => {
      const prompt = buildLearnedGuidanceUserPrompt({
        buckets: [{ cwe: 'CWE-22', signal_count: 1, example_dismissal_reasons: ['only one'] }],
      });
      expect(prompt).toContain('1 signal');
      expect(prompt).not.toContain('1 signals');
    });

    it('explicitly tells the model to be conservative when example reasons are empty', () => {
      const prompt = buildLearnedGuidanceUserPrompt({
        buckets: [{ cwe: 'CWE-352', signal_count: 5, example_dismissal_reasons: [] }],
      });
      expect(prompt).toContain('be conservative');
    });

    it('mentions the per-bullet character cap', () => {
      const prompt = buildLearnedGuidanceUserPrompt({
        buckets: [{ cwe: 'CWE-1', signal_count: 5, example_dismissal_reasons: ['x'] }],
      });
      expect(prompt).toContain(`${MAX_BULLET_LEN} characters`);
    });

    it('flattens newlines in reasons so the markdown bullet list stays one-line-per-reason', () => {
      const prompt = buildLearnedGuidanceUserPrompt({
        buckets: [
          {
            cwe: 'CWE-1',
            signal_count: 1,
            example_dismissal_reasons: ['line one\nline two\n\nline three'],
          },
        ],
      });
      expect(prompt).toContain('line one line two line three');
    });
  });

  describe('LEARNED_GUIDANCE_OUTPUT_SCHEMA', () => {
    it('declares bullets as the only required top-level property', () => {
      expect(LEARNED_GUIDANCE_OUTPUT_SCHEMA.required).toEqual(['bullets']);
      expect(LEARNED_GUIDANCE_OUTPUT_SCHEMA.additionalProperties).toBe(false);
    });

    it('caps bullet length at MAX_BULLET_LEN and confidence in [0, 1]', () => {
      const props = (LEARNED_GUIDANCE_OUTPUT_SCHEMA.properties as any).bullets.items
        .properties;
      expect(props.bullet.maxLength).toBe(MAX_BULLET_LEN);
      expect(props.confidence.minimum).toBe(0);
      expect(props.confidence.maximum).toBe(1);
    });
  });

  describe('emptyLearnedGuidanceOutput', () => {
    it('returns the same { bullets: [] } shape main.ts writes on no-output', () => {
      expect(emptyLearnedGuidanceOutput()).toEqual({ bullets: [] });
    });
  });
});
