/**
 * Resolve the active model provider from AGENT_PROVIDER env / CLI.
 *
 * Author: Sam Li
 */

import { ModelProvider } from './types';
import { defaultClaudeProvider } from './claude_provider';

export type ProviderId = 'claude' | 'codex';

const VALID_PROVIDERS: ProviderId[] = ['claude', 'codex'];

export function normalizeProviderId(raw: string | undefined): ProviderId {
  const id = (raw ?? 'claude').toLowerCase().trim();
  if (VALID_PROVIDERS.includes(id as ProviderId)) {
    return id as ProviderId;
  }
  throw new Error(
    `Invalid provider "${raw}". Valid values: ${VALID_PROVIDERS.join(', ')}`,
  );
}

export function resolveProvider(): ModelProvider {
  const id = normalizeProviderId(process.env.AGENT_PROVIDER);
  if (id === 'codex') {
    // Lazy-load so Claude-only test runs do not require @openai/codex-sdk resolution.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { defaultCodexProvider } = require('./codex_provider') as typeof import('./codex_provider');
    return defaultCodexProvider;
  }
  return defaultClaudeProvider;
}
