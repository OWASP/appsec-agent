/**
 * Map RoleSpec to Claude Agent SDK Options (golden-parity path for migrated roles).
 *
 * Author: Sam Li
 */

import { AgentDefinition, Options } from '@anthropic-ai/claude-agent-sdk';
import type { RoleSpec } from './role_spec';

function mcpNamespacedTools(spec: RoleSpec): string[] {
  if (!spec.mcp) return [];
  return spec.mcp.toolNames.map((tool) => `mcp__${spec.mcp!.name}__${tool}`);
}

function resolveClaudeTools(spec: RoleSpec): string[] {
  if (spec.allowedTools) {
    return [...spec.allowedTools];
  }
  if (spec.noTools) {
    return [];
  }
  return capabilitiesToClaudeTools(spec.capabilities);
}

function capabilitiesToClaudeTools(capabilities: RoleSpec['capabilities']): string[] {
  const tools: string[] = [];
  if (capabilities.read) tools.push('Read');
  if (capabilities.grep) tools.push('Grep');
  if (capabilities.write) tools.push('Write');
  if (capabilities.shell) tools.push('Bash');
  if (capabilities.graphviz) tools.push('Graphviz');
  return tools;
}

/** Convert a RoleSpec into Claude SDK Options. */
export function roleSpecToClaudeOptions(spec: RoleSpec): Options {
  let tools = resolveClaudeTools(spec);
  if (spec.mcp) {
    tools = [...tools, ...mcpNamespacedTools(spec)];
  }

  const options: Options = {
    permissionMode: spec.permissionMode ?? 'default',
  };

  if (spec.agentName) {
    options.agents = {
      [spec.agentName]: {
        description: spec.agentDescription ?? spec.agentName,
        prompt: spec.systemPrompt,
        tools,
        model: spec.model,
        maxTurns: spec.maxTurns,
      } as AgentDefinition,
    };
  } else {
    options.systemPrompt = spec.systemPrompt;
    options.maxTurns = spec.maxTurns;
    if (tools.length > 0) {
      options.allowedTools = tools;
    }
  }

  if (spec.outputSchema) {
    options.outputFormat = {
      type: 'json_schema',
      schema: spec.outputSchema,
    };
  }

  if (spec.mcp) {
    const httpEntry: { type: 'http'; url: string; headers?: Record<string, string> } = {
      type: 'http',
      url: spec.mcp.url,
    };
    if (spec.mcp.bearer) {
      httpEntry.headers = { Authorization: `Bearer ${spec.mcp.bearer}` };
    }
    options.mcpServers = {
      ...(options.mcpServers ?? {}),
      [spec.mcp.name]: httpEntry,
    };
  }

  return options;
}
