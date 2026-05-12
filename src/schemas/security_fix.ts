/**
 * JSON Schema and TypeScript interfaces for Security Fix Output
 *
 * Defines the structured output schema for the code_fixer agent role.
 * The agent receives a FixContext (enriched finding data from the parent app)
 * and returns a FixOutput (structured fix via Claude SDK outputFormat).
 *
 * Author: Sam Li
 */

// ---------------------------------------------------------------------------
// Input: context provided by the parent app via --fix-context JSON file
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
  /** Deployment/environment context from the project settings */
  deployment_context?: string;
  /** Retry-specific: previous fix code that failed validation */
  previous_fix_code?: string;
  /** Retry-specific: validation errors from the previous attempt */
  validation_errors?: string[];
  /** Phase 3: When true, the agent should generate a companion unit test */
  generate_companion_test?: boolean;
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
  /** Phase 3: Generated companion test code */
  test_code?: string;
  /** Phase 3: Suggested file path for the test (e.g. "__tests__/fix.test.ts") */
  test_file?: string;
  /** Phase 3: Test framework used (e.g. "jest", "pytest") */
  test_framework?: string;
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
    test_code: {
      type: 'string',
      description: 'Optional: Generated companion unit test code that verifies the fix.',
    },
    test_file: {
      type: 'string',
      description: 'Optional: Suggested file path for the companion test.',
    },
    test_framework: {
      type: 'string',
      description: 'Optional: Test framework used (e.g. jest, pytest, junit).',
    },
  },
};
