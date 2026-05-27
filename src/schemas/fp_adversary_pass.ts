/**
 * fp_adversary second-pass input/output (v2.8.0) — full-repo review false-positive filter.
 *
 * Used by sast-ai-app Lane-2 (full-repo scheduled scans) Phase 2.5. Parent app
 * passes a JSON file containing candidate findings from the first-pass
 * `code_reviewer` plus structured project posture inputs sourced from the
 * `projects.*_context` columns and an optional `similar_dismissed` array
 * (top-3 prior dismissals for the same CWE, pre-built via the parent app's
 * `queryFindingsHistory` MCP tool).
 *
 * Output schema is deliberately distinct from `SECURITY_REPORT_SCHEMA` so the
 * verdict contract (`fingerprint`, `verdict`, numeric `confidence`,
 * `rationale`, optional `cost_usd_estimate`) is locked down separately from
 * the primary security-report shape that may drift across model upgrades.
 * Each verdict round-trips on `fingerprint` so the parent app maps verdicts
 * back to its `repo_finding_ledger` rows without depending on string IDs.
 *
 * Decision rationale: see [docs/FULL_REPO_REVIEW_QUALITY_PLAN.md] §6 and the
 * sibling sast-ai-app plan (Phase 2.5, G1 — Option (a) "separate schema").
 */

export interface FpAdversaryPassFinding {
  /**
   * Stable parent-app fingerprint (sha256 of `cwe + file + normalised
   * snippet + line range`). Required — the round-trip key the parent app
   * uses to map each verdict back to its ledger row.
   */
  fingerprint: string;
  id?: string;
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
}

export interface FpAdversaryPassContext {
  findings: FpAdversaryPassFinding[];
  /** Free-form summary of the repo's purpose, tech stack, primary entry points. */
  project_summary?: string;
  /** Concrete security mechanisms in use: libraries, middleware, auth patterns. */
  security_context?: string;
  /** Deployment posture: hosted/self-hosted, network exposure, multi-tenant model. */
  deployment_context?: string;
  /** Security-relevant developer guidance: PHI handling rules, SQL injection conventions. */
  developer_context?: string;
  /**
   * Top-3 similar dismissed findings (pre-built by parent app via
   * `queryFindingsHistory`). The adversary uses these as a precedent
   * check: "this CWE was dismissed before for {reason} — does that apply?"
   */
  similar_dismissed?: Array<{
    fingerprint: string;
    file: string;
    cwe?: string;
    dismissal_reason?: string;
  }>;
  metadata?: { project_name?: string };
}

export interface FpAdversaryVerdict {
  /** Round-trip key matching one of the input findings' fingerprints. */
  fingerprint: string;
  verdict: 'confirm' | 'dismiss';
  /** 0.0 (no confidence) — 1.0 (highest confidence). */
  confidence: number;
  /** ≤500-char justification surfaced in the auto_dismissed_findings audit row. */
  rationale: string;
  /**
   * Threaded through from the Claude Agent SDK's `total_cost_usd` so the
   * parent app's cost-cap accumulator can stop the loop deterministically
   * without re-counting tokens. Optional for backward-compat.
   */
  cost_usd_estimate?: number;
}

export interface FpAdversaryReport {
  fp_adversary_report: {
    verdicts: FpAdversaryVerdict[];
  };
}

/**
 * JSON Schema enforced by the Claude Agent SDK at generation time.
 *
 * The schema deliberately allows zero verdicts (an empty findings input → empty
 * verdicts output) and requires every verdict to round-trip on `fingerprint`
 * so the parent app can detect schema violations without per-finding heuristics.
 */
export const FP_ADVERSARY_REPORT_SCHEMA = {
  type: 'object',
  required: ['fp_adversary_report'],
  additionalProperties: false,
  properties: {
    fp_adversary_report: {
      type: 'object',
      required: ['verdicts'],
      additionalProperties: false,
      properties: {
        verdicts: {
          type: 'array',
          items: {
            type: 'object',
            required: ['fingerprint', 'verdict', 'confidence', 'rationale'],
            additionalProperties: false,
            properties: {
              fingerprint: {
                type: 'string',
                description:
                  "Round-trip key matching one of the input findings' fingerprints. Required.",
              },
              verdict: {
                type: 'string',
                enum: ['confirm', 'dismiss'],
                description:
                  '`confirm` keeps the finding in scan_findings; `dismiss` routes it to auto_dismissed_findings (subject to confidence threshold + severity floor on the parent side).',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description:
                  'Numeric 0.0-1.0 (NOT enum HIGH/MED/LOW). Drives the auto-dismiss vs pre_dismissed branch on the parent side.',
              },
              rationale: {
                type: 'string',
                maxLength: 500,
                description:
                  'Plain-English justification surfaced in the auto_dismissed_findings audit row + Restore UI.',
              },
              cost_usd_estimate: {
                type: 'number',
                minimum: 0,
                description:
                  "Per-finding USD cost threaded from agent-run's SDK output. Optional for backward-compat.",
              },
            },
          },
        },
      },
    },
  },
} as const;

