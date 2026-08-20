/**
 * DeepInfra model id resolution, dynamic model-list detection, and cost
 * estimation.
 *
 * DeepInfra (https://deepinfra.com) is a HIPAA- and SOC 2-certified inference
 * cloud that hosts open-weight models (Kimi, DeepSeek, GLM, Qwen, gpt-oss,
 * etc.) behind an OpenAI-compatible API. Model ids are vendor-namespaced
 * slugs, e.g. `moonshotai/Kimi-K2.6`.
 *
 * Author: Sam Li
 */

const CLAUDE_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

export const DEFAULT_DEEPINFRA_MODEL = 'moonshotai/Kimi-K2.6';

/**
 * Short, memorable aliases for the models worth first-class support. Anything
 * else can still be requested via its raw DeepInfra slug (`vendor/Model`).
 */
const MODEL_ALIASES: Record<string, string> = {
  'kimi-k2.5': 'moonshotai/Kimi-K2.5',
  'kimi-k2.6': 'moonshotai/Kimi-K2.6',
  kimi: 'moonshotai/Kimi-K2.6',
  'kimi-k2.7-code': 'moonshotai/Kimi-K2.7-Code',
  'kimi-k3': 'moonshotai/Kimi-K3',
  'deepseek-v3.2': 'deepseek-ai/DeepSeek-V3.2',
  'deepseek-v4-pro': 'deepseek-ai/DeepSeek-V4-Pro',
  deepseek: 'deepseek-ai/DeepSeek-V3.2',
  'glm-4.7': 'zai-org/GLM-4.7',
  'glm-5': 'zai-org/GLM-5',
  'qwen3-coder': 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo',
  'gpt-oss-120b': 'openai/gpt-oss-120b',
  'gpt-oss-20b': 'openai/gpt-oss-20b',
};

/**
 * Resolve a requested model to a DeepInfra model id.
 *
 * - A raw `vendor/Model` slug (containing `/`) passes through unchanged.
 * - A short alias (`kimi-k2.6`, `deepseek-v3.2`, ...) maps to its full slug.
 * - Claude family aliases (opus/sonnet/haiku, the CLI default) and any other
 *   unrecognized input fall back to the default, since the library path feeds
 *   `model` into every RoleSpec with no provider awareness.
 */
export function resolveDeepInfraModel(requested?: string): string {
  const raw = (requested ?? '').trim();
  if (!raw) {
    return DEFAULT_DEEPINFRA_MODEL;
  }
  if (raw.includes('/')) {
    return raw;
  }
  const lower = raw.toLowerCase();
  if (MODEL_ALIASES[lower]) {
    return MODEL_ALIASES[lower];
  }
  if (
    CLAUDE_FAMILY_ALIASES.includes(lower as (typeof CLAUDE_FAMILY_ALIASES)[number]) ||
    CLAUDE_FAMILY_ALIASES.some((family) => lower.startsWith(`${family}-`)) ||
    lower.startsWith('claude-')
  ) {
    return DEFAULT_DEEPINFRA_MODEL;
  }
  return DEFAULT_DEEPINFRA_MODEL;
}

export interface ModelPricing {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
}

interface ModelListEntry {
  id: string;
  metadata?: {
    tags?: string[];
    pricing?: ModelPricing;
    /**
     * DeepInfra reports the model's total context window here (input + output).
     * The `/v1/openai/models` payload uses `max_tokens` for this and mirrors it
     * in `context_length`; there is no separate max-output field.
     */
    max_tokens?: number;
    context_length?: number;
  };
}

interface ModelListClient {
  models: { list(): Promise<{ data: ModelListEntry[] }> };
}

export interface DeepInfraModelInfo {
  /** Canonical (server-cased) chat-model ids, e.g. `moonshotai/Kimi-K2.6`. */
  ids: string[];
  /** Per-million-token pricing by canonical id, from `metadata.pricing`. */
  pricingById: Map<string, ModelPricing>;
  /** Total context window (input + output) by canonical id, from metadata. */
  contextLengthById: Map<string, number>;
}

