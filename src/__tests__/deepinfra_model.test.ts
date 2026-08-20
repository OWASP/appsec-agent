/**
 * Tests for DeepInfra model resolution, dynamic listing, and cost estimation.
 */

import {
  DEFAULT_DEEPINFRA_MODEL,
  DEEPINFRA_MAX_OUTPUT_TOKENS,
  estimateCostFromPricing,
  listDeepInfraModels,
  resolveDeepInfraMaxOutputTokens,
  resolveDeepInfraModel,
  __resetModelListCache,
} from '../providers/deepinfra_model';

describe('resolveDeepInfraModel', () => {
  it('defaults to moonshotai/Kimi-K2.6 when unset', () => {
    expect(resolveDeepInfraModel(undefined)).toBe(DEFAULT_DEEPINFRA_MODEL);
    expect(resolveDeepInfraModel('')).toBe(DEFAULT_DEEPINFRA_MODEL);
  });

  it('maps Claude aliases to the default', () => {
    expect(resolveDeepInfraModel('opus')).toBe(DEFAULT_DEEPINFRA_MODEL);
    expect(resolveDeepInfraModel('sonnet-4-6')).toBe(DEFAULT_DEEPINFRA_MODEL);
    expect(resolveDeepInfraModel('claude-sonnet-4-6')).toBe(DEFAULT_DEEPINFRA_MODEL);
  });

  it('maps short aliases to their full DeepInfra slug', () => {
    expect(resolveDeepInfraModel('kimi-k2.6')).toBe('moonshotai/Kimi-K2.6');
    expect(resolveDeepInfraModel('kimi-k3')).toBe('moonshotai/Kimi-K3');
    expect(resolveDeepInfraModel('deepseek-v3.2')).toBe('deepseek-ai/DeepSeek-V3.2');
    expect(resolveDeepInfraModel('glm-4.7')).toBe('zai-org/GLM-4.7');
    expect(resolveDeepInfraModel('qwen3-coder')).toBe('Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo');
    expect(resolveDeepInfraModel('gpt-oss-120b')).toBe('openai/gpt-oss-120b');
  });

  it('passes through raw vendor/Model slugs unchanged', () => {
    expect(resolveDeepInfraModel('moonshotai/Kimi-K2.6')).toBe('moonshotai/Kimi-K2.6');
    expect(resolveDeepInfraModel('zai-org/GLM-5')).toBe('zai-org/GLM-5');
  });

  it('falls back to the default for unrecognized bare ids', () => {
    expect(resolveDeepInfraModel('some-unknown-model')).toBe(DEFAULT_DEEPINFRA_MODEL);
  });
});

describe('listDeepInfraModels', () => {
  beforeEach(() => __resetModelListCache());

  it('returns chat-tagged model ids and their pricing from the client', async () => {
    const client = {
      models: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'moonshotai/Kimi-K2.6', metadata: { tags: ['chat'], pricing: { input_tokens: 0.75, output_tokens: 3.5 } } },
            { id: 'moonshotai/Kimi-K3', metadata: { tags: ['chat'] } },
          ],
        }),
      },
    };
    const info = await listDeepInfraModels(client);
    expect(info.ids).toEqual(['moonshotai/Kimi-K2.6', 'moonshotai/Kimi-K3']);
    expect(info.pricingById.get('moonshotai/Kimi-K2.6')).toEqual({ input_tokens: 0.75, output_tokens: 3.5 });
  });

  it('records context window from metadata.max_tokens or metadata.context_length', async () => {
    const client = {
      models: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'moonshotai/Kimi-K2.6', metadata: { tags: ['chat'], max_tokens: 262144 } },
            { id: 'moonshotai/Kimi-K3', metadata: { tags: ['chat'], context_length: 8192 } },
            { id: 'zai-org/GLM-4.7', metadata: { tags: ['chat'] } },
          ],
        }),
      },
    };
    const info = await listDeepInfraModels(client);
    expect(info.contextLengthById.get('moonshotai/Kimi-K2.6')).toBe(262144);
    expect(info.contextLengthById.get('moonshotai/Kimi-K3')).toBe(8192);
    expect(info.contextLengthById.has('zai-org/GLM-4.7')).toBe(false);
  });

  it('excludes non-chat models (image, embedding, etc.) from the allowlist', async () => {
    const client = {
      models: {
        list: jest.fn().mockResolvedValue({
          data: [
            { id: 'moonshotai/Kimi-K2.6', metadata: { tags: ['chat'] } },
            { id: 'black-forest-labs/FLUX-1-dev', metadata: { tags: ['image-gen'] } },
            { id: 'BAAI/bge-m3', metadata: { tags: ['embed'] } },
          ],
        }),
      },
    };
    const info = await listDeepInfraModels(client);
    expect(info.ids).toEqual(['moonshotai/Kimi-K2.6']);
  });

  it('caches the in-flight promise so concurrent callers share one request', async () => {
    const list = jest.fn().mockResolvedValue({ data: [{ id: 'moonshotai/Kimi-K2.6', metadata: { tags: ['chat'] } }] });
    const client = { models: { list } };
    await Promise.all([listDeepInfraModels(client), listDeepInfraModels(client)]);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('fails open to empty info on error', async () => {
    const client = { models: { list: jest.fn().mockRejectedValue(new Error('boom')) } };
    const info = await listDeepInfraModels(client);
    expect(info.ids).toEqual([]);
    expect(info.pricingById.size).toBe(0);
    expect(info.contextLengthById.size).toBe(0);
  });
});

describe('resolveDeepInfraMaxOutputTokens', () => {
  it('returns the default budget when the context window is unknown', () => {
    expect(resolveDeepInfraMaxOutputTokens()).toBe(DEEPINFRA_MAX_OUTPUT_TOKENS);
    expect(resolveDeepInfraMaxOutputTokens(0)).toBe(DEEPINFRA_MAX_OUTPUT_TOKENS);
  });

  it('returns the default budget when the context window is larger', () => {
    expect(resolveDeepInfraMaxOutputTokens(262144)).toBe(DEEPINFRA_MAX_OUTPUT_TOKENS);
  });

  it('clamps to a smaller context window', () => {
    expect(resolveDeepInfraMaxOutputTokens(8192)).toBe(8192);
  });
});

describe('estimateCostFromPricing', () => {
  it('computes cost from per-million-token pricing', () => {
    const cost = estimateCostFromPricing(
      { input_tokens: 0.75, output_tokens: 3.5 },
      { input_tokens: 1_000_000, output_tokens: 1_000_000 },
    );
    expect(cost).toBeCloseTo(4.25, 5);
  });

  it('returns 0 when pricing is unavailable', () => {
    expect(estimateCostFromPricing(undefined, { input_tokens: 1000, output_tokens: 1000 })).toBe(0);
  });
});
