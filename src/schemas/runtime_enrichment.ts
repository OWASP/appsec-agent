/**
 * Runtime-enrichment context input (v2.3.0 / sast-ai-app plan §4 + §8.14) —
 * per-file production-incident summary passed to `pr_reviewer` so the LLM can
 * factor incident history into its severity + confidence calls.
 *
 * The authoritative post-LLM gate override lives in the parent app
 * (`sast-ai-app/backend/src/routes/prScanProcessor.ts` — partition findings
 * into hot/cold and apply the §4 transform `medium → low / 0.6 → 0.4` per
 * file). The context here is advisory — it lets the LLM see what the
 * post-pass will see and avoid raising HIGH-confidence findings on
 * operationally-fragile files that the gate-override will then have to
 * "rescue" anyway, AND avoid suppressing low-severity findings on hot files
 * that the gate-override expects to surface.
 *
 * Shape mirrors the v5.4.0 import-graph and v5.3.0 adversarial patterns
 * exactly: the backend composes a JSON file, the agent parses + formats
 * into the `pr_reviewer` user prompt, no HTTP call at agent runtime.
 *
 * §8.5 PHI gate: this file is the LLM-facing surface where PHI exposure
 * could occur. The contract is that the parent app's
 * `runtimeEnrichmentService.buildEnrichmentForChangedFiles` only emits
 * file-path + incident-count + last-seen-date — no incident bodies, no
 * stack traces, no request payloads. This schema enforces the same: only
 * those three fields are accepted; any extras are silently dropped.
 */

export interface RuntimeEnrichmentFileEntry {
  /** Repository-relative file path. Must be non-empty after trimming. */
  file: string;
  /**
   * Number of distinct production incidents associated with the file in
   * the parent app's recording window. Coerced to a non-negative integer
   * (fractional values floored, negatives clamped to 0).
   */
  incident_count: number;
  /**
   * Optional ISO-8601 date string for the most-recent incident (e.g.
   * `2026-04-20`). When absent the formatter omits the "(last seen ...)"
   * suffix so the LLM doesn't see a confusing "(last seen unknown)".
   */
  last_seen_at?: string;
}

export interface RuntimeEnrichmentContext {
  /** Optional default-branch SHA the parent app's hot-file list was anchored to. */
  default_branch_sha?: string;
  /**
   * Optional ISO-8601 timestamp recorded when the parent app composed
   * this payload. Useful for forensic debugging if the soak shows
   * unexpected behavior; not surfaced in the prompt.
   */
  parsed_at?: string;
  /**
   * Per-file rows — already filtered by the parent app to only the
   * files in the current PR's changed-file set, so the LLM sees a
   * compact "files touched by this PR with prod incidents" slice.
   * Empty array means "enrichment configured but no overlap" — the
   * formatter short-circuits to empty string in that case.
   */
  files: RuntimeEnrichmentFileEntry[];
  /** Optional metadata block for forensic/debug correlation; not surfaced in prompt. */
  metadata?: { project_name?: string };
}

const MAX_FILES = 500;

/**
 * Parse and validate a runtime-enrichment context JSON payload (throws on
 * structural error). The parent-app contract caps hot-file lists at 10k
 * rows, but only files-overlapping-the-PR are passed in, so 500 is the
 * generous-but-safe ceiling here (matches the import-graph cap exactly).
 */
export function parseRuntimeEnrichmentContext(data: unknown): RuntimeEnrichmentContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Runtime-enrichment context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.files)) {
    throw new Error('Runtime-enrichment context must include a "files" array');
  }
  if (o.files.length > MAX_FILES) {
    throw new Error(`Runtime-enrichment context supports at most ${MAX_FILES} files per run`);
  }
  const files: RuntimeEnrichmentFileEntry[] = [];
  for (const item of o.files) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each runtime-enrichment file entry must be an object');
    }
    const f = item as Record<string, unknown>;
    if (typeof f.file !== 'string' || !f.file.trim()) {
      throw new Error('Each runtime-enrichment file entry must have a non-empty string "file"');
    }
    if (typeof f.incident_count !== 'number' || !Number.isFinite(f.incident_count)) {
      throw new Error('Each runtime-enrichment file entry must have a numeric "incident_count"');
    }
    files.push({
      file: String(f.file),
      incident_count: Math.max(0, Math.trunc(f.incident_count)),
      last_seen_at:
        typeof f.last_seen_at === 'string' && f.last_seen_at.trim()
          ? f.last_seen_at
          : undefined,
    });
  }
  return {
    default_branch_sha: typeof o.default_branch_sha === 'string' ? o.default_branch_sha : undefined,
    parsed_at: typeof o.parsed_at === 'string' ? o.parsed_at : undefined,
    files,
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
 * Format the context for inclusion in a PR-reviewer user prompt. Compact by
 * design — the post-LLM gate override is the authoritative path, so this
 * advisory block should consume far less prompt budget than the diff itself.
 *
 * Files are rendered most-incident-heavy first to anchor the LLM's
 * attention on the strongest-signal files when the prompt is truncated.
 */
export function formatRuntimeEnrichmentContextForPrompt(ctx: RuntimeEnrichmentContext): string {
  if (ctx.files.length === 0) {
    return '';
  }
  // Sort: most-incident-heavy first (mirrors the parent app's
  // buildEnrichmentForChangedFiles ordering so the LLM and the
  // gate-override see the same priority).
  const sorted = [...ctx.files].sort((a, b) => b.incident_count - a.incident_count);
  const lines: string[] = [];
  lines.push('### Runtime-signal context (production incidents, plan §4)');
  lines.push(
    'The post-LLM gate override will lower `min_severity_to_post` by one notch (e.g. `medium → low`) and `min_confidence_to_post` by 0.2 (e.g. `0.6 → 0.4`) for findings on the files below. Treat these files as operationally fragile: be more willing to surface medium-severity issues on them, and avoid downranking findings on them just because the failure path is uncertain — runtime evidence corroborates that bugs here are more real *and* more likely to actually fire.',
  );
  if (ctx.default_branch_sha) {
    lines.push(`Hot-file list anchored to default-branch SHA \`${ctx.default_branch_sha.slice(0, 12)}\`.`);
  }
  lines.push('');
  lines.push('| File | Incidents | Last seen |');
  lines.push('|---|---:|:---:|');
  for (const f of sorted) {
    const lastSeen = f.last_seen_at ? f.last_seen_at : '—';
    lines.push(`| \`${f.file}\` | ${f.incident_count} | ${lastSeen} |`);
  }
  lines.push('');
  return lines.join('\n');
}
