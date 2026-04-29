/**
 * MCP URL / Bearer resolution for `bin/agent-run.ts` (v2.4.5+).
 *
 * Parent apps (e.g. sast-ai-app v6.1.x) pass `SAST_INTERNAL_TOOLS_MCP_URL` and
 * `SAST_INTERNAL_TOOLS_MCP_BEARER` so the listener URL is not on argv. CLI
 * `--mcp-server-url` remains for ad-hoc use; env wins for the URL when both are set.
 */

export interface ResolveAgentRunMcpCliInput {
  mcpServerUrl?: string;
  mcpServerName?: string;
}

export interface ResolveAgentRunMcpFields {
  mcp_server_url?: string;
  mcp_server_name?: string;
  mcp_server_bearer?: string;
}

/**
 * Read `process.env` and merge with Commander MCP flags. Keeps one implementation
 * for production CLI and tests.
 */
export function resolveAgentRunMcpFields(
  cli: ResolveAgentRunMcpCliInput,
): ResolveAgentRunMcpFields {
  const envMcpUrl = process.env.SAST_INTERNAL_TOOLS_MCP_URL?.trim();
  const envMcpBearer = process.env.SAST_INTERNAL_TOOLS_MCP_BEARER?.trim();
  return {
    mcp_server_url: envMcpUrl || cli.mcpServerUrl,
    mcp_server_name: cli.mcpServerName,
    mcp_server_bearer: envMcpBearer,
  };
}
