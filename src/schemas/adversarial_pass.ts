/**
 * Adversarial second-pass input (v5.3.0) — batch review of pr_reviewer findings.
 *
 * Parent app passes a JSON file; the pr_adversary role returns a filtered
 * `security_review_report` with only findings that survive failure-path scrutiny.
 */
import type { SecurityFinding, SecurityReviewReport } from './security_report';

export interface AdversarialPassContext {
  findings: Array<{
    id: string;
    title: string;
    file: string;
    line_numbers?: string;
    severity?: string;
    confidence?: string;
    category?: string;
    cwe_id?: string;
    cwe?: string;
    description: string;
    recommendation?: string;
    code_snippet?: string;
    impact?: string;
  }>;
  pr_number?: number;
  head_sha?: string;
  metadata?: { project_name?: string };
}

const ALLOWED_SEVERITY = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const ALLOWED_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);

function normalizeSev(s: string | undefined): SecurityFinding['severity'] {
  const u = (s || 'MEDIUM').toUpperCase();
  return (ALLOWED_SEVERITY.has(u) ? u : 'MEDIUM') as SecurityFinding['severity'];
}

function normalizeConf(c: string | undefined): SecurityFinding['confidence'] {
  const u = (c || 'MEDIUM').toUpperCase();
  return (ALLOWED_CONFIDENCE.has(u) ? u : 'MEDIUM') as SecurityFinding['confidence'];
}

/**
 * Map normalized context findings into `SecurityFinding` (schema-aligned for prompts).
 */
export function toSecurityFindings(ctx: AdversarialPassContext): SecurityFinding[] {
  return ctx.findings.map((f) => ({
    id: f.id,
    title: f.title,
    severity: normalizeSev(f.severity),
    confidence: normalizeConf(f.confidence),
    category: f.category && f.category.trim() ? f.category : 'Security',
    file: f.file,
    line_numbers: f.line_numbers,
    cwe_id: f.cwe_id,
    cwe: f.cwe,
    description: f.description,
    recommendation: f.recommendation || '',
    code_snippet: f.code_snippet,
    impact: f.impact,
  }));
}

/**
 * Parse and validate adversarial context JSON (throws on missing required fields).
 */
export function parseAdversarialPassContext(data: unknown): AdversarialPassContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Adversarial context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.findings)) {
    throw new Error('Adversarial context must include a "findings" array');
  }
  if (o.findings.length > 500) {
    throw new Error('Adversarial pass supports at most 500 findings per run');
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
    findings: o.findings as AdversarialPassContext['findings'],
    pr_number: typeof o.pr_number === 'number' ? o.pr_number : undefined,
    head_sha: typeof o.head_sha === 'string' ? o.head_sha : undefined,
    metadata:
      o.metadata && typeof o.metadata === 'object'
        ? { project_name: typeof (o.metadata as { project_name?: string }).project_name === 'string'
            ? (o.metadata as { project_name: string }).project_name
            : undefined }
        : undefined,
  };
}

/**
 * Build the user message for the pr_adversary role.
 */
export function buildAdversarialUserPrompt(
  ctx: AdversarialPassContext,
  opts: { diffExcerpt?: string; additionalContext?: string },
): string {
  const lines: string[] = [
    '## Adversarial failure-path review (second pass)',
    '',
    'You are given candidate findings from an initial PR security scan. For each finding, you must either **keep** it or **drop** it.',
    '',
    '**Keep** only if you can state a *concrete failure path*: a plausible input or trigger, the relevant call site in the changed code, and a security-relevant outcome (e.g. data leak, RCE, auth bypass).',
    '**Drop** the finding if it is vague, already mitigated by code you can see, test-only, or you cannot name a specific exploit or failure path.',
    '',
    'Return one JSON object matching the required `security_review_report` schema. Include **only** findings that pass this bar. Recompute `executive_summary` counts to match the filtered `findings` list. If none survive, return empty `findings` and zero counts.',
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
  lines.push(JSON.stringify({ findings: toSecurityFindings(ctx) }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('Analyze with Read/Grep against the source tree as needed, then output the filtered report JSON only (structured output).');

  return lines.join('\n');
}

/** Empty report shell for tests / fallbacks. */
export function emptySecurityReport(projectName?: string): SecurityReviewReport {
  return {
    security_review_report: {
      metadata: {
        project_name: projectName,
        scan_type: 'adversarial_pass',
        total_issues_found: 0,
      },
      executive_summary: {
        overview: 'No findings passed adversarial review.',
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
      },
      findings: [],
    },
  };
}
