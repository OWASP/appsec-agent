/**
 * Moonshot (Kimi) model id resolution, dynamic model-list detection, and cost
 * estimation.
 *
 * Author: Sam Li
 */

const CLAUDE_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

export const DEFAULT_MOONSHOT_MODEL = 'kimi-k2.6';

/**
 * Resolve a requested model to a Moonshot model id. Claude family aliases
 * (opus/sonnet/haiku, the CLI default) and any non-kimi input fall back to the
 * default; `kimi-*` / `moonshot-*` ids pass through unchanged.
 */
export function resolveMoonshotModel(requested?: string): string {
  const raw = (requested ?? '').toLowerCase().trim();
  if (!raw) {
    return DEFAULT_MOONSHOT_MODEL;
  }
  if (raw.startsWith('kimi-') || raw.startsWith('kimi') || raw.startsWith('moonshot-')) {
    return raw;
  }
  if (
    CLAUDE_FAMILY_ALIASES.includes(raw as (typeof CLAUDE_FAMILY_ALIASES)[number]) ||
    CLAUDE_FAMILY_ALIASES.some((family) => raw.startsWith(`${family}-`)) ||
    raw.startsWith('claude-')
  ) {
    return DEFAULT_MOONSHOT_MODEL;
  }
  return DEFAULT_MOONSHOT_MODEL;
}

interface ModelListClient {
  models: { list(): Promise<{ data: Array<{ id: string }> }> };
}

let modelListPromise: Promise<string[]> | null = null;

/**
 * Fetch the available Moonshot model ids via `GET /v1/models`, cached at module
 * scope (the in-flight promise is cached so concurrent role runs share one
 * request). Failures fail-open to an empty list so a run is never blocked.
 */
export async function listMoonshotModels(client: ModelListClient): Promise<string[]> {
  if (!modelListPromise) {
    modelListPromise = (async () => {
      try {
        const res = await client.models.list();
        return res.data.map((m) => m.id);
      } catch {
        // Fail-open: caller treats an empty list as "cannot verify".
        modelListPromise = null;
        return [];
      }
    })();
  }
  return modelListPromise;
}

/** Test-only reset for the module-scope cache. */
export function __resetModelListCache(): void {
  modelListPromise = null;
}

/** Approximate per-million-token USD rates (public Kimi pricing; adjust as needed). */
const MOONSHOT_COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  'kimi-k2.6': { input: 0.6, output: 2.5 },
  'kimi-k3': { input: 3, output: 15 },
  'kimi-k2.7-code-highspeed': { input: 0.6, output: 2.5 },
};

const DEFAULT_RATES = { input: 0.6, output: 2.5 };

export function estimateMoonshotCostUsd(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): number {
  const rates = MOONSHOT_COST_PER_MILLION[model] ?? DEFAULT_RATES;
  const inputCost = (usage.input_tokens / 1_000_000) * rates.input;
  const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
  return inputCost + outputCost;
}
