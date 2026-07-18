/**
 * Cross-repo service-topology context input (Lane 3 Phase 2/A —
 * docs/LANE3_CROSS_REPO_TOPOLOGY_PLAN.md in the parent app) — per-scan
 * payload describing peer projects reachable from the scanned repo via
 * the parent app's `project_relationships` typed-edge graph, so
 * `pr_reviewer` can treat a peer's enforcement posture (e.g. a BFF's
 * fail-open/fail-closed flag) as a severity/confidence lever instead of
 * reasoning about the client or the BFF in isolation.
 *
 * Distinct from `--codebase-graph-context`: that context is *symbol-level*
 * structural reach **within** the scanned repo (cbm CALLS edges). This
 * context is a **typed service-boundary edge across repos** — the parent
 * app's `composeCrossRepoContextPayload` deliberately does not attempt
 * live cross-repo symbol correlation yet (no native `CROSS_*` cbm edges in
 * production; see the plan doc's Hybrid-LSP section), so there is no
 * counterpart symbol/snippet here — only the relationship type, a curated
 * `enforcement_note`, and whether the peer's own structural graph is fresh
 * enough to trust as corroboration.
 *
 * The parent app's `composeCrossRepoContextPayload`
 * (`<parent-app>/backend/src/services/crossRepo/crossRepoContextBuilder.ts`)
 * resolves peers via a bounded BFS over `project_relationships` and writes
 * the JSON file. The agent here only parses + formats it for the prompt —
 * no MCP query at agent runtime (a live cross-repo MCP tool is Lane 3
 * Phase 3 / plan §B, not yet built).
 *
 * **Advisory-only contract (plan doc §C):** `enforcement_note` is curated
 * text and can drift from runtime config (e.g. a flag flip after the note
 * was written). The formatter presents every note as *as-of* evidence,
 * never as current ground truth — see `formatCrossRepoContextForPrompt`'s
 * guidance block.
 *
 * **Fail-open parsing philosophy (mirrors `codebase_graph.ts`):** only the
 * peer's identity (`project_name`) is load-bearing and throws when absent;
 * every other field defaults to a conservative value rather than throwing,
 * so a partial/older payload from the parent app degrades gracefully
 * instead of dropping the whole context block.
 */

export interface CrossRepoPeerEntry {
  /** Peer project's display name (parent app `projects.name`). Required identity anchor. */
  project_name: string;
  /** Peer project's repo URL, or `null` if not recorded. */
  repo_url: string | null;
  /** Typed edge kind connecting the scanned repo to this peer. */
  relationship_type: 'bff_client' | 'service_call' | 'shared_library' | 'deployment_sibling';
  /** Whether the edge is one-directional (scanned repo calls peer) or bidirectional. */
  direction: 'source_calls_target' | 'bidirectional';
  /** Curator/harvester confidence in this edge; the resolver uses it upstream to rank peers under the fanout cap. */
  confidence: 'low' | 'medium' | 'high';
  /** BFS hop distance from the scanned project (1 = direct peer). */
  depth: number;
  /** Curated enforcement-semantics note (e.g. a fail-open/fail-closed flag), or `null` if none recorded. */
  enforcement_note: string | null;
  /**
   * Freshness of the peer's *own* structural (cbm) graph — a corroboration
   * signal, not a guarantee this context carries a specific counterpart
   * symbol:
   *   - `fresh`   — peer has a recent CBM head; its own graph is queryable.
   *   - `stale`   — peer has a CBM head older than the freshness threshold.
   *   - `no_head` — peer has never been indexed by CBM (e.g. a mobile repo
   *                 not yet onboarded to SAST AI scanning) — the
   *                 `enforcement_note` is still valid signal, just
   *                 unaccompanied by a structural graph.
   */
  peer_graph_status: 'fresh' | 'stale' | 'no_head';
}

