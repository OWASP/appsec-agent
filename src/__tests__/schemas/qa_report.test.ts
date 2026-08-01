import { QA_REPORT_SCHEMA } from '../../schemas/qa_report';
import {
  parseQaAdversarialPassContext,
  toQaFindings,
  buildQaAdversarialUserPrompt,
  emptyQaReport,
} from '../../schemas/qa_adversarial_pass';
import {
  accumulateUsage,
  emptyUsageCounters,
  printUsageCounters,
  printUsageTotals,
  roleResultFromCounters,
} from '../../utils/usage_counters';

describe('QA_REPORT_SCHEMA (token economy)', () => {
  const findingSchema = (
    QA_REPORT_SCHEMA as {
      properties: {
        qa_review_report: {
          properties: {
            findings: { items: { required: string[]; properties: Record<string, unknown> } };
          };
        };
      };
    }
  ).properties.qa_review_report.properties.findings.items;

  it('keeps bug_class required', () => {
    expect(findingSchema.required).toContain('bug_class');
  });

  it('makes reproduction_steps and causal_chain optional', () => {
    expect(findingSchema.required).not.toContain('reproduction_steps');
    expect(findingSchema.required).not.toContain('causal_chain');
    expect(findingSchema.properties.reproduction_steps).toBeDefined();
    expect(findingSchema.properties.causal_chain).toBeDefined();
    const steps = findingSchema.properties.reproduction_steps as { minItems?: number };
    expect(steps.minItems).toBeUndefined();
  });
});

describe('qa_adversarial_pass severity-tiered keep bar', () => {
  it('injects missing-evidence placeholders only for HIGH/CRITICAL', () => {
    const ctx = parseQaAdversarialPassContext({
      findings: [
        {
          id: 'QA-001',
          title: 'high bug',
          file: 'a.ts',
          description: 'd',
          severity: 'HIGH',
        },
        {
          id: 'QA-002',
          title: 'medium bug',
          file: 'b.ts',
          description: 'd',
          severity: 'MEDIUM',
        },
      ],
    });
    const findings = toQaFindings(ctx);
    expect(findings[0].reproduction_steps?.[0]).toContain('missing');
    expect(findings[0].causal_chain).toContain('missing');
    expect(findings[1].reproduction_steps).toBeUndefined();
    expect(findings[1].causal_chain).toBeUndefined();
  });

  it('preserves provided evidence at any severity', () => {
    const ctx = parseQaAdversarialPassContext({
      findings: [
        {
          id: 'QA-001',
          title: 't',
          file: 'a.ts',
          description: 'd',
          severity: 'LOW',
          reproduction_steps: ['call foo()', 'observe crash'],
          causal_chain: 'null -> deref -> crash',
        },
      ],
    });
    const [f] = toQaFindings(ctx);
    expect(f.reproduction_steps).toEqual(['call foo()', 'observe crash']);
    expect(f.causal_chain).toBe('null -> deref -> crash');
  });

  it('buildQaAdversarialUserPrompt documents severity-tiered keep criteria', () => {
    const ctx = parseQaAdversarialPassContext({
      findings: [{ id: 'QA-001', title: 't', file: 'a.ts', description: 'd', severity: 'MEDIUM' }],
    });
    const prompt = buildQaAdversarialUserPrompt(ctx, {});
    expect(prompt).toContain('severity-tiered');
    expect(prompt).toContain('MEDIUM / LOW');
    expect(prompt).toContain('HIGH / CRITICAL');
    expect(prompt).not.toMatch(/^\*\*Keep\*\* only if you can produce\/validate both/m);
  });

  it('emptyQaReport has zero findings', () => {
    const r = emptyQaReport('P');
    expect(r.qa_review_report.findings).toEqual([]);
    expect(r.qa_review_report.project_name).toBe('P');
  });
});

describe('usage_counters', () => {
  it('accumulates all four token fields plus turns', () => {
    const counters = emptyUsageCounters();
    accumulateUsage(counters, {
      num_turns: 3,
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 80,
        cache_creation_input_tokens: 20,
      },
    });
    expect(counters).toEqual({
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 80,
      cacheWriteTokens: 20,
      turns: 3,
    });
    const payload = roleResultFromCounters(0.12, counters);
    expect(payload).toEqual({
      total_cost_usd: 0.12,
      tokens_input: 100,
      tokens_output: 50,
      tokens_cache_read: 80,
      tokens_cache_write: 20,
      turns_used: 3,
    });
  });

  it('printUsageCounters emits parent-app scrape lines', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    printUsageCounters({
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
      turns: 4,
    });
    expect(spy).toHaveBeenCalledWith('Tokens input: 10');
    expect(spy).toHaveBeenCalledWith('Tokens output: 5');
    expect(spy).toHaveBeenCalledWith('Cache read: 3');
    expect(spy).toHaveBeenCalledWith('Cache write: 2');
    expect(spy).toHaveBeenCalledWith('Turns used: 4');
    spy.mockRestore();
  });

  /**
   * A batched review prints one per-batch block before the cross-batch summary,
   * and the parent app scrapes with a first-match regex. If the two share labels,
   * the scrape silently reports batch one against a whole-run cost.
   */
  it('printUsageTotals uses labels distinct from the per-batch lines', () => {
    const counters = {
      inputTokens: 220,
      outputTokens: 110,
      cacheReadTokens: 1700,
      cacheWriteTokens: 300,
      turns: 7,
    };

    const perBatchSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    printUsageCounters(counters);
    const perBatch = perBatchSpy.mock.calls.map((c) => String(c[0]));
    perBatchSpy.mockRestore();

    const totalsSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    printUsageTotals(counters);
    const totals = totalsSpy.mock.calls.map((c) => String(c[0]));
    totalsSpy.mockRestore();

    expect(totals).toEqual([
      'Total tokens input: 220',
      'Total tokens output: 110',
      'Total cache read: 1700',
      'Total cache write: 300',
      'Total turns used: 7',
    ]);
    // Same counters, no shared line: the scraper can always tell them apart.
    expect(totals.filter((line) => perBatch.includes(line))).toEqual([]);
  });

  it('printUsageTotals stays silent when nothing was recorded', () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    printUsageTotals(emptyUsageCounters());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
