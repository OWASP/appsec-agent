/**
 * Finding Validator Context and Verdict Schemas
 *
 * Defines the input context and output verdict for the finding_validator role.
 * RetestContext is assembled by sast-ai-app and passed via --retest-context JSON file.
 * RetestVerdict is the structured output returned by the finding_validator agent.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Input: context provided by sast-ai-app via --retest-context JSON file
// ---------------------------------------------------------------------------

export interface RetestContextFinding {
  title: string;
  category: string;
  severity: string;
  cwe: string | null;
  file: string;
  line_numbers: string | null;
  description: string;
}

export interface RetestContext {
  finding: RetestContextFinding;
  code_snippet: string;
}

// ---------------------------------------------------------------------------
// Output: structured verdict returned by the agent
// ---------------------------------------------------------------------------

export interface RetestVerdict {
  still_present: boolean;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  current_line: number | null;
}

// ---------------------------------------------------------------------------
// Context loader
// ---------------------------------------------------------------------------

/**
 * Discriminator for `RetestContextValidationError` — see usage in `main.ts`
 * for the operational contract.
 *
 * Parent apps that spawn `agent-run -r finding_validator` should treat exit
 * code 2 + a stderr line beginning with `RETEST_CONTEXT_INVALID_SIGNAL` as
 * "caller-side input invalid; do not retry without fixing the context",
 * vs. exit code 1 ("agent crash; safe to retry").
 *
 * The signal prefix is intentionally short + greppable + free of regex
 * metacharacters so a parent's `stderr.includes(...)` check is robust.
 */
export const RETEST_CONTEXT_INVALID_SIGNAL = '[finding_validator] retest_context_invalid';

/**
 * Thrown by {@link loadRetestContext} when the caller-supplied context
 * fails validation. Distinct from generic `Error` so `main.ts` can
 * cleanly route it to exit code 2 (caller-input invalid) rather than the
 * default unhandled-exception path that surfaces as exit code 1 + a Node
 * stack trace.
 *
 * Parent apps (e.g., sast-ai-app's `findingRetestService`) historically
 * captured only the last N chars of stderr, which truncated the
 * throwing-site frame and left only the bottom-of-stack
 * `Module._compile` / `executeUserEntryPoint` frames in their logs.
 * `RETEST_CONTEXT_INVALID_SIGNAL` is emitted to stderr as the FIRST
 * line of the failure so even a 200-char capture window catches it.
 */
export class RetestContextValidationError extends Error {
  readonly kind: string;
  constructor(kind: string, message: string) {
    super(message);
    this.name = 'RetestContextValidationError';
    this.kind = kind;
  }
}

function fail(kind: string, message: string): never {
  // Emit the structured signal FIRST so parent apps with small stderr
  // capture windows still see the prefix; the longer human-readable
  // message follows but is not load-bearing.
  console.error(`${RETEST_CONTEXT_INVALID_SIGNAL}: ${kind}: ${message}`);
  throw new RetestContextValidationError(kind, message);
}

export function loadRetestContext(filePath: string, cwd: string): RetestContext {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    fail('file_not_found', `Retest context file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  let ctx: RetestContext;
  try {
    ctx = JSON.parse(content) as RetestContext;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    fail('json_parse_error', `Retest context JSON parse error: ${msg}`);
  }

  if (!ctx.finding || typeof ctx.finding !== 'object') {
    fail('missing_finding', 'Retest context must include a valid finding object');
  }
  if (!ctx.finding.title || typeof ctx.finding.title !== 'string') {
    fail('missing_finding_title', 'Retest context finding must include a valid title');
  }
  if (!ctx.finding.file || typeof ctx.finding.file !== 'string') {
    fail('missing_finding_file', 'Retest context finding must include a valid file path');
  }
  if (!ctx.code_snippet || typeof ctx.code_snippet !== 'string') {
    fail('missing_code_snippet', 'Retest context must include a valid code_snippet');
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// JSON Schema for Claude SDK outputFormat (structured output)
// ---------------------------------------------------------------------------

export const RETEST_VERDICT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['still_present', 'confidence', 'reasoning', 'current_line'],
  properties: {
    still_present: {
      type: 'boolean',
      description: 'Whether the vulnerability is still present in the current code',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Confidence level in the assessment',
    },
    reasoning: {
      type: 'string',
      description: 'Brief explanation of why the vulnerability is or is not present',
    },
    current_line: {
      type: ['number', 'null'],
      description: 'Line number where the issue exists, or null if resolved',
    },
  },
  additionalProperties: false,
};
