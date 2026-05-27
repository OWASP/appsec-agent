/**
 * Unit tests for the fp_adversary input/output schema module (v2.8.0).
 * Covers parse, normalization, prompt rendering, and the JSON schema shape.
 */
import {
  parseFpAdversaryPassContext,
  buildFpAdversaryUserPrompt,
  toFpAdversaryFindings,
  emptyFpAdversaryReport,
  FP_ADVERSARY_REPORT_SCHEMA,
} from '../../schemas/fp_adversary_pass';

describe('fp_adversary_pass schema (v2.8.0)', () => {
  describe('parseFpAdversaryPassContext', () => {
    it('accepts a minimal finding with required fingerprint', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          {
            fingerprint: 'fp-abc',
            title: 't',
            file: 'a.ts',
            description: 'd',
          },
        ],
      });
      expect(ctx.findings).toHaveLength(1);
      expect(ctx.findings[0].fingerprint).toBe('fp-abc');
    });

    it('rejects a finding without a fingerprint', () => {
      expect(() =>
        parseFpAdversaryPassContext({
          findings: [{ title: 't', file: 'a.ts', description: 'd' }],
        }),
      ).toThrow(/fingerprint/);
    });

    it('rejects a finding with an empty-string fingerprint', () => {
      expect(() =>
        parseFpAdversaryPassContext({
          findings: [
            { fingerprint: '', title: 't', file: 'a.ts', description: 'd' },
          ],
        }),
      ).toThrow(/fingerprint/);
    });

    it('rejects when the findings array is missing entirely', () => {
      expect(() => parseFpAdversaryPassContext({})).toThrow(/findings/);
    });

    it('rejects when findings is not an array', () => {
      expect(() => parseFpAdversaryPassContext({ findings: 'oops' })).toThrow(
        /findings/,
      );
    });

    it('rejects when context is not an object', () => {
      expect(() => parseFpAdversaryPassContext('oops')).toThrow();
      expect(() => parseFpAdversaryPassContext(null)).toThrow();
    });

    it('caps batch size at 500 findings', () => {
      const big = Array.from({ length: 501 }, (_, i) => ({
        fingerprint: `fp-${i}`,
        title: 't',
        file: 'a.ts',
        description: 'd',
      }));
      expect(() => parseFpAdversaryPassContext({ findings: big })).toThrow(
        /500/,
      );
    });

    it('parses the four structured posture fields when present', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          { fingerprint: 'fp', title: 't', file: 'a.ts', description: 'd' },
        ],
        project_summary: 'a Next.js SaaS app',
        security_context: 'Prisma + zod',
        deployment_context: 'multi-tenant, Vercel',
        developer_context: 'PHI fields encrypted with libsodium',
      });
      expect(ctx.project_summary).toBe('a Next.js SaaS app');
      expect(ctx.security_context).toBe('Prisma + zod');
      expect(ctx.deployment_context).toBe('multi-tenant, Vercel');
      expect(ctx.developer_context).toBe('PHI fields encrypted with libsodium');
    });

    it('treats empty-string posture fields as absent', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          { fingerprint: 'fp', title: 't', file: 'a.ts', description: 'd' },
        ],
        project_summary: '',
        security_context: '   ',
      });
      expect(ctx.project_summary).toBeUndefined();
      expect(ctx.security_context).toBeUndefined();
    });

    it('parses the similar_dismissed precedent array', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          { fingerprint: 'fp', title: 't', file: 'a.ts', description: 'd' },
        ],
        similar_dismissed: [
          { fingerprint: 'fp-old-1', file: 'b.ts', cwe: 'CWE-89', dismissal_reason: 'ORM mitigates' },
          { fingerprint: 'fp-old-2', file: 'c.ts' },
          { fingerprint: '', file: 'skip-me.ts' }, // dropped (empty fingerprint)
        ],
      });
      expect(ctx.similar_dismissed).toHaveLength(2);
      expect(ctx.similar_dismissed?.[0]).toEqual({
        fingerprint: 'fp-old-1',
        file: 'b.ts',
        cwe: 'CWE-89',
        dismissal_reason: 'ORM mitigates',
      });
    });

    it('parses metadata.project_name when present', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          { fingerprint: 'fp', title: 't', file: 'a.ts', description: 'd' },
        ],
        metadata: { project_name: 'my-app' },
      });
      expect(ctx.metadata?.project_name).toBe('my-app');
    });
  });

  describe('toFpAdversaryFindings', () => {
    it('preserves fingerprint and normalizes severity/confidence', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          {
            fingerprint: 'fp',
            title: 't',
            file: 'a.ts',
            description: 'd',
            severity: 'low',
            confidence: 'low',
          },
        ],
      });
      const out = toFpAdversaryFindings(ctx);
      expect(out[0].fingerprint).toBe('fp');
      expect(out[0].severity).toBe('LOW');
      expect(out[0].confidence).toBe('LOW');
    });

    it('falls back to MEDIUM for unknown severity/confidence values', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          {
            fingerprint: 'fp',
            title: 't',
            file: 'a.ts',
            description: 'd',
            severity: 'extreme',
            confidence: 'whatever',
          },
        ],
      });
      const out = toFpAdversaryFindings(ctx);
      expect(out[0].severity).toBe('MEDIUM');
      expect(out[0].confidence).toBe('MEDIUM');
    });

    it('defaults category to "Security" when missing', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: [
          { fingerprint: 'fp', title: 't', file: 'a.ts', description: 'd' },
        ],
      });
      const out = toFpAdversaryFindings(ctx);
      expect(out[0].category).toBe('Security');
    });
  });

  describe('buildFpAdversaryUserPrompt', () => {
    const baseCtx = parseFpAdversaryPassContext({
      findings: [
        {
          fingerprint: 'fp-1',
          title: 'SQL injection in user query',
          file: 'src/db/user.ts',
          description: 'concatenated user input',
        },
      ],
    });

    it('includes the verdict framing and required schema keys', () => {
      const p = buildFpAdversaryUserPrompt(baseCtx);
      expect(p).toContain('Adversarial false-positive review');
      expect(p).toContain('fingerprint');
      expect(p).toContain('verdict');
      expect(p).toContain('confidence');
      expect(p).toContain('rationale');
      expect(p).toContain('Candidate findings');
    });

    it('includes structured posture block when any posture field is set', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: baseCtx.findings,
        security_context: 'Prisma ORM',
      });
      const p = buildFpAdversaryUserPrompt(ctx);
      expect(p).toContain('### Project posture (from extraction)');
      expect(p).toContain('Prisma ORM');
    });

    it('omits the posture block when all four posture fields are missing', () => {
      const p = buildFpAdversaryUserPrompt(baseCtx);
      expect(p).not.toContain('### Project posture');
    });

    it('renders the additional-context block from -c when supplied', () => {
      const p = buildFpAdversaryUserPrompt(baseCtx, {
        additionalContext: 'HIPAA-compliant deployment',
      });
      expect(p).toContain('### Additional context (from integrator)');
      expect(p).toContain('HIPAA-compliant deployment');
    });

    it('renders the similar_dismissed precedent block when present', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: baseCtx.findings,
        similar_dismissed: [
          {
            fingerprint: 'fp-old',
            file: 'src/db/order.ts',
            cwe: 'CWE-89',
            dismissal_reason: 'Prisma parameterized query',
          },
        ],
      });
      const p = buildFpAdversaryUserPrompt(ctx);
      expect(p).toContain('### Similar prior dismissals (precedent)');
      expect(p).toContain('fp-old');
      expect(p).toContain('CWE-89');
      expect(p).toContain('Prisma parameterized query');
    });

    it('includes project_name when metadata is set', () => {
      const ctx = parseFpAdversaryPassContext({
        findings: baseCtx.findings,
        metadata: { project_name: 'parent-app' },
      });
      const p = buildFpAdversaryUserPrompt(ctx);
      expect(p).toContain('parent-app');
    });

    it('serializes findings as JSON inside a fenced code block', () => {
      const p = buildFpAdversaryUserPrompt(baseCtx);
      expect(p).toContain('```json');
      expect(p).toContain('"fp-1"');
      expect(p).toContain('"SQL injection in user query"');
    });
  });

  describe('emptyFpAdversaryReport', () => {
    it('returns a zero-verdict report shell', () => {
      const r = emptyFpAdversaryReport();
      expect(r.fp_adversary_report.verdicts).toEqual([]);
    });
  });

  describe('FP_ADVERSARY_REPORT_SCHEMA', () => {
    it('is a well-formed JSON-schema object with the verdict contract', () => {
      const props = (FP_ADVERSARY_REPORT_SCHEMA as any).properties.fp_adversary_report
        .properties.verdicts.items.properties;
      expect(props.fingerprint.type).toBe('string');
      expect(props.verdict.enum).toEqual(['confirm', 'dismiss']);
      expect(props.confidence.type).toBe('number');
      expect(props.confidence.minimum).toBe(0);
      expect(props.confidence.maximum).toBe(1);
      expect(props.rationale.type).toBe('string');
      expect(props.cost_usd_estimate.type).toBe('number');
    });

    it('requires fingerprint, verdict, confidence, rationale (cost_usd_estimate is optional)', () => {
      const required = (FP_ADVERSARY_REPORT_SCHEMA as any).properties
        .fp_adversary_report.properties.verdicts.items.required as string[];
      expect(required).toEqual(['fingerprint', 'verdict', 'confidence', 'rationale']);
      expect(required).not.toContain('cost_usd_estimate');
    });
  });
});
