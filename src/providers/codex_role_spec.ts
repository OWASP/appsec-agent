/**
 * Map RoleSpec to @openai/codex-sdk client/thread options (incl. MCP wiring).
 *
 * Author: Sam Li
 */

import type { CodexOptions, ThreadOptions } from '@openai/codex-sdk';
import type { RoleSpec } from './role_spec';
import { resolveCodexModel } from './codex_model';

/** Map RoleSpec capabilities to Codex sandbox / approval settings. */
export function roleSpecToCodexThreadOptions(spec: RoleSpec): ThreadOptions {
  const readOnly =
    !spec.capabilities.write &&
    !spec.capabilities.shell &&
    !spec.capabilities.graphviz &&
    !spec.mcp;

  return {
    model: resolveCodexModel(spec.model),
    workingDirectory: spec.workingDirectory ?? process.cwd(),
    skipGitRepoCheck: true,
    sandboxMode: readOnly ? 'read-only' : 'workspace-write',
    approvalPolicy: spec.permissionMode === 'bypassPermissions' ? 'never' : 'on-request',
  };
}

export function roleSpecToCodexClientOptions(spec: RoleSpec): CodexOptions {
  const options: CodexOptions = {
    apiKey: process.env.CODEX_API_KEY,
    baseUrl: process.env.CODEX_BASE_URL,
  };

  if (!spec.mcp) {
    return options;
  }

  const serverConfig: Record<string, unknown> = {
    url: spec.mcp.url,
    enabled: true,
  };
  if (spec.mcp.bearer) {
    serverConfig.http_headers = { Authorization: `Bearer ${spec.mcp.bearer}` };
  }

  options.config = {
    mcp_servers: {
      [spec.mcp.name]: serverConfig,
    },
    sandbox_workspace_write: { network_access: true },
  } as CodexOptions['config'];

  return options;
}

export function buildCodexRunOptions(spec: RoleSpec): {
  threadOptions: ThreadOptions;
  clientOptions: CodexOptions;
} {
  const threadOptions = roleSpecToCodexThreadOptions(spec);
  if (spec.mcp && threadOptions.sandboxMode === 'read-only') {
    threadOptions.sandboxMode = 'workspace-write';
  }
  return {
    threadOptions,
    clientOptions: roleSpecToCodexClientOptions(spec),
  };
}

export function buildCodexInput(spec: RoleSpec, prompt: string): string {
  return `${spec.systemPrompt}\n\n---\n\n${prompt}`;
}
