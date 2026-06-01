/**
 * Model provider abstraction for pluggable LLM runtimes.
 *
 * Author: Sam Li
 */

import type { RoleSpec } from './role_spec';
import type { QueryMessage } from './query_message';

export type { QueryMessage } from './query_message';
export type { RoleSpec, RoleCapabilities, RoleMcpConfig } from './role_spec';

export abstract class ModelProvider {
  abstract readonly provider: 'claude' | 'codex';

  abstract run(params: {
    prompt: string;
    roleSpec: RoleSpec;
  }): AsyncGenerator<QueryMessage>;

  protected formatCostLine(usd: number): string {
    return `\nCost: $${usd.toFixed(4)}`;
  }
}
