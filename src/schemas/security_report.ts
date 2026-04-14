/**
 * JSON Schema for Security Review Reports
 * 
 * This schema enforces a consistent structure for security reports generated
 * by the appsec-agent when using JSON output format. It ensures compatibility
 * with the parent app parser.
 * 
 * Author: Sam Li
 */

export interface FixOption {
  id: number;
  title: string;
  description: string;
}

export interface SecurityFinding {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  category: string;
  file: string;
  line_numbers?: string;
  cwe_id?: string;
  cvss_score?: number;
  description: string;
  code_snippet?: string;
  impact?: string;
  recommendation: string;
  fixed_code?: string;
  fix_options?: FixOption[];
  cwe?: string;
  owasp?: string;
  references?: string[];
}

export interface SecurityReviewReport {
  security_review_report: {
    metadata: {
      project_name?: string;
      scan_date?: string;
      scan_type?: string;
      total_files_reviewed?: number;
      total_issues_found?: number;
    };
    executive_summary: {
      overview?: string;
      risk_rating?: string;
      critical?: number;
      high?: number;
      medium?: number;
      low?: number;
      info?: number;
    };
    findings: SecurityFinding[];
    recommendations?: Array<{
      title?: string;
      description?: string;
      priority?: string;
    }>;
    conclusion?: string;
  };
}

/**
 * JSON Schema definition for Claude Agent SDK's outputFormat option.
 * This schema enforces the structure above when generating JSON reports.
 */
export const SECURITY_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['security_review_report'],
  properties: {
    security_review_report: {
      type: 'object',
      required: ['metadata', 'executive_summary', 'findings'],
      properties: {
        metadata: {
          type: 'object',
          properties: {
            project_name: { type: 'string' },
            scan_date: { type: 'string' },
            scan_type: { type: 'string' },
            total_files_reviewed: { type: 'integer' },
            total_issues_found: { type: 'integer' }
          }
        },
        executive_summary: {
          type: 'object',
          properties: {
            overview: { type: 'string' },
            risk_rating: { type: 'string' },
            critical: { type: 'integer', minimum: 0 },
            high: { type: 'integer', minimum: 0 },
            medium: { type: 'integer', minimum: 0 },
            low: { type: 'integer', minimum: 0 },
            info: { type: 'integer', minimum: 0 }
          }
        },
        findings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['id', 'title', 'severity', 'confidence', 'category', 'file', 'description', 'recommendation'],
            properties: {
              id: { 
                type: 'string',
                description: 'Sequential ID (SEC-001, SEC-002, etc.)'
              },
              title: { type: 'string' },
              severity: { 
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
              },
              confidence: {
                type: 'string',
                enum: ['HIGH', 'MEDIUM', 'LOW'],
                description: 'Confidence level of the finding'
              },
              category: { type: 'string' },
              file: {
                type: 'string',
                description: 'File path where the vulnerability was found'
              },
              line_numbers: { 
                type: 'string',
                description: 'Line number(s) where the issue occurs, e.g., "8-10" or "8"'
              },
              cwe_id: { type: 'string' },
              cvss_score: { type: 'number', minimum: 0, maximum: 10 },
              description: { type: 'string' },
              code_snippet: { type: 'string' },
              impact: { type: 'string' },
              recommendation: {
                type: 'string',
                description: 'Remediation steps to fix the vulnerability'
              },
              fixed_code: {
                type: 'string',
                description: 'Executable drop-in replacement code that fixes the vulnerability. MUST be compilable/runnable code, NOT comments or recommendations. If a direct fix is not possible, leave this empty and use fix_options instead.'
              },
              fix_options: {
                type: 'array',
                description: 'When a direct code fix requires architectural decisions or domain knowledge, provide structured remediation options instead of fixed_code.',
                items: {
                  type: 'object',
                  required: ['id', 'title', 'description'],
                  properties: {
                    id: { type: 'integer', description: 'Option number (1, 2, 3, ...)' },
                    title: { type: 'string', description: 'Short title for the remediation approach' },
                    description: { type: 'string', description: 'Detailed description of how this option resolves the vulnerability' }
                  }
                }
              },
              cwe: {
                type: 'string',
                description: 'CWE identifier, e.g., "CWE-89: SQL Injection"'
              },
              owasp: {
                type: 'string',
                description: 'OWASP Top 10 reference'
              },
              references: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          }
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'string' }
            }
          }
        },
        conclusion: { type: 'string' }
      }
    }
  }
};
