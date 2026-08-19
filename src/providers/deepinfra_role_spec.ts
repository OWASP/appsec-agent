/**
 * Map RoleSpec to DeepInfra (OpenAI-compatible) client options, tool names, and
 * chat messages.
 *
 * Tool-name resolution mirrors `resolveClaudeTools` in `claude_role_spec.ts`
 * exactly (precedence: allowedTools > noTools > capabilities), so diff-mode and
 * no-tools roles get the same tool set they would on the Claude path.
 *
 * Author: Sam Li
 */

import type { RoleSpec } from './role_spec';

export const DEFAULT_DEEPINFRA_BASE_URL = 'https://api.deepinfra.com/v1/openai';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';

const VALID_REASONING_EFFORTS: ReasoningEffort[] = ['none', 'low', 'medium', 'high'];

export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';

export interface DeepInfraClientOptions {
  apiKey: string;
  baseURL: string;
  timeout: number;
  maxRetries: number;
  reasoningEffort: ReasoningEffort;
}

/**
 * Read DeepInfra client options from the environment. Throws early with a
 * clear message when the API key is missing rather than surfacing an opaque
 * 401, and when `DEEPINFRA_REASONING_EFFORT` is set to an unrecognized value.
 *
 * `maxRetries` is 5 (not the SDK default of 2): DeepInfra returns transient
 * `engine_overloaded` errors as HTTP 429 under load against shared open-weight
 * capacity, and a multi-turn role can issue dozens of requests per run.
 */
export function roleSpecToDeepInfraClientOptions(): DeepInfraClientOptions {
  const apiKey = process.env.DEEPINFRA_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    throw new Error(
      'DEEPINFRA_API_KEY is not set. Export it before running with --provider deepinfra.',
    );
  }
  return {
    apiKey,
    baseURL: process.env.DEEPINFRA_BASE_URL || DEFAULT_DEEPINFRA_BASE_URL,
    timeout: 600_000,
    maxRetries: 5,
    reasoningEffort: resolveReasoningEffort(process.env.DEEPINFRA_REASONING_EFFORT),
  };
}

/**
 * Resolve the reasoning-effort knob. Left unset, DeepInfra's reasoning models
 * (e.g. Kimi-K2.6) reason heavily by default — a one-sentence prompt measured
 * over 1000 completion tokens and ~24s versus ~100 tokens at `medium` — so the
 * default here is `medium` rather than the provider's own default.
 */
export function resolveReasoningEffort(raw: string | undefined): ReasoningEffort {
  if (raw === undefined || raw.trim().length === 0) {
    return DEFAULT_REASONING_EFFORT;
  }
  const normalized = raw.toLowerCase().trim() as ReasoningEffort;
  if (!VALID_REASONING_EFFORTS.includes(normalized)) {
    throw new Error(
      `Invalid DEEPINFRA_REASONING_EFFORT "${raw}". Valid values: ${VALID_REASONING_EFFORTS.join(', ')}`,
    );
  }
  return normalized;
}

function capabilitiesToDeepInfraToolNames(capabilities: RoleSpec['capabilities']): string[] {
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
export function resolveDeepInfraToolNames(spec: RoleSpec): string[] {
  if (spec.allowedTools) {
    return [...spec.allowedTools];
  }
  if (spec.noTools) {
    return [];
  }
  return capabilitiesToDeepInfraToolNames(spec.capabilities);
}

export interface DeepInfraChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

/**
 * Build the initial chat messages. The role's system prompt becomes the system
 * message; when an output schema is set we append it plus an explicit JSON
 * instruction (DeepInfra's JSON mode requires the word "json" to appear in the
 * messages, and only supports `json_object`, not strict `json_schema`).
 */
export function buildDeepInfraMessages(spec: RoleSpec, prompt: string): DeepInfraChatMessage[] {
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