const MAX_FINDINGS_PER_RUN = 500;

/**
 * Parse and validate the fp_adversary input JSON.
 *
 * Required: top-level `findings` array, each with non-empty `fingerprint`,
 * `title`, `file`, `description`. Other fields are normalized but not required.
 * Throws on invalid input — the CLI dispatcher in `main.ts` catches and exits 1.
 */
export function parseFpAdversaryPassContext(data: unknown): FpAdversaryPassContext {
  if (!data || typeof data !== 'object') {
    throw new Error('fp_adversary context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.findings)) {
    throw new Error('fp_adversary context must include a "findings" array');
  }
  if (o.findings.length > MAX_FINDINGS_PER_RUN) {
    throw new Error(`fp_adversary supports at most ${MAX_FINDINGS_PER_RUN} findings per run`);
  }
  for (const item of o.findings) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each finding must be an object');
    }
    const f = item as Record<string, unknown>;
    for (const k of ['fingerprint', 'title', 'file', 'description'] as const) {
      if (typeof f[k] !== 'string' || !String(f[k]).trim()) {
        throw new Error(`Each finding must have a non-empty string "${k}"`);
      }
    }
  }

  const optionalString = (key: string): string | undefined => {
    const v = o[key];
    return typeof v === 'string' && v.trim() ? v : undefined;
  };

  let similarDismissed: FpAdversaryPassContext['similar_dismissed'];
  if (Array.isArray(o.similar_dismissed)) {
    similarDismissed = [];
    for (const item of o.similar_dismissed) {
      if (!item || typeof item !== 'object') continue;
      const s = item as Record<string, unknown>;
      if (typeof s.fingerprint !== 'string' || !s.fingerprint.trim()) continue;
      if (typeof s.file !== 'string' || !s.file.trim()) continue;
      similarDismissed.push({
        fingerprint: s.fingerprint,
        file: s.file,
        cwe: typeof s.cwe === 'string' ? s.cwe : undefined,
        dismissal_reason:
          typeof s.dismissal_reason === 'string' ? s.dismissal_reason : undefined,
      });
    }
  }

  return {
    findings: o.findings as FpAdversaryPassContext['findings'],
    project_summary: optionalString('project_summary'),
    security_context: optionalString('security_context'),
    deployment_context: optionalString('deployment_context'),
    developer_context: optionalString('developer_context'),
    similar_dismissed: similarDismissed,
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
 * Normalize fingerprint-keyed findings into a stable shape for the prompt's
 * JSON block. Mirrors `toSecurityFindings` for `pr_adversary` but preserves
 * the parent-app `fingerprint` field that drives the verdict round-trip.
 */
export function toFpAdversaryFindings(
  ctx: FpAdversaryPassContext,
): Array<{
  fingerprint: string;
  title: string;
  severity: string;
  confidence: string;
  category: string;
  file: string;
  line_numbers?: string;
  cwe_id?: string;
  cwe?: string;
  description: string;
  recommendation: string;
  code_snippet?: string;
  impact?: string;
}> {
  const ALLOWED_SEVERITY = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
  const ALLOWED_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);
  return ctx.findings.map((f) => {
    const sev = (f.severity || 'MEDIUM').toUpperCase();
    const conf = (f.confidence || 'MEDIUM').toUpperCase();
    return {
      fingerprint: f.fingerprint,
      title: f.title,
      severity: ALLOWED_SEVERITY.has(sev) ? sev : 'MEDIUM',
      confidence: ALLOWED_CONFIDENCE.has(conf) ? conf : 'MEDIUM',
      category: f.category && f.category.trim() ? f.category : 'Security',
      file: f.file,
      line_numbers: f.line_numbers,
      cwe_id: f.cwe_id,
      cwe: f.cwe,
      description: f.description,
      recommendation: f.recommendation || '',
      code_snippet: f.code_snippet,
      impact: f.impact,
    };
  });
}

