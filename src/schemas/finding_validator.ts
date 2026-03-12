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

export function loadRetestContext(filePath: string, cwd: string): RetestContext {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Retest context file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  const ctx = JSON.parse(content) as RetestContext;

  if (!ctx.finding || typeof ctx.finding !== 'object') {
    throw new Error('Retest context must include a valid finding object');
  }
  if (!ctx.finding.title || typeof ctx.finding.title !== 'string') {
    throw new Error('Retest context finding must include a valid title');
  }
  if (!ctx.finding.file || typeof ctx.finding.file !== 'string') {
    throw new Error('Retest context finding must include a valid file path');
  }
  if (!ctx.code_snippet || typeof ctx.code_snippet !== 'string') {
    throw new Error('Retest context must include a valid code_snippet');
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
