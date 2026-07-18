/**
 * Live MCP tool arguments for `queryCrossRepoGraph` (Lane 3 Phase 3 —
 * parent-app plan `LANE3_CROSS_REPO_TOPOLOGY_PLAN.md`).
 *
 * Live counterpart to the front-loaded `--cross-repo-context` JSON
 * (parent-app `crossRepoContextBuilder.ts`): both resolve the exact same
 * `project_relationships` boundary output, but this tool lets the agent
 * pull it on demand instead of only seeing the payload captured at
 * scan-start (e.g. when `quality_tier_cross_repo_context_injected` was off
 * but `quality_tier_cross_repo_tool_enabled` is on).
 *
 * The parent app's per-scan MCP server validates again server-side; this
 * module gives consumers a shared Zod contract for tests, CLIs, or any
 * agent-side wrapper that needs to reason about the JSON shape before
 * dispatch. The single optional field is intentionally snake_case
 * (`peer_name_filter`) to match the wire contract the parent app's
 * `internalToolsServer.ts` registers — do not camelCase it.
 */

import { z } from 'zod';

export const queryCrossRepoGraphToolArgsSchema = z
  .object({
    peer_name_filter: z.string().min(1).max(256).optional(),
  })
  .strict();

export type QueryCrossRepoGraphToolArgs = z.infer<
  typeof queryCrossRepoGraphToolArgsSchema
>;

/** Strict parse — throws `ZodError` on invalid input. */
export function parseQueryCrossRepoGraphToolArgs(
  input: unknown,
): QueryCrossRepoGraphToolArgs {
  return queryCrossRepoGraphToolArgsSchema.parse(input);
}
