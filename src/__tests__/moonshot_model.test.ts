/**
 * Tests for Moonshot model resolution, dynamic listing, and cost estimation.
 */

import {
  DEFAULT_MOONSHOT_MODEL,
  estimateMoonshotCostUsd,
  listMoonshotModels,
  resolveMoonshotModel,
  __resetModelListCache,
} from '../providers/moonshot_model';

describe('resolveMoonshotModel', () => {
  it('defaults to kimi-k2.6 when unset', () => {
    expect(resolveMoonshotModel(undefined)).toBe(DEFAULT_MOONSHOT_MODEL);
    expect(resolveMoonshotModel('')).toBe(DEFAULT_MOONSHOT_MODEL);
  });

  it('maps Claude aliases to the default', () => {
    expect(resolveMoonshotModel('opus')).toBe(DEFAULT_MOONSHOT_MODEL);
    expect(resolveMoonshotModel('sonnet-4-6')).toBe(DEFAULT_MOONSHOT_MODEL);
    expect(resolveMoonshotModel('claude-sonnet-4-6')).toBe(DEFAULT_MOONSHOT_MODEL);
  });

  it('passes through kimi / moonshot ids', () => {
    expect(resolveMoonshotModel('kimi-k3')).toBe('kimi-k3');
    expect(resolveMoonshotModel('kimi-k2.7-code-highspeed')).toBe('kimi-k2.7-code-highspeed');
    expect(resolveMoonshotModel('moonshot-v1-8k')).toBe('moonshot-v1-8k');
  });
});

describe('listMoonshotModels', () => {
  beforeEach(() => __resetModelListCache());

  it('returns model ids from the client', async () => {
    const client = { models: { list: jest.fn().mockResolvedValue({ data: [{ id: 'kimi-k2.6' }, { id: 'kimi-k3' }] }) } };
    expect(await listMoonshotModels(client)).toEqual(['kimi-k2.6', 'kimi-k3']);
  });

  it('caches the in-flight promise so concurrent callers share one request', async () => {
    const list = jest.fn().mockResolvedValue({ data: [{ id: 'kimi-k2.6' }] });
    const client = { models: { list } };
    await Promise.all([listMoonshotModels(client), listMoonshotModels(client)]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fails open to an empty list on error', async () => {
    const client = { models: { list: jest.fn().mockRejectedValue(new Error('boom')) } };
    expect(await listMoonshotModels(client)).toEqual([]);
  });
});

describe('estimateMoonshotCostUsd', () => {
  it('computes a positive cost from token usage', () => {
    const cost = estimateMoonshotCostUsd('kimi-k2.6', { input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(cost).toBeGreaterThan(0);
  });

  it('falls back to default rates for unknown models', () => {
    const cost = estimateMoonshotCostUsd('kimi-unknown', { input_tokens: 1_000_000, output_tokens: 0 });
    expect(cost).toBeCloseTo(0.6, 5);
  });
});