export interface CrossRepoContext {
  /** Optional scanned-project display name, for forensic/debug correlation; not surfaced in the prompt. */
  origin_project_name?: string;
  /** Optional ISO-8601 timestamp recorded when the parent app composed this payload. */
  parsed_at?: string;
  /**
   * Roll-up resolution status across all resolved peers:
   *   - `full`    — every peer has a fresh CBM graph.
   *   - `partial` — at least one peer is `stale` or `no_head`.
   *   - `none`/`empty` — reserved for parity with the sibling
   *                 `codebase-graph-context` taxonomy; the current parent-app
   *                 producer never emits these (a zero-peer result is a
   *                 `skipped` wire outcome upstream, not a payload).
   */
  coverage?: 'full' | 'partial' | 'none' | 'empty';
  /** Max BFS depth the resolver was configured to traverse (`cross_repo_max_depth`, default 5). */
  max_depth_used?: number;
  /** Max peers-per-hop fanout cap the resolver applied (`cross_repo_max_fanout`, default 10). */
  max_fanout_used?: number;
  /** True if the resolver had to drop lower-confidence peers to stay under the fanout cap at some hop. */
  truncated_by_fanout?: boolean;
  peers: CrossRepoPeerEntry[];
}

const MAX_PEERS = 50;

const VALID_RELATIONSHIP_TYPES = new Set<CrossRepoPeerEntry['relationship_type']>([
  'bff_client',
  'service_call',
  'shared_library',
  'deployment_sibling',
]);

const VALID_DIRECTIONS = new Set<CrossRepoPeerEntry['direction']>([
  'source_calls_target',
  'bidirectional',
]);

const VALID_CONFIDENCES = new Set<CrossRepoPeerEntry['confidence']>(['low', 'medium', 'high']);

const VALID_GRAPH_STATUSES = new Set<CrossRepoPeerEntry['peer_graph_status']>([
  'fresh',
  'stale',
  'no_head',
]);

const VALID_COVERAGE_VALUES = new Set<CrossRepoContext['coverage']>([
  'full',
  'partial',
  'none',
  'empty',
]);

/**
 * Parse and validate a cross-repo context JSON payload (throws on
 * structural error). Peer cap (50) is sized to projects, not files — far
 * fewer of them than the 500-file cap used by the per-file structural
 * contexts, since even `cross_repo_max_fanout` truncation across a few
 * hops of `cross_repo_max_depth` stays well under this bound.
 */
export function parseCrossRepoContext(data: unknown): CrossRepoContext {
  if (!data || typeof data !== 'object') {
    throw new Error('Cross-repo context must be a JSON object');
  }
  const o = data as Record<string, unknown>;
  if (!Array.isArray(o.peers)) {
    throw new Error('Cross-repo context must include a "peers" array');
  }
  if (o.peers.length > MAX_PEERS) {
    throw new Error(`Cross-repo context supports at most ${MAX_PEERS} peers per run`);
  }

  const peers: CrossRepoPeerEntry[] = [];
  for (const item of o.peers) {
    if (!item || typeof item !== 'object') {
      throw new Error('Each cross-repo peer entry must be an object');
    }
    const p = item as Record<string, unknown>;
    if (typeof p.project_name !== 'string' || !p.project_name.trim()) {
      throw new Error('Each cross-repo peer entry must have a non-empty string "project_name"');
    }

    const relationshipType =
      typeof p.relationship_type === 'string' &&
      VALID_RELATIONSHIP_TYPES.has(p.relationship_type as CrossRepoPeerEntry['relationship_type'])
        ? (p.relationship_type as CrossRepoPeerEntry['relationship_type'])
        : 'service_call';
    const direction =
      typeof p.direction === 'string' && VALID_DIRECTIONS.has(p.direction as CrossRepoPeerEntry['direction'])
        ? (p.direction as CrossRepoPeerEntry['direction'])
        : 'source_calls_target';
    const confidence =
      typeof p.confidence === 'string' && VALID_CONFIDENCES.has(p.confidence as CrossRepoPeerEntry['confidence'])
        ? (p.confidence as CrossRepoPeerEntry['confidence'])
        : 'medium';
    const peerGraphStatus =
      typeof p.peer_graph_status === 'string' &&
      VALID_GRAPH_STATUSES.has(p.peer_graph_status as CrossRepoPeerEntry['peer_graph_status'])
        ? (p.peer_graph_status as CrossRepoPeerEntry['peer_graph_status'])
        : 'no_head';
    const depth =
      typeof p.depth === 'number' && Number.isFinite(p.depth) ? Math.max(0, Math.trunc(p.depth)) : 1;

    peers.push({
      project_name: p.project_name.trim(),
      repo_url: typeof p.repo_url === 'string' && p.repo_url.trim() ? p.repo_url : null,
      relationship_type: relationshipType,
      direction,
      confidence,
      depth,
      enforcement_note:
        typeof p.enforcement_note === 'string' && p.enforcement_note.trim() ? p.enforcement_note : null,
      peer_graph_status: peerGraphStatus,
    });
  }

  const coverage =
    typeof o.coverage === 'string' && VALID_COVERAGE_VALUES.has(o.coverage as CrossRepoContext['coverage'])
      ? (o.coverage as CrossRepoContext['coverage'])
      : undefined;

  return {
    origin_project_name: typeof o.origin_project_name === 'string' ? o.origin_project_name : undefined,
    parsed_at: typeof o.parsed_at === 'string' ? o.parsed_at : undefined,
    coverage,
    max_depth_used:
      typeof o.max_depth_used === 'number' && Number.isFinite(o.max_depth_used)
        ? Math.max(0, Math.trunc(o.max_depth_used))
        : undefined,
    max_fanout_used:
      typeof o.max_fanout_used === 'number' && Number.isFinite(o.max_fanout_used)
        ? Math.max(0, Math.trunc(o.max_fanout_used))
        : undefined,
    truncated_by_fanout: o.truncated_by_fanout === true,
    peers,
  };
}

