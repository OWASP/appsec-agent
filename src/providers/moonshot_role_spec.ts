/**
 * Map RoleSpec to Moonshot (OpenAI-compatible) client options, tool names, and
 * chat messages.
 *
 * Tool-name resolution mirrors `resolveClaudeTools` in `claude_role_spec.ts`
 * exactly (precedence: allowedTools > noTools > capabilities), so diff-mode and
 * no-tools roles get the same tool set they would on the Claude path.
 *
 * Author: Sam Li
 */

import type { RoleSpec } from './role_spec';

export const DEFAULT_MOONSHOT_BASE_URL = 'https://api.moonshot.ai/v1';

export interface MoonshotClientOptions {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
}

/**
 * Read Moonshot client options from the environment. Throws early with a clear
 * message when the API key is missing rather than surfacing an opaque 401.
 */
export function roleSpecToMoonshotClientOptions(): MoonshotClientOptions {
  const apiKey = process.env.MOONSHOT_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'MOONSHOT_API_KEY is not set. Export it before running with --provider moonshot.',
    );
  }
  return {
    apiKey,
    baseURL: process.env.MOONSHOT_BASE_URL || DEFAULT_MOONSHOT_BASE_URL,
    timeout: 600_000,
    maxRetries: 2,
  };
}

function capabilitiesToMoonshotToolNames(capabilities: RoleSpec['capabilities']): string[] {
  const tools: string[] = [];
  if (capabilities.read) tools.push('Read');
  if (capabilities.grep) tools.push('Grep');
  if (capabilities.write) tools.push('Write');
  if (capabilities.shell) tools.push('Bash');
  if (capabilities.graphviz) tools.push('Graphviz');
  return tools;
}

/**
 * Resolve the local (non-MCP) tool names for a role. Mirrors
 * `resolveClaudeTools`: an explicit `allowedTools` override wins, then
 * `noTools` yields an empty list, otherwise the capability-derived list.
 */
export function resolveMoonshotToolNames(spec: RoleSpec): string[] {
  if (spec.allowedTools) {
    return [...spec.allowedTools];
  }
  if (spec.noTools) {
    return [];
  }
  return capabilitiesToMoonshotToolNames(spec.capabilities);
}

export interface MoonshotChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Build the initial chat messages. The role's system prompt becomes the system
 * message; when an output schema is set we append it plus an explicit JSON
 * instruction (Moonshot's JSON mode requires the word "json" to appear in the
 * messages, and only supports `json_object`, not strict `json_schema`).
 */
export function buildMoonshotMessages(spec: RoleSpec, prompt: string): MoonshotChatMessage[] {
  let systemPrompt = spec.systemPrompt;
  if (spec.outputSchema) {
    systemPrompt +=
      '\n\nYou MUST respond with a single valid JSON object that conforms to this JSON schema. ' +
      'Output only the JSON object, with no prose or code fences.\n\nJSON schema:\n' +
      JSON.stringify(spec.outputSchema);
  }
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: prompt },
  ];
}
