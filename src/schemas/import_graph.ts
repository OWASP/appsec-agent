/**
 * Import-graph context input (v2.2.0 / plan §3.1 Stage B) — per-file reachability
 * summary passed to `pr_reviewer` so the LLM can factor inbound-caller counts
 * into its confidence calls.
 *
 * The authoritative post-LLM confidence downrank lives in the parent app
 * (an `importGraphDecision`-style service). The context
 * here is advisory — it lets the LLM see what the post-pass will see and
 * avoid raising a HIGH-confidence finding on an unreachable helper file.
 *
 * Shape mirrors the existing adversarial/diff-context pattern: the backend
 * composes a JSON file, the agent parses + formats into the user prompt,
 * no HTTP call at agent runtime.
 */

export interface ImportGraphFileEntry {
  file: string;
  inbound_prod_import_count: number;
  callers?: string[];
  is_entry_point?: boolean;
  graph_status?: 'ok' | 'missing' | 'partial';
}

export interface ImportGraphContext {
  default_branch_sha?: string;
  parsed_at?: string;
  coverage?: 'full' | 'partial' | 'none';
  files: ImportGraphFileEntry[];
  metadata?: { project_name?: string };
}

const MAX_FILES = 500;
const MAX_CALLERS_PER_FILE = 20;

/**
 * Parse and validate an import-graph context JSON payload (throws on structural error).
 */
export function parseImportGraphContext(data: unknown): ImportGraphContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Import-graph context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.files)) {
    throw new Error('Import-graph context must include a "files" array');
  }
  if (o.files.length > MAX_FILES) {
    throw new Error(`Import-graph context supports at most ${MAX_FILES} files per run`);
  }
  const files: ImportGraphFileEntry[] = [];
  for (const item of o.files) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each import-graph file entry must be an object');
    }
    const f = item as Record<string, unknown>;
    if (typeof f.file !== 'string' || !f.file.trim()) {
      throw new Error('Each import-graph file entry must have a non-empty string "file"');
    }
    if (typeof f.inbound_prod_import_count !== 'number' || !Number.isFinite(f.inbound_prod_import_count)) {
      throw new Error('Each import-graph file entry must have a numeric "inbound_prod_import_count"');
    }
    const callers = Array.isArray(f.callers)
      ? (f.callers as unknown[])
          .filter((c): c is string => typeof c === 'string' && c.length > 0)
          .slice(0, MAX_CALLERS_PER_FILE)
      : undefined;
    const graphStatus =
      f.graph_status === 'ok' || f.graph_status === 'missing' || f.graph_status === 'partial'
        ? f.graph_status
        : undefined;
    files.push({
      file: String(f.file),
      inbound_prod_import_count: Math.max(0, Math.trunc(f.inbound_prod_import_count)),
      callers,
      is_entry_point: typeof f.is_entry_point === 'boolean' ? f.is_entry_point : undefined,
      graph_status: graphStatus,
    });
  }
  const coverage =
    o.coverage === 'full' || o.coverage === 'partial' || o.coverage === 'none' ? o.coverage : undefined;
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
 * design — we want this to consume far less prompt budget than the diff itself.
 */
export function formatImportGraphContextForPrompt(ctx: ImportGraphContext): string {
  if (ctx.files.length === 0) {
    return '';
  }
  const lines: string[] = [];
  lines.push('### File reachability summary (import-graph, Stage B)');
  lines.push(
    'The post-LLM scorer will multiply confidence by 0.3 for findings on files with `inbound_prod_import_count == 0` and not marked as entry points. Factor this in when assigning confidence — do not raise HIGH on unreachable helpers.',
  );
  if (ctx.default_branch_sha) {
    lines.push(`Graph built from default-branch SHA \`${ctx.default_branch_sha.slice(0, 12)}\`.`);
  }
  if (ctx.coverage && ctx.coverage !== 'full') {
    lines.push(
      `_Coverage: **${ctx.coverage}** — missing files are scored as \`graph_status=missing\` and will **not** be downranked (fail-open)._`,
    );
  }
  lines.push('');
  lines.push('| File | Inbound | Entry point | Status | Top callers |');
  lines.push('|---|---:|:---:|:---:|---|');
  for (const f of ctx.files) {
    const entry = f.is_entry_point ? 'yes' : 'no';
    const status = f.graph_status ?? 'ok';
    const callers =
      f.callers && f.callers.length > 0 ? f.callers.slice(0, 3).map((c) => `\`${c}\``).join(', ') : '—';
    lines.push(`| \`${f.file}\` | ${f.inbound_prod_import_count} | ${entry} | ${status} | ${callers} |`);
  }
  lines.push('');
  return lines.join('\n');
}
