/**
 * QA adversarial second-pass input (Lane 5) — batch review of pr_qa_reviewer findings.
 *
 * Parent app passes a JSON file; the pr_qa_adversary role returns a filtered
 * `qa_review_report` with only findings that survive the concrete-repro bar.
 *
 * Mirrors `adversarial_pass.ts` (security) with a correctness-specific keep/drop rule.
 */
import type { QaFinding, QaReviewReport } from './qa_report';

export interface QaAdversarialPassContext {
  findings: Array<{
    id: string;
    title: string;
    file: string;
    line_numbers?: string;
    severity?: string;
    confidence?: string;
    bug_class?: string;
    category?: string;
    cwe?: string;
    owasp?: string;
    description: string;
    impact?: string;
    recommendation?: string;
    code_snippet?: string;
    reproduction_steps?: string[];
    causal_chain?: string;
  }>;
  pr_number?: number;
  head_sha?: string;
  metadata?: { project_name?: string };
}

const ALLOWED_SEVERITY = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
const ALLOWED_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

function normalizeSev(s: string | undefined): QaFinding['severity'] {
  const u = (s || 'MEDIUM').toUpperCase();
  return (ALLOWED_SEVERITY.has(u) ? u : 'MEDIUM') as QaFinding['severity'];
}

function normalizeConf(c: string | undefined): QaFinding['confidence'] {
  const u = (c || 'MEDIUM').toUpperCase();
  return (ALLOWED_CONFIDENCE.has(u) ? u : 'MEDIUM') as QaFinding['confidence'];
}

/**
 * Map normalized context findings into `QaFinding` (schema-aligned for prompts).
 */
export function toQaFindings(ctx: QaAdversarialPassContext): QaFinding[] {
  return ctx.findings.map((f, i) => {
    const id =
      typeof f.id === 'string' && /^QA-\d{3}$/.test(f.id)
        ? f.id
        : `QA-${String(i + 1).padStart(3, '0')}`;
    const steps =
      Array.isArray(f.reproduction_steps) && f.reproduction_steps.length > 0
        ? f.reproduction_steps.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
        : ['(missing — adversary must supply concrete steps)'];
    return {
      id,
      title: f.title,
      severity: normalizeSev(f.severity),
      confidence: normalizeConf(f.confidence),
      bug_class: f.bug_class && f.bug_class.trim() ? f.bug_class : 'quality',
      category: f.category,
      file: f.file,
      line_numbers: f.line_numbers,
      cwe: f.cwe,
      owasp: f.owasp,
      description: f.description,
      impact: f.impact || '',
      recommendation: f.recommendation || '',
      code_snippet: f.code_snippet,
      reproduction_steps: steps,
      causal_chain:
        f.causal_chain && f.causal_chain.trim()
          ? f.causal_chain
          : '(missing — adversary must supply x -> y -> z)',
    };
  });
}

/**
 * Parse and validate QA adversarial context JSON (throws on missing required fields).
 */
export function parseQaAdversarialPassContext(data: unknown): QaAdversarialPassContext {
  if (!data || typeof data !== 'object') {
    throw new Error('QA adversarial context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.findings)) {
    throw new Error('QA adversarial context must include a "findings" array');
  }
  if (o.findings.length > 500) {
    throw new Error('QA adversarial pass supports at most 500 findings per run');
  }
  for (const item of o.findings) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each finding must be an object');
    }
    const f = item as Record<string, unknown>;
    for (const k of ['id', 'title', 'file', 'description'] as const) {
      if (typeof f[k] !== 'string' || !String(f[k]).trim()) {
        throw new Error(`Each finding must have a non-empty string "${k}"`);
      }
    }
  }
  return {
    findings: o.findings as QaAdversarialPassContext['findings'],
    pr_number: typeof o.pr_number === 'number' ? o.pr_number : undefined,
    head_sha: typeof o.head_sha === 'string' ? o.head_sha : undefined,
    metadata:
      o.metadata && typeof o.metadata === 'object'
        ? {
            project_name:
              typeof (o.metadata as { project_name?: string }).project_name === 'string'
                ? (o.metadata as { project_name: string }).project_name
                : undefined,
          }
        : undefined,
  };
}

/**
 * Build the user message for the pr_qa_adversary role.
 */
export function buildQaAdversarialUserPrompt(
  ctx: QaAdversarialPassContext,
  opts: { diffExcerpt?: string; additionalContext?: string },
): string {
  const lines: string[] = [
    '## QA adversarial concrete-repro review (second pass)',
    '',
    'You are given candidate correctness findings from an initial PR QA scan. For each finding, you must either **keep** it or **drop** it.',
    '',
    '**Keep** only if you can produce/validate both `reproduction_steps` and `causal_chain` that together show:',
    '1. A **specific input, state, or call sequence** that triggers the bug',
    '2. A **concrete incorrect outcome** (crash, wrong value, resource leak, hang, unhandled rejection — not a style preference)',
    '3. **Reachability on a changed line** in the PR diff (the buggy path is introduced or exercised by this change)',
    '',
    '**Drop** the finding if it is vague, stylistic, "could theoretically" fail, already mitigated by code you can see, test-only noise, or you cannot name concrete reproduction_steps + causal_chain.',
    '',
    'Return one JSON object matching the required `qa_review_report` schema. Include **only** findings that pass this bar. Recompute `summary` counts to match the filtered `findings` list. If none survive, return empty `findings` and zero counts. Preserve `QA-NNN` ids for kept findings; refresh reproduction_steps / causal_chain when you improve them.',
    '',
  ];

  if (opts.diffExcerpt) {
    lines.push('### PR diff (for context)');
    lines.push(opts.diffExcerpt);
    lines.push('');
  }

  if (ctx.pr_number != null) {
    lines.push(`**PR #:** ${ctx.pr_number}`);
  }
  if (ctx.head_sha) {
    lines.push(`**Head SHA:** ${ctx.head_sha}`);
  }
  if (ctx.metadata?.project_name) {
    lines.push(`**Project:** ${ctx.metadata.project_name}`);
  }
  if (ctx.pr_number != null || ctx.head_sha || ctx.metadata?.project_name) {
    lines.push('');
  }

  if (opts.additionalContext) {
    lines.push('### Project / deployment context (from integrator)');
    lines.push(opts.additionalContext);
    lines.push('');
  }

  lines.push('### Candidate findings (input)');
  lines.push('```json');
  lines.push(JSON.stringify({ findings: toQaFindings(ctx) }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(
    'Analyze with Read/Grep against the source tree as needed, then output the filtered qa_review_report JSON only (structured output).',
  );

  return lines.join('\n');
}

/** Empty report shell for tests / fallbacks. */
export function emptyQaReport(projectName?: string): QaReviewReport {
  return {
    qa_review_report: {
      project_name: projectName,
      review_date: new Date().toISOString().slice(0, 10),
      reviewer: 'Code Quality Analysis',
      summary: {
        total_issues_found: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        overall_risk_level: 'NONE',
      },
      findings: [],
    },
  };
}