/**
 * Generous default cap on completion tokens for a single DeepInfra request.
 *
 * DeepInfra applies a conservative default max-output limit when a request
 * omits `max_tokens` — small enough (~32-36K on some models) to clip a large
 * structured report mid-JSON, which then surfaces as `finish_reason: "length"`
 * and a dropped result. Large structured roles (threat_modeler, security
 * review) can legitimately need well over 32K completion tokens, so we send an
 * explicit budget with comfortable headroom, clamped to the model's context
 * window by `resolveDeepInfraMaxOutputTokens` so we never over-request.
 */
export const DEEPINFRA_MAX_OUTPUT_TOKENS = 64000;

/**
 * Resolve the `max_tokens` (completion budget) to request for a model.
 *
 * Returns {@link DEEPINFRA_MAX_OUTPUT_TOKENS}, clamped so it never exceeds the
 * model's total context window (a request for more completion tokens than the
 * whole window is always invalid). When the context length is unknown
 * (model-list detection failed), fall back to the flat budget — the offered
 * models all carry >=200K windows, so this is safe in practice.
 */
export function resolveDeepInfraMaxOutputTokens(contextLength?: number): number {
  if (contextLength && contextLength > 0) {
    return Math.min(DEEPINFRA_MAX_OUTPUT_TOKENS, contextLength);
  }
  return DEEPINFRA_MAX_OUTPUT_TOKENS;
}

let modelInfoPromise: Promise<DeepInfraModelInfo> | null = null;

/**
 * Fetch the available DeepInfra chat model ids (and their pricing) via
 * `GET /v1/models`, cached at module scope (the in-flight promise is cached so
 * concurrent role runs share one request). Failures fail-open to empty info so
 * a run is never blocked.
 *
 * The endpoint also returns non-chat models (image generation, embeddings,
 * TTS, ...), so results are filtered to `metadata.tags` containing `chat` —
 * otherwise an image-only model would "validate" and then fail at request
 * time with an opaque error.
 */
export async function listDeepInfraModels(client: ModelListClient): Promise<DeepInfraModelInfo> {
  if (!modelInfoPromise) {
    modelInfoPromise = (async () => {
      try {
        const res = await client.models.list();
        const chatModels = res.data.filter((m) => (m.metadata?.tags ?? []).includes('chat'));
        const pricingById = new Map<string, ModelPricing>();
        const contextLengthById = new Map<string, number>();
        for (const m of chatModels) {
          if (m.metadata?.pricing) {
            pricingById.set(m.id, m.metadata.pricing);
          }
          const contextLength = m.metadata?.context_length ?? m.metadata?.max_tokens;
          if (typeof contextLength === 'number' && contextLength > 0) {
            contextLengthById.set(m.id, contextLength);
          }
        }
        return { ids: chatModels.map((m) => m.id), pricingById, contextLengthById };
      } catch {
        // Fail-open: caller treats an empty list as "cannot verify".
        modelInfoPromise = null;
        return { ids: [], pricingById: new Map(), contextLengthById: new Map() };
      }
    })();
  }
  return modelInfoPromise;
}

/** Test-only reset for the module-scope cache. */
export function __resetModelListCache(): void {
  modelInfoPromise = null;
}

/**
 * Estimate cost from cached `/v1/models` pricing metadata. Used only as a
 * fallback when a response omits `usage.estimated_cost` (DeepInfra's own
 * per-request cost figure, which is preferred whenever present).
 */
export function estimateCostFromPricing(
  pricing: ModelPricing | undefined,
  usage: { input_tokens: number; output_tokens: number },
): number {
  if (!pricing) return 0;
  const inputCost = (usage.input_tokens / 1_000_000) * (pricing.input_tokens ?? 0);
  const outputCost = (usage.output_tokens / 1_000_000) * (pricing.output_tokens ?? 0);
  return inputCost + outputCost;
}
