/**
 * Accumulate and print Anthropic usage from a result message.
 *
 * The Anthropic API reports `input_tokens` excluding cached reads; cache
 * reads/writes are separate counters. Recording all four (plus turns) is
 * required for cost reconciliation — input-only accounting misattributes
 * spend when intra-session caching is active.
 */

export interface UsageCounters {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  turns: number;
}

export interface UsageFields {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export function emptyUsageCounters(): UsageCounters {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    turns: 0,
  };
}

export function extractUsageFields(result: unknown): UsageFields | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const r = result as { usage?: UsageFields; message?: { usage?: UsageFields } };
  return r.usage ?? r.message?.usage;
}

export function accumulateUsage(
  counters: UsageCounters,
  result: unknown,
): void {
  const usage = extractUsageFields(result);
  if (usage) {
    if (typeof usage.input_tokens === 'number') counters.inputTokens += usage.input_tokens;
    if (typeof usage.output_tokens === 'number') counters.outputTokens += usage.output_tokens;
    if (typeof usage.cache_read_input_tokens === 'number') {
      counters.cacheReadTokens += usage.cache_read_input_tokens;
    }
    if (typeof usage.cache_creation_input_tokens === 'number') {
      counters.cacheWriteTokens += usage.cache_creation_input_tokens;
    }
  }
  if (result && typeof result === 'object') {
    const turns = (result as { num_turns?: number }).num_turns;
    if (typeof turns === 'number' && turns > counters.turns) {
      counters.turns = turns;
    }
  }
}

/** Print token / cache / turns lines for the parent app's stdout scraper. */
export function printUsageCounters(counters: UsageCounters): void {
  if (counters.inputTokens > 0) console.log(`Tokens input: ${counters.inputTokens}`);
  if (counters.outputTokens > 0) console.log(`Tokens output: ${counters.outputTokens}`);
  if (counters.cacheReadTokens > 0) console.log(`Cache read: ${counters.cacheReadTokens}`);
  if (counters.cacheWriteTokens > 0) console.log(`Cache write: ${counters.cacheWriteTokens}`);
  if (counters.turns > 0) console.log(`Turns used: ${counters.turns}`);
}

/**
 * Print the cross-batch totals under distinct `Total …` labels.
 *
 * A batched review prints one per-batch block from `printUsageCounters` before
 * this summary, and the parent app scrapes with a first-match regex. Reusing the
 * per-batch labels here would therefore report batch one while `Total API cost:`
 * reports the whole run — cost and tokens would disagree on exactly the large
 * PRs the measurement cares about. Mirror the cost line's `Total` prefix so the
 * scraper can prefer the summary.
 */
export function printUsageTotals(counters: UsageCounters): void {
  if (counters.inputTokens > 0) console.log(`Total tokens input: ${counters.inputTokens}`);
  if (counters.outputTokens > 0) console.log(`Total tokens output: ${counters.outputTokens}`);
  if (counters.cacheReadTokens > 0) console.log(`Total cache read: ${counters.cacheReadTokens}`);
  if (counters.cacheWriteTokens > 0) console.log(`Total cache write: ${counters.cacheWriteTokens}`);
  if (counters.turns > 0) console.log(`Total turns used: ${counters.turns}`);
}

/** Payload carried through onResult for batch aggregation. */
export interface RoleResultUsage {
  total_cost_usd?: number;
  tokens_input?: number;
  tokens_output?: number;
  tokens_cache_read?: number;
  tokens_cache_write?: number;
  turns_used?: number;
}

export function roleResultFromCounters(
  totalCostUsd: number | undefined,
  counters: UsageCounters,
): RoleResultUsage {
  return {
    total_cost_usd: totalCostUsd,
    tokens_input: counters.inputTokens > 0 ? counters.inputTokens : undefined,
    tokens_output: counters.outputTokens > 0 ? counters.outputTokens : undefined,
    tokens_cache_read: counters.cacheReadTokens > 0 ? counters.cacheReadTokens : undefined,
    tokens_cache_write: counters.cacheWriteTokens > 0 ? counters.cacheWriteTokens : undefined,
    turns_used: counters.turns > 0 ? counters.turns : undefined,
  };
}
