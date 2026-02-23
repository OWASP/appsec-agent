/**
 * JSON Schema for Security Review Reports
 * 
 * This schema enforces a consistent structure for security reports generated
 * by the appsec-agent when using JSON output format. It ensures compatibility
 * with the sast-ai-app parser.
 * 
 * Author: Sam Li
 */

export interface SecurityFinding {
  id: string;
  title: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string;
  cwe_id?: string;
  cvss_score?: number;
  affected_files: Array<{
    path: string;
    lines?: string;  // Format: "8-10" or "8" - NOT an array
  }>;
  description: string;
  impact?: string;
  vulnerable_code?: string;
  remediation: string | {
    description?: string;
    remediation_steps?: string[];
    secure_code_example?: string;
  };
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
            required: ['id', 'title', 'severity', 'category', 'affected_files', 'description', 'remediation'],
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              severity: { 
                type: 'string',
                enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']
              },
              category: { type: 'string' },
              cwe_id: { type: 'string' },
              cvss_score: { type: 'number', minimum: 0, maximum: 10 },
              affected_files: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['path'],
                  properties: {
                    path: { type: 'string' },
                    lines: { 
                      type: 'string',
                      description: 'Line numbers as string, e.g., "8-10" or "8". NOT an array.'
                    }
                  }
                }
              },
              description: { type: 'string' },
              impact: { type: 'string' },
              vulnerable_code: { type: 'string' },
              remediation: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      description: { type: 'string' },
                      remediation_steps: {
                        type: 'array',
                        items: { type: 'string' }
                      },
                      secure_code_example: { type: 'string' }
                    }
                  }
                ]
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
