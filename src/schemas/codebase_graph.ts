/**
 * Codebase-graph context input (v2.6.0 / sast-ai-app plan §8.18 Phase 2) —
 * per-changed-file structural-graph summary passed to `pr_reviewer` so the LLM
 * can factor symbol-level callers/callees and downstream blast-radius into its
 * severity + confidence calls.
 *
 * Distinct from `--import-graph-context` (file-level inbound import counts via
 * SCIP). This context is *symbol-level* (cbm tree-sitter graph; 155 languages):
 *   - `callers`        — qualified symbol names whose body invokes a symbol
 *                        defined in the changed file.
 *   - `callees`        — qualified symbol names invoked from a symbol defined
 *                        in the changed file.
 *   - `blast_radius_files_count` — number of unique files reachable via
 *                        outbound CALLS edges within the configured depth.
 *
 * The parent app's `composeCodebaseGraphContextPayload`
 * (`sast-ai-app/backend/src/services/codebaseGraph/`) does the cbm MCP queries
 * (`search_graph` to find symbols defined in each changed file →
 * `trace_path(direction=both, mode=calls, depth=2)` per symbol) and writes the
 * JSON file. The agent here only parses + formats it for the prompt — no MCP
 * query at agent runtime (Phase 3 is the live-MCP variant).
 *
 * Shape mirrors the v5.4.0 import-graph and v2.3.0 runtime-enrichment patterns
 * exactly so that `prScanProcessor` can reuse the same fail-open + size-cap +
 * coverage tagging conventions across all three structural-context families.
 *
 * **§8.5 PHI gate**: cbm sees only source-code text from CapsuleHealth-owned
 * repos (no PHI). The schema accepts only structural-edge fields; any extras
 * on per-file entries are silently dropped (mirrors runtime-enrichment's PHI
 * minimization invariant defensively, even though cbm's input surface
 * cannot contain PHI by construction).
 */

export interface CodebaseGraphFileEntry {
  /** Repository-relative file path. Must be non-empty after trimming. */
  file: string;
  /**
   * Optional list of qualified symbol names defined in this file that the PR
   * actually changes. When present, the parent app scoped the
   * callers/callees query to these symbols only (instead of every symbol
   * defined in the file). Truncated at 20 to bound the prompt budget.
   */
  symbols_changed?: string[];
  /**
   * Inbound callers — qualified symbol names whose body invokes a symbol
   * defined in this file. Truncated at 20 (most-popular first per the
   * parent app's ranking) so the most structurally-important callers
   * survive the prompt-budget cap.
   */
  callers?: string[];
  /**
   * Outbound callees — qualified symbol names invoked from any symbol
   * defined in this file. Same truncation contract as `callers`.
   */
  callees?: string[];
  /**
   * Number of unique files reachable from this file via outbound CALLS
   * edges within the parent app's configured `trace_path` depth (default
   * 2). The LLM uses this as a "blast radius" signal — high counts
   * indicate the changed file sits structurally upstream of much of the
   * codebase, so a regression here propagates broadly.
   *
   * Coerced to a non-negative integer (fractional values floored,
   * negatives clamped to 0).
   */
  blast_radius_files_count: number;
  /**
   * Per-file resolution outcome:
   *   - `ok`         — symbols found in cbm graph; callers/callees populated
   *                    from `trace_path` results.
   *   - `no_symbols` — file is in the changed set but cbm's `search_graph`
   *                    returned no Function/Method nodes for it (data file,
   *                    config, generated code, language not in cbm's 155).
   *   - `missing`    — cbm artifact for the project's current head SHA was
   *                    not found on the PVC; the parent app's load step
   *                    short-circuited with an empty entry per file.
   *   - `partial`    — at least one `trace_path` query failed (cbm
   *                    transient error, depth limit, or query timeout); the
   *                    callers/callees lists may be incomplete.
   */
  graph_status?: 'ok' | 'no_symbols' | 'missing' | 'partial';
}

export interface CodebaseGraphContext {
  /** Optional default-branch SHA the cbm artifact was indexed from. */
  default_branch_sha?: string;
  /**
   * Optional ISO-8601 timestamp recorded when the parent app composed
   * this payload. Useful for forensic debugging if the soak shows
   * unexpected behavior; not surfaced in the prompt.
   */
  parsed_at?: string;
  /**
   * Roll-up resolution status across all files in the request:
   *   - `full`    — every changed file was found in the cbm graph and at
   *                 least one symbol traced.
   *   - `partial` — some files traced cleanly, others were `no_symbols` or
   *                 `partial`.
   *   - `none`    — the cbm artifact was loaded but no changed file
   *                 produced traceable symbols (highly unusual; surface
   *                 to ops via `coverage` panel).
   *   - `empty`   — the parent app could not load a cbm artifact for the
   *                 current head SHA (`codebase_graph_heads` row missing
   *                 or stale). Fail-open; the LLM ignores this block.
   */
  coverage?: 'full' | 'partial' | 'none' | 'empty';
  /**
   * Per-file rows — already filtered by the parent app to the PR's
   * changed-file set, so the LLM sees a compact "files touched by this
   * PR with their structural-graph context" slice. Empty array means
   * "graph configured but no overlap" — the formatter short-circuits
   * to empty string in that case.
   */
  files: CodebaseGraphFileEntry[];
  /** Optional metadata block for forensic/debug correlation; not surfaced in prompt. */
  metadata?: { project_name?: string };
}

const MAX_FILES = 500;
const MAX_CALLERS_PER_FILE = 20;
const MAX_CALLEES_PER_FILE = 20;
const MAX_SYMBOLS_PER_FILE = 20;

