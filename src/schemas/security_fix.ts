/**
 * JSON Schema and TypeScript interfaces for Security Fix Output
 *
 * Defines the structured output schema for the code_fixer agent role.
 * The agent receives a FixContext (enriched finding data from sast-ai-app)
 * and returns a FixOutput (structured fix via Claude SDK outputFormat).
 *
 * Author: Sam Li
 */

// ---------------------------------------------------------------------------
// Input: context provided by sast-ai-app via --fix-context JSON file
// ---------------------------------------------------------------------------

export interface FixContextFinding {
  title: string;
  severity: string;
  cwe: string;
  owasp: string;
  file: string;
  line: number;
  description: string;
  recommendation: string;
  category: string;
}

export interface FixContextCodeContext {
  language: string;
  imports: string;
  vulnerable_section: string;
  vulnerable_section_start: number;
  vulnerable_section_end: number;
  full_file_with_line_numbers: string;
  indentation_guidance: string;
}

export interface FixContext {
  finding: FixContextFinding;
  code_context: FixContextCodeContext;
  security_guidance: string;
  learned_examples: string;
  negative_examples: string;
  custom_instructions: string;
  chain_of_thought: boolean;
  /** Retry-specific: previous fix code that failed validation */
  previous_fix_code?: string;
  /** Retry-specific: validation errors from the previous attempt */
  validation_errors?: string[];
}

// ---------------------------------------------------------------------------
// Output: structured fix returned by the agent
// ---------------------------------------------------------------------------

export interface FixOutput {
  fixed_code: string;
  start_line: number;
  end_line: number;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  breaking_changes: boolean;
}

/**
 * JSON Schema for Claude Agent SDK's outputFormat option.
 * Enforces the FixOutput structure when generating JSON fixes.
 */
export const FIX_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['fixed_code', 'start_line', 'end_line', 'explanation', 'confidence', 'breaking_changes'],
  properties: {
    fixed_code: {
      type: 'string',
      description:
        'The complete fixed code for ONLY the affected section (lines start_line to end_line). ' +
        'CRITICAL: Preserve the exact indentation of the original code.',
    },
    start_line: {
      type: 'number',
      description:
        'Line number where the fix starts. MUST be within the vulnerable code section line range.',
    },
    end_line: {
      type: 'number',
      description:
        'Line number where the fix ends. Together with start_line, defines the exact lines being replaced.',
    },
    explanation: {
      type: 'string',
      description: 'Brief explanation of the fix (1-2 sentences).',
    },
    confidence: {
      type: 'string',
      enum: ['high', 'medium', 'low'],
      description: 'Confidence level in the fix correctness.',
    },
    breaking_changes: {
      type: 'boolean',
      description: 'Whether this fix introduces breaking changes to the API.',
    },
  },
};
