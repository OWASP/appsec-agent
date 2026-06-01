/**
 * Claude Agent SDK provider (Anthropic-only path).
 *
 * Author: Sam Li
 */

import { query as anthropicQuery } from '@anthropic-ai/claude-agent-sdk';
import { roleSpecToClaudeOptions } from './claude_role_spec';
import { ModelProvider } from './types';
import type { QueryMessage } from './query_message';
import type { RoleSpec } from './role_spec';

export class ClaudeProvider extends ModelProvider {
  readonly provider = 'claude' as const;

  constructor() {
    super();
  }

  async *run(params: {
    prompt: string;
    roleSpec: RoleSpec;
  }): AsyncGenerator<QueryMessage> {
    const { prompt, roleSpec } = params;
    const options = roleSpecToClaudeOptions(roleSpec);
    for await (const msg of anthropicQuery({ prompt, options })) {
      yield msg as QueryMessage;
    }
  }
}

export const defaultClaudeProvider = new ClaudeProvider();