const VALID_GRAPH_STATUSES = new Set<CodebaseGraphFileEntry['graph_status']>([
  'ok',
  'no_symbols',
  'missing',
  'partial',
]);

const VALID_COVERAGE_VALUES = new Set<CodebaseGraphContext['coverage']>([
  'full',
  'partial',
  'none',
  'empty',
]);

const sanitizeStringArray = (input: unknown, cap: number): string[] | undefined => {
  if (!Array.isArray(input)) {
    return undefined;
  }
  const cleaned = (input as unknown[])
    .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
    .slice(0, cap);
  return cleaned.length > 0 ? cleaned : undefined;
};

/**
 * Parse and validate a codebase-graph context JSON payload (throws on
 * structural error). Caps mirror import-graph (500 files, 20 callers per
 * file) so the prompt-budget worst case is symmetric across the two
 * structural contexts.
 */
export function parseCodebaseGraphContext(data: unknown): CodebaseGraphContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Codebase-graph context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.files)) {
    throw new Error('Codebase-graph context must include a "files" array');
  }
  if (o.files.length > MAX_FILES) {
    throw new Error(`Codebase-graph context supports at most ${MAX_FILES} files per run`);
  }
  const files: CodebaseGraphFileEntry[] = [];
  for (const item of o.files) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each codebase-graph file entry must be an object');
    }
    const f = item as Record<string, unknown>;
    if (typeof f.file !== 'string' || !f.file.trim()) {
      throw new Error('Each codebase-graph file entry must have a non-empty string "file"');
    }
    if (
      typeof f.blast_radius_files_count !== 'number' ||
      !Number.isFinite(f.blast_radius_files_count)
    ) {
      throw new Error(
        'Each codebase-graph file entry must have a numeric "blast_radius_files_count"',
      );
    }
    const graphStatus =
      typeof f.graph_status === 'string' &&
      VALID_GRAPH_STATUSES.has(f.graph_status as CodebaseGraphFileEntry['graph_status'])
        ? (f.graph_status as CodebaseGraphFileEntry['graph_status'])
        : undefined;
    files.push({
      file: String(f.file),
      symbols_changed: sanitizeStringArray(f.symbols_changed, MAX_SYMBOLS_PER_FILE),
      callers: sanitizeStringArray(f.callers, MAX_CALLERS_PER_FILE),
      callees: sanitizeStringArray(f.callees, MAX_CALLEES_PER_FILE),
      blast_radius_files_count: Math.max(0, Math.trunc(f.blast_radius_files_count)),
      graph_status: graphStatus,
    });
  }
  const coverage =
    typeof o.coverage === 'string' &&
    VALID_COVERAGE_VALUES.has(o.coverage as CodebaseGraphContext['coverage'])
      ? (o.coverage as CodebaseGraphContext['coverage'])
      : undefined;
  return {
    default_branch_sha: typeof o.default_branch_sha === 'string' ? o.default_branch_sha : undefined,
    parsed_at: typeof o.parsed_at === 'string' ? o.parsed_at : undefined,
    coverage,
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
 * design — symbol lists are truncated and the table renders only the most
 * structurally-significant signals so the block stays well under the
 * import-graph + runtime-enrichment budget envelope.
 *
 * Files are rendered most-blast-radius first to anchor the LLM's attention
 * on the structurally-upstream files when the prompt is truncated.
 */
export function formatCodebaseGraphContextForPrompt(ctx: CodebaseGraphContext): string {
  if (ctx.files.length === 0) {
    return '';
  }
  const sorted = [...ctx.files].sort(
    (a, b) => b.blast_radius_files_count - a.blast_radius_files_count,
  );
  const lines: string[] = [];
  lines.push('### Codebase-graph context (symbol-level callers/callees, plan §8.18 Phase 2)');
  lines.push(
    'For each changed file below, the parent app queried the codebase-memory-mcp graph for symbols defined in the file and traced their inbound (callers) and outbound (callees) CALLS edges. Use this as a structural-impact signal: a high `blast radius` means a regression in the file propagates to many downstream files; a non-empty `callers` list means the changed code is reached by other code paths and is more likely to fire under realistic traffic.',
  );
  lines.push(
    'Treat this as advisory — when callers ≥ 1 and blast radius ≥ 5, lean toward keeping medium/high-severity findings on the file even if the diff alone looks low-risk. When `graph_status` is `no_symbols` (data file, generated code, unsupported language), structural reach is not measurable from this signal — fall back to your default judgment.',
  );
  if (ctx.default_branch_sha) {
    lines.push(
      `Graph built from default-branch SHA \`${ctx.default_branch_sha.slice(0, 12)}\`.`,
    );
  }
  if (ctx.coverage && ctx.coverage !== 'full') {
    lines.push(
      `_Coverage: **${ctx.coverage}** — entries with \`graph_status=missing\` or \`partial\` will **not** be downranked (fail-open)._`,
    );
  }
  lines.push('');
  lines.push('| File | Callers | Callees | Blast radius | Status |');
  lines.push('|---|---|---|---:|:---:|');
  for (const f of sorted) {
    const status = f.graph_status ?? 'ok';
    const callers =
      f.callers && f.callers.length > 0
        ? f.callers
            .slice(0, 3)
            .map((c) => `\`${c}\``)
            .join(', ') + (f.callers.length > 3 ? ` (+${f.callers.length - 3})` : '')
        : '—';
    const callees =
      f.callees && f.callees.length > 0
        ? f.callees
            .slice(0, 3)
            .map((c) => `\`${c}\``)
            .join(', ') + (f.callees.length > 3 ? ` (+${f.callees.length - 3})` : '')
        : '—';
    lines.push(
      `| \`${f.file}\` | ${callers} | ${callees} | ${f.blast_radius_files_count} | ${status} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
