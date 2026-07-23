/**
 * JSON Schema for QA / Correctness Review Reports (Lane 5).
 *
 * Sibling of `security_report.ts`. Envelope is `qa_review_report`; finding
 * ids are `QA-NNN`. The agent must write the report to the filename the
 * caller requests (backend discovers `code_review_report.json` — do not
 * invent `qa_review_report.json`).
 *
 * Keep in sync with parent-app `backend/src/schemas/qaReviewReportSchema.json`.
 */

export interface QaFinding {
  id: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  bug_class: string;
  title: string;
  file: string;
  description: string;
  impact: string;
  recommendation: string;
  /** Concrete steps to trigger the bug; each step ≤ 15 words. */
  reproduction_steps: string[];
  /** Short x -> y -> z chain explaining why the bug triggers. */
  causal_chain: string;
  category?: string;
  line_numbers?: string;
  code_snippet?: string;
  fixed_code?: string;
  /** Optional — only when the QA bug is also security-relevant. */
  cwe?: string;
  owasp?: string;
}

export interface QaReviewReport {
  qa_review_report: {
    project_name?: string;
    review_date?: string;
    reviewer?: string;
    summary: {
      total_issues_found: number;
      critical: number;
      high: number;
      medium: number;
      low: number;
      overall_risk_level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
    };
    findings: QaFinding[];
  };
}

/**
 * JSON Schema for Claude Agent SDK / Codex structured output.
 * Same export pattern as `SECURITY_REPORT_SCHEMA`.
 */
export const QA_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['qa_review_report'],
  properties: {
    qa_review_report: {
      type: 'object',
      required: ['summary', 'findings'],
      properties: {
        project_name: { type: 'string' },
        review_date: { type: 'string' },
        reviewer: {
          type: 'string',
          description: 'Name or identifier of the reviewer',
        },
        summary: {
          type: 'object',
          required: [
            'total_issues_found',
            'critical',
            'high',
            'medium',
            'low',
            'overall_risk_level',
          ],
          properties: {
            total_issues_found: { type: 'integer', minimum: 0 },
            critical: { type: 'integer', minimum: 0 },
            high: { type: 'integer', minimum: 0 },
            medium: { type: 'integer', minimum: 0 },
            low: { type: 'integer', minimum: 0 },
            overall_risk_level: {
              type: 'string',
              enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'NONE'],
            },
          },
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: [
              'id',
              'severity',
              'confidence',
              'bug_class',
              'title',
              'file',
              'description',
              'impact',
              'recommendation',
              'reproduction_steps',
              'causal_chain',
            ],
            properties: {
              id: {
                type: 'string',
                pattern: '^QA-[0-9]{3}$',
                description: 'Sequential ID (QA-001, QA-002, etc.)',
              },
              severity: {
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'],
              },
              confidence: {
                type: 'string',
                enum: ['HIGH', 'MEDIUM', 'LOW'],
              },
              bug_class: {
                type: 'string',
                description:
                  'Taxonomy key (e.g. null_deref, race_condition, off_by_one, missing_await)',
              },
              category: {
                type: 'string',
                description: 'Optional human-readable category; prefer bug_class for identity',
              },
              title: { type: 'string' },
              file: {
                type: 'string',
                description: 'File path where the correctness issue was found',
              },
              line_numbers: {
                type: 'string',
                description: 'Line number(s) where the issue occurs, e.g., "8-10" or "8"',
              },
              description: { type: 'string' },
              code_snippet: { type: 'string' },
              impact: {
                type: 'string',
                description: 'Concrete incorrect outcome (crash, wrong value, leak, hang)',
              },
              recommendation: {
                type: 'string',
                description: 'Remediation steps to fix the correctness issue',
              },
              reproduction_steps: {
                type: 'array',
                description: 'Concrete steps to trigger the bug; each step ≤ 15 words',
                items: { type: 'string', maxLength: 120 },
                minItems: 1,
              },
              causal_chain: {
                type: 'string',
                description: 'Short x -> y -> z chain explaining why the bug triggers',
              },
              fixed_code: {
                type: 'string',
                description:
                  'Executable drop-in replacement that fixes the bug. MUST be compilable/runnable code, NOT comments.',
              },
              cwe: {
                type: 'string',
                description: 'Optional — only when the QA bug is also security-relevant',
              },
              owasp: {
                type: 'string',
                description: 'Optional OWASP reference',
              },
            },
          },
        },
      },
    },
  },
};
