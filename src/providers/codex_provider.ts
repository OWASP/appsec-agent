/**
 * Codex provider: maps RoleSpec to @openai/codex-sdk and normalizes events to QueryMessage.
 *
 * Author: Sam Li
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { Input, ThreadEvent, TurnOptions } from '@openai/codex-sdk';
import { Codex } from '@openai/codex-sdk';
import { ModelProvider } from './types';
import type { QueryMessage, ResultMessage } from './query_message';
import type { RoleSpec } from './role_spec';
import { estimateCodexCostUsd, resolveCodexModel } from './codex_model';
import { parseAndValidateStructuredOutput } from './structured_output';
import {
  buildCodexInput,
  buildCodexRunOptions,
  roleSpecToCodexThreadOptions,
} from './codex_role_spec';

export { roleSpecToCodexThreadOptions } from './codex_role_spec';

export interface CodexStreamClient {
  startThread(options?: ReturnType<typeof roleSpecToCodexThreadOptions>): {
    runStreamed(input: Input, turnOptions?: TurnOptions): Promise<{
      events: AsyncGenerator<ThreadEvent>;
    }>;
  };
}

export type CodexClientFactory = (
  spec: RoleSpec,
  codexHome: string,
) => CodexStreamClient;

function createIsolatedCodexHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codex-home-'));
}

function buildCodexEnv(codexHome: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }
  env.CODEX_HOME = codexHome;
  return env;
}

function defaultCodexClientFactory(spec: RoleSpec, codexHome: string): CodexStreamClient {
  const { threadOptions, clientOptions } = buildCodexRunOptions(spec);
  return new Codex({
    ...clientOptions,
    env: buildCodexEnv(codexHome),
  }) as CodexStreamClient;
}

export class CodexProvider extends ModelProvider {
  readonly provider = 'codex' as const;

  constructor(
    private readonly clientFactory: CodexClientFactory = defaultCodexClientFactory,
  ) {
    super();
  }

  async *run(params: {
    prompt: string;
    roleSpec: RoleSpec;
  }): AsyncGenerator<QueryMessage> {
    const { prompt, roleSpec } = params;
    const codexHome = createIsolatedCodexHome();

    try {
      const { threadOptions } = buildCodexRunOptions(roleSpec);
      const client = this.clientFactory(roleSpec, codexHome);
      const thread = client.startThread(threadOptions);
      const turnOptions: TurnOptions | undefined = roleSpec.outputSchema
        ? { outputSchema: roleSpec.outputSchema }
        : undefined;

      const { events } = await thread.runStreamed(buildCodexInput(roleSpec, prompt), turnOptions);

      let assistantText = '';
      let streamedLength = 0;
      let usage: { input_tokens: number; output_tokens: number } | null = null;
      let turnFailed: string | null = null;

      for await (const event of events) {
        switch (event.type) {
          case 'item.updated':
          case 'item.completed': {
            const item = event.item;
            if (item.type === 'agent_message') {
              assistantText = item.text;
              if (event.type === 'item.updated' && item.text.length > streamedLength) {
                const delta = item.text.slice(streamedLength);
                streamedLength = item.text.length;
                yield {
                  type: 'stream_event',
                  event: {
                    type: 'content_block_delta',
                    delta: { type: 'text_delta', text: delta },
                  },
                } as QueryMessage;
              }
              if (event.type === 'item.completed') {
                yield {
                  type: 'assistant',
                  message: { content: [{ type: 'text', text: item.text }] },
                } as QueryMessage;
              }
            }
            break;
          }
          case 'turn.completed':
            usage = {
              input_tokens: event.usage.input_tokens,
              output_tokens: event.usage.output_tokens,
            };
            break;
          case 'turn.failed':
            turnFailed = event.error.message;
            break;
          case 'error':
            turnFailed = event.message;
            break;
          default:
            break;
        }
      }

      const model = resolveCodexModel(roleSpec.model);
      const result: ResultMessage = {
        type: 'result',
        is_error: turnFailed !== null,
        error_message: turnFailed ?? undefined,
      };

      if (usage) {
        result.usage = usage;
        const cost = estimateCodexCostUsd(model, usage);
        if (cost > 0) {
          result.total_cost_usd = cost;
        }
      }

      if (roleSpec.outputSchema && !turnFailed) {
        const validation = parseAndValidateStructuredOutput(assistantText, roleSpec.outputSchema);
        if (validation.ok) {
          result.structured_output = validation.value;
        } else {
          result.is_error = true;
          result.errors = validation.errors;
          result.error_message = validation.errors.join('; ');
        }
      }

      yield result;
    } finally {
      fs.rmSync(codexHome, { recursive: true, force: true });
    }
  }
}

export const defaultCodexProvider = new CodexProvider();