const RELATIONSHIP_LABELS: Record<CrossRepoPeerEntry['relationship_type'], string> = {
  bff_client: 'is a client of (BFF)',
  service_call: 'calls',
  shared_library: 'shares a library with',
  deployment_sibling: 'deploys alongside',
};

/**
 * Format the context for inclusion in a PR-reviewer user prompt. Compact
 * by design — one row per peer, sorted nearest-hop-first so the LLM's
 * attention anchors on direct service-boundary peers before transitive
 * ones.
 */
export function formatCrossRepoContextForPrompt(ctx: CrossRepoContext): string {
  if (ctx.peers.length === 0) {
    return '';
  }
  const sorted = [...ctx.peers].sort((a, b) => a.depth - b.depth);
  const lines: string[] = [];
  lines.push('### Cross-repo service-topology context (Lane 3, plan §Phase 2)');
  lines.push(
    'The scanned repo has a typed service-boundary relationship with each peer below (from the parent app\'s cross-repo relationship graph). Use `enforcement_note` as **advisory, as-of evidence** about the peer\'s enforcement posture — never as current ground truth (notes can drift from runtime config after they were written). A client-side finding is only exploitable end-to-end if the peer also fails open; if the peer enforces (per its note), downrank the client finding. Conversely, a peer/BFF finding whose exploitability hinges on a spoofable client-supplied value should treat a client edge as corroboration, not dismiss it.',
  );
  lines.push(
    'When `peer_graph_status` is `no_head` (peer never indexed) or `stale`, the note is still valid signal — it is just unaccompanied by a fresh structural graph on the peer side. Do not discount the note on that basis alone.',
  );
  if (ctx.coverage && ctx.coverage !== 'full') {
    lines.push(
      `_Coverage: **${ctx.coverage}** — peers with \`peer_graph_status=stale\` or \`no_head\` are not discounted (fail-open)._`,
    );
  }
  lines.push('');
  lines.push('| Peer | Relationship | Confidence | Depth | Peer graph | Enforcement note |');
  lines.push('|---|---|:---:|:---:|:---:|---|');
  for (const p of sorted) {
    const relLabel = RELATIONSHIP_LABELS[p.relationship_type];
    const note = p.enforcement_note ? p.enforcement_note.replace(/\|/g, '\\|') : '—';
    lines.push(
      `| ${p.project_name} | ${relLabel} | ${p.confidence} | ${p.depth} | ${p.peer_graph_status} | ${note} |`,
    );
  }
  lines.push('');
  return lines.join('\n');
}