/**
 * Build the user message for the fp_adversary role.
 *
 * Layout:
 *   1. Adversarial-review framing (verdict criteria, threshold guidance).
 *   2. `### Project posture (from extraction)` block with the four
 *      structured context fields if present (precedes the integrator's `-c`
 *      additional context to keep parent-app posture authoritative).
 *   3. `-c` additional context block.
 *   4. Similar-dismissed precedent block (if any).
 *   5. Candidate findings JSON.
 */
export function buildFpAdversaryUserPrompt(
  ctx: FpAdversaryPassContext,
  opts: { additionalContext?: string } = {},
): string {
  const lines: string[] = [
    '## Adversarial false-positive review (full-repo, second pass)',
    '',
    'You are given candidate findings from an initial full-repo security scan. For each finding, return a verdict: **confirm** (a real, exploitable issue) or **dismiss** (a likely false positive).',
    '',
    '**Confirm** only when you can name a *concrete failure path*: a plausible input or trigger, the relevant call site in the repo, and a security-relevant outcome (data leak, RCE, auth bypass, privilege escalation, etc.). Use Read/Grep to verify reachability.',
    '**Dismiss** when the finding is vague, already mitigated by code you can see, test-only/example code, configuration-only with no production impact, or you cannot name a specific exploit or failure path.',
    '',
    'For each verdict provide:',
    '- `fingerprint` — copy verbatim from the input.',
    '- `verdict` — `confirm` or `dismiss`.',
    '- `confidence` — numeric 0.0–1.0. Use ≥0.85 for dismissals only when the evidence is strong (mitigation seen, code is test-only, etc.). Lower values route the finding to a pre-dismissed UI state instead of full auto-dismissal on the parent side.',
    '- `rationale` — ≤500 chars. State the concrete evidence (which file, which mitigation, which reachability gap).',
    '',
    'Return one JSON object matching the `fp_adversary_report` schema. Include exactly one verdict per input finding; missing verdicts are treated as `confirm` by the parent app (no silent drops).',
    '',
  ];

  const posture: string[] = [];
  if (ctx.project_summary) posture.push(`**Project summary:**\n${ctx.project_summary}`);
  if (ctx.security_context) posture.push(`**Security context:**\n${ctx.security_context}`);
  if (ctx.deployment_context)
    posture.push(`**Deployment context:**\n${ctx.deployment_context}`);
  if (ctx.developer_context) posture.push(`**Developer context:**\n${ctx.developer_context}`);
  if (posture.length > 0) {
    lines.push('### Project posture (from extraction)');
    lines.push(...posture);
    lines.push('');
    lines.push(
      'Weight the posture above when assessing each finding: e.g., if `security_context` names a parameterized-query library, a SQL-injection finding on that path should require concrete evidence of bypass before confirming.',
    );
    lines.push('');
  }

  if (opts.additionalContext) {
    lines.push('### Additional context (from integrator)');
    lines.push(opts.additionalContext);
    lines.push('');
  }

  if (ctx.similar_dismissed && ctx.similar_dismissed.length > 0) {
    lines.push('### Similar prior dismissals (precedent)');
    lines.push(
      'These fingerprints were previously dismissed on this project. If a candidate finding mirrors the pattern, consider the same dismissal — but verify the code still matches.',
    );
    for (const s of ctx.similar_dismissed) {
      const cweTag = s.cwe ? `, CWE=${s.cwe}` : '';
      const reasonTag = s.dismissal_reason ? ` — ${s.dismissal_reason}` : '';
      lines.push(`- \`${s.fingerprint}\` (${s.file}${cweTag})${reasonTag}`);
    }
    lines.push('');
  }

  if (ctx.metadata?.project_name) {
    lines.push(`**Project:** ${ctx.metadata.project_name}`);
    lines.push('');
  }

  lines.push('### Candidate findings (input)');
  lines.push('```json');
  lines.push(JSON.stringify({ findings: toFpAdversaryFindings(ctx) }, null, 2));
  lines.push('```');
  lines.push('');
  lines.push(
    'Analyze with Read/Grep against the source tree (and MCP tools if available — queryImportGraph for reachability, queryCodebaseGraph for callers/callees, queryRuntimeEnrichment for runtime-incident overlap) as needed, then output the verdict array JSON only (structured output).',
  );

  return lines.join('\n');
}

/** Empty report shell for tests / fallbacks. */
export function emptyFpAdversaryReport(): FpAdversaryReport {
  return { fp_adversary_report: { verdicts: [] } };
}
