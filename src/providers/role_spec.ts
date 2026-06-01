/**
 * Provider-neutral role specification (emerges from threat_modeler spike, Phase 3).
 *
 * Author: Sam Li
 */

export interface RoleCapabilities {
  read?: boolean;
  write?: boolean;
  grep?: boolean;
  shell?: boolean;
  graphviz?: boolean;
}

export interface RoleMcpConfig {
  url: string;
  name: string;
  bearer?: string;
  toolNames: string[];
}

/** Neutral role description consumed by ClaudeProvider and CodexProvider. */
export interface RoleSpec {
  /** Role key for error messages and provider routing (e.g. threat_modeler). */
  roleId: string;
  systemPrompt: string;
  maxTurns: number;
  /** When set, ClaudeProvider emits the named subagent shape. */
  agentName?: string;
  agentDescription?: string;
  capabilities: RoleCapabilities;
  /** When set, overrides capability-derived Claude/Codex tool lists (e.g. diff noTools → Write only). */
  allowedTools?: string[];
  noTools?: boolean;
  permissionMode?: 'bypassPermissions' | 'default';
  mcp?: RoleMcpConfig;
  outputSchema?: Record<string, unknown>;
  model?: string;
  /** Codex working directory; Claude ignores (uses process cwd). */
  workingDirectory?: string;
}
