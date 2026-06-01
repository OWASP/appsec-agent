/**
 * MCP server wiring constants shared by role builders and providers.
 *
 * Author: Sam Li
 */

export const DEFAULT_MCP_SERVER_NAME = 'appsec-internal';

/** @deprecated since v2.4.2 — use DEFAULT_MCP_SERVER_NAME */
export const MCP_INTERNAL_SERVER_NAME = DEFAULT_MCP_SERVER_NAME;

export const MCP_INTERNAL_TOOL_NAMES = [
  'queryFindingsHistory',
  'queryImportGraph',
  'queryRuntimeEnrichment',
  'queryCodebaseGraph',
] as const;

export function buildMcpInternalToolNames(
  serverName: string = DEFAULT_MCP_SERVER_NAME,
): string[] {
  return MCP_INTERNAL_TOOL_NAMES.map((tool) => `mcp__${serverName}__${tool}`);
}

import type { RoleSpec } from './providers/role_spec';

export function attachMcpToRoleSpec(
  spec: RoleSpec,
  mcpServerUrl: string | undefined,
  mcpServerName: string = DEFAULT_MCP_SERVER_NAME,
  mcpServerBearer?: string,
): void {
  if (!mcpServerUrl) {
    return;
  }
  spec.mcp = {
    url: mcpServerUrl,
    name: mcpServerName || DEFAULT_MCP_SERVER_NAME,
    bearer: mcpServerBearer,
    toolNames: [...MCP_INTERNAL_TOOL_NAMES],
  };
}
