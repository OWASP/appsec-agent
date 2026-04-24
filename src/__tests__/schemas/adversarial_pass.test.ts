import {
  parseAdversarialPassContext,
  buildAdversarialUserPrompt,
  toSecurityFindings,
  emptySecurityReport,
} from '../../schemas/adversarial_pass';

describe('adversarial_pass schema', () => {
  it('parseAdversarialPassContext accepts minimal finding', () => {
    const ctx = parseAdversarialPassContext({
      findings: [
        {
          id: '1',
          title: 't',
          file: 'a.ts',
          description: 'd',
        },
      ],
    });
    expect(ctx.findings).toHaveLength(1);
    expect(ctx.findings[0].title).toBe('t');
  });

  it('parseAdversarialPassContext rejects missing fields', () => {
    expect(() =>
      parseAdversarialPassContext({
        findings: [{ id: '1', title: '', file: 'a.ts', description: 'x' }],
      }),
    ).toThrow();
  });

  it('toSecurityFindings normalizes severity/confidence', () => {
    const ctx = parseAdversarialPassContext({
      findings: [
        {
          id: '1',
          title: 't',
          file: 'a.ts',
          description: 'd',
          severity: 'low',
          confidence: 'low',
        },
      ],
    });
    const sf = toSecurityFindings(ctx);
    expect(sf[0].severity).toBe('LOW');
    expect(sf[0].confidence).toBe('LOW');
  });

  it('buildAdversarialUserPrompt includes diff and context', () => {
    const ctx = parseAdversarialPassContext({
      findings: [
        { id: '1', title: 't', file: 'a.ts', description: 'd' },
      ],
      pr_number: 99,
    });
    const p = buildAdversarialUserPrompt(ctx, {
      diffExcerpt: 'diff here',
      additionalContext: 'ctx here',
    });
    expect(p).toContain('diff here');
    expect(p).toContain('ctx here');
    expect(p).toContain('99');
    expect(p).toContain('Candidate findings');
  });

  it('emptySecurityReport has zero findings', () => {
    const r = emptySecurityReport('P');
    expect(r.security_review_report.findings).toEqual([]);
    expect(r.security_review_report.metadata?.project_name).toBe('P');
  });
});
