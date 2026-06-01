/**
 * Codex model id resolution from Claude-style model aliases.
 *
 * Author: Sam Li
 */

const CLAUDE_FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'] as const;

/** Map Claude family aliases / prefixes to Codex model ids. */
export function resolveCodexModel(claudeModel?: string): string {
  const raw = (claudeModel ?? 'opus').toLowerCase().trim();

  if (CLAUDE_FAMILY_ALIASES.includes(raw as (typeof CLAUDE_FAMILY_ALIASES)[number])) {
    const map: Record<string, string> = {
      opus: 'o3',
      sonnet: 'gpt-4.1',
      haiku: 'gpt-4.1-mini',
    };
    return map[raw] ?? 'o3';
  }

  for (const family of CLAUDE_FAMILY_ALIASES) {
    if (raw.startsWith(`${family}-`)) {
      return resolveCodexModel(family);
    }
  }

  if (raw.startsWith('gpt-') || /^o\d/.test(raw)) {
    return raw;
  }

  return 'o3';
}

/** Per-million-token USD rates for Codex cost estimation (approximate; spike defaults). */
const CODEX_COST_PER_MILLION: Record<string, { input: number; output: number }> = {
  o3: { input: 10, output: 40 },
  'gpt-4.1': { input: 2, output: 8 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6 },
};

const DEFAULT_RATES = { input: 2, output: 8 };

export function estimateCodexCostUsd(
  model: string,
  usage: { input_tokens: number; output_tokens: number },
): number {
  const rates = CODEX_COST_PER_MILLION[model] ?? DEFAULT_RATES;
  const inputCost = (usage.input_tokens / 1_000_000) * rates.input;
  const outputCost = (usage.output_tokens / 1_000_000) * rates.output;
  return inputCost + outputCost;
}
