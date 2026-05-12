/**
 * QA Verification Context and Verdict Schemas
 * 
 * Defines the input context and output verdict for the qa_verifier role.
 * QaContext is assembled by the parent app and passed via --qa-context JSON file.
 * QaVerdict is the structured output returned by the qa_verifier agent.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface QaContext {
  pr_url: string;
  deployment_context?: string;
  test_command: string;
  test_framework?: string;
  setup_commands?: string;
  runtime_image?: string;
  environment_variables?: Record<string, string>;
  timeout_seconds: number;
  block_on_failure: boolean;
}

export interface QaVerdict {
  pass: boolean;
  test_exit_code: number;
  failures: string[];
  logs: string;
  analysis?: string;
  suggestions?: string[];
}

export function loadQaContext(filePath: string, cwd: string): QaContext {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`QA context file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  const ctx = JSON.parse(content) as QaContext;

  if (!ctx.pr_url || typeof ctx.pr_url !== 'string') {
    throw new Error('QA context must include a valid pr_url');
  }
  if (!ctx.test_command || typeof ctx.test_command !== 'string') {
    throw new Error('QA context must include a valid test_command');
  }
  if (typeof ctx.timeout_seconds !== 'number' || ctx.timeout_seconds < 1) {
    ctx.timeout_seconds = 300;
  }
  if (typeof ctx.block_on_failure !== 'boolean') {
    ctx.block_on_failure = false;
  }

  return ctx;
}

export const QA_VERDICT_SCHEMA = {
  name: 'qa_verdict',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      pass: {
        type: 'boolean',
        description: 'Whether all tests passed'
      },
      test_exit_code: {
        type: 'number',
        description: 'Exit code from the test command'
      },
      failures: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of individual test failure descriptions'
      },
      logs: {
        type: 'string',
        description: 'Relevant test output logs (truncated if large)'
      },
      analysis: {
        type: 'string',
        description: 'LLM analysis of why tests failed and potential root causes'
      },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Actionable suggestions for fixing the test failures'
      }
    },
    required: ['pass', 'test_exit_code', 'failures', 'logs'],
    additionalProperties: false
  }
};
