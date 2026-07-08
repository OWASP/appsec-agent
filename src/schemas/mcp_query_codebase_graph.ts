/**
 * Live MCP tool arguments for `queryCodebaseGraph` (v2.7.0 / parent-app plan §8.18 Phase 3).
 *
 * The parent app's per-scan MCP server validates again server-side; this module
 * gives consumers a shared Zod contract for tests, CLIs, or any agent-side
 * wrapper that needs to reason about the JSON shape before dispatch.
 *
 * **No raw Cypher** — only the closed `kind` enum plus a bounded `target` string
 * (symbol name / qualified name, or BM25 query text for `semantic_search`).
 */

import { z } from 'zod';

export const CODEBASE_GRAPH_BASE_QUERY_KINDS = [
  'callers',
  'callees',
  'reachable_from_entry',
  'semantic_search',
] as const;

export const CODEBASE_GRAPH_ADVANCED_QUERY_KINDS = [
  'data_flow',
  'cross_service',
  'code_snippet',
] as const;

export const CODEBASE_GRAPH_QUERY_KINDS = [
  ...CODEBASE_GRAPH_BASE_QUERY_KINDS,
  ...CODEBASE_GRAPH_ADVANCED_QUERY_KINDS,
] as const;

export type CodebaseGraphQueryKind = (typeof CODEBASE_GRAPH_QUERY_KINDS)[number];

export const queryCodebaseGraphToolArgsSchema = z
  .object({
    kind: z.enum(CODEBASE_GRAPH_QUERY_KINDS),
    target: z.string().min(1).max(512),
    include_neighbors: z.boolean().optional(),
  })
  .strict();

export type QueryCodebaseGraphToolArgs = z.infer<typeof queryCodebaseGraphToolArgsSchema>;

/** Strict parse — throws `ZodError` on invalid input. */
export function parseQueryCodebaseGraphToolArgs(input: unknown): QueryCodebaseGraphToolArgs {
  return queryCodebaseGraphToolArgsSchema.parse(input);
}
