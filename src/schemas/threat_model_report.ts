/**
 * JSON Schema for Threat Model Reports
 * 
 * This schema enforces a consistent structure for threat model reports generated
 * by the appsec-agent when using JSON output format. It wraps three report sections
 * (Data Flow Diagram, STRIDE Threat Model, Risk Registry) into a single document.
 * 
 * The DFD section contains only structured data (nodes, flows, boundaries).
 * Visual rendering (e.g., Mermaid diagrams) is handled by the consuming application.
 * 
 * Author: Sam Li
 */

export interface DFDNode {
  id: string;
  name: string;
  type: 'external_entity' | 'process' | 'data_store';
  description?: string;
}

export interface DFDDataFlow {
  id: string;
  source: string;
  destination: string;
  description: string;
  protocol?: string;
  data_classification?: string;
}

export interface DFDTrustBoundary {
  id: string;
  name: string;
  nodes: string[];
}

export interface Threat {
  id: string;
  title: string;
  stride_category: 'Spoofing' | 'Tampering' | 'Repudiation' | 'Information Disclosure' | 'Denial of Service' | 'Elevation of Privilege';
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  affected_components: string[];
  description: string;
  attack_vector?: string;
  impact: string;
  likelihood: 'HIGH' | 'MEDIUM' | 'LOW';
  mitigation: string;
  references?: string[];
}

export interface Risk {
  id: string;
  title: string;
  category: string;
  stride_category?: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  current_risk_score?: string;
  residual_risk_score?: string;
  description: string;
  affected_components?: string[];
  business_impact?: string;
  remediation_plan: string;
  effort_estimate?: string;
  cost_estimate?: string;
  timeline?: string;
  related_threats?: string[];
}

export interface ThreatModelReport {
  threat_model_report: {
    metadata: {
      project_name: string;
      scan_date: string;
      methodology: string;
      total_threats_identified: number;
      total_risks_identified: number;
    };
    data_flow_diagram: {
      description: string;
      nodes: DFDNode[];
      data_flows: DFDDataFlow[];
      trust_boundaries: DFDTrustBoundary[];
    };
    threat_model: {
      executive_summary: string;
      threats: Threat[];
    };
    risk_registry: {
      summary: string;
      risks: Risk[];
    };
    recommendations?: Array<{
      title: string;
      description: string;
      priority: 'HIGH' | 'MEDIUM' | 'LOW';
    }>;
    conclusion?: string;
  };
}

/**
 * JSON Schema definition for Claude Agent SDK's outputFormat option.
 * This schema enforces the ThreatModelReport structure when generating JSON reports.
 */
export const THREAT_MODEL_REPORT_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['threat_model_report'],
  properties: {
    threat_model_report: {
      type: 'object',
      required: ['metadata', 'data_flow_diagram', 'threat_model', 'risk_registry'],
      properties: {
        metadata: {
          type: 'object',
          required: ['project_name', 'scan_date', 'methodology', 'total_threats_identified', 'total_risks_identified'],
          properties: {
            project_name: { type: 'string', description: 'Name of the project or repository analyzed' },
            scan_date: { type: 'string', description: 'ISO 8601 date of the scan' },
            methodology: { type: 'string', description: 'Threat modeling methodology used, e.g., "STRIDE"' },
            total_threats_identified: { type: 'integer', minimum: 0 },
            total_risks_identified: { type: 'integer', minimum: 0 }
          }
        },
        data_flow_diagram: {
          type: 'object',
          required: ['description', 'nodes', 'data_flows', 'trust_boundaries'],
          properties: {
            description: {
              type: 'string',
              description: 'High-level summary of the system architecture'
            },
            nodes: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'type'],
                properties: {
                  id: { type: 'string', description: 'Unique node identifier, e.g., "node-001"' },
                  name: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['external_entity', 'process', 'data_store'],
                    description: 'DFD element type'
                  },
                  description: { type: 'string' }
                }
              }
            },
            data_flows: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'source', 'destination', 'description'],
                properties: {
                  id: { type: 'string', description: 'Unique flow identifier, e.g., "flow-001"' },
                  source: { type: 'string', description: 'Source node id' },
                  destination: { type: 'string', description: 'Destination node id' },
                  description: { type: 'string' },
                  protocol: { type: 'string', description: 'Communication protocol, e.g., "HTTPS", "gRPC", "TCP"' },
                  data_classification: {
                    type: 'string',
                    enum: ['public', 'internal', 'confidential', 'restricted'],
                    description: 'Data sensitivity classification'
                  }
                }
              }
            },
            trust_boundaries: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'name', 'nodes'],
                properties: {
                  id: { type: 'string', description: 'Unique boundary identifier, e.g., "tb-001"' },
                  name: { type: 'string' },
                  nodes: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Node ids within this trust boundary'
                  }
                }
              }
            }
          }
        },
        threat_model: {
          type: 'object',
          required: ['executive_summary', 'threats'],
          properties: {
            executive_summary: { type: 'string' },
            threats: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'stride_category', 'severity', 'affected_components', 'description', 'impact', 'likelihood', 'mitigation'],
                properties: {
                  id: { type: 'string', description: 'Sequential ID (THREAT-001, THREAT-002, etc.)' },
                  title: { type: 'string' },
                  stride_category: {
                    type: 'string',
                    enum: ['Spoofing', 'Tampering', 'Repudiation', 'Information Disclosure', 'Denial of Service', 'Elevation of Privilege']
                  },
                  severity: {
                    type: 'string',
                    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
                  },
                  affected_components: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Node or flow ids from the DFD affected by this threat'
                  },
                  description: { type: 'string' },
                  attack_vector: { type: 'string' },
                  impact: { type: 'string' },
                  likelihood: {
                    type: 'string',
                    enum: ['HIGH', 'MEDIUM', 'LOW']
                  },
                  mitigation: { type: 'string', description: 'Recommended mitigation strategy' },
                  references: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'CWE, OWASP, or other references'
                  }
                }
              }
            }
          }
        },
        risk_registry: {
          type: 'object',
          required: ['summary', 'risks'],
          properties: {
            summary: { type: 'string' },
            risks: {
              type: 'array',
              items: {
                type: 'object',
                required: ['id', 'title', 'category', 'severity', 'description', 'remediation_plan'],
                properties: {
                  id: { type: 'string', description: 'Sequential ID (RISK-001, RISK-002, etc.)' },
                  title: { type: 'string' },
                  category: { type: 'string' },
                  stride_category: { type: 'string' },
                  severity: {
                    type: 'string',
                    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
                  },
                  current_risk_score: { type: 'string' },
                  residual_risk_score: { type: 'string' },
                  description: { type: 'string' },
                  affected_components: {
                    type: 'array',
                    items: { type: 'string' }
                  },
                  business_impact: { type: 'string' },
                  remediation_plan: { type: 'string' },
                  effort_estimate: { type: 'string' },
                  cost_estimate: { type: 'string' },
                  timeline: { type: 'string' },
                  related_threats: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Threat ids from the threat model'
                  }
                }
              }
            }
          }
        },
        recommendations: {
          type: 'array',
          items: {
            type: 'object',
            required: ['title', 'description', 'priority'],
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: {
                type: 'string',
                enum: ['HIGH', 'MEDIUM', 'LOW']
              }
            }
          }
        },
        conclusion: { type: 'string' }
      }
    }
  }
};
