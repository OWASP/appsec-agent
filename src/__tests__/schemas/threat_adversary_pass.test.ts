import {
  buildThreatAdversaryUserPrompt,
  parseThreatAdversaryPassContext,
} from '../../schemas/threat_adversary_pass';

describe('threat_adversary_pass', () => {
  const validContext = {
    threat_model_report: {
      metadata: {
        project_name: 'app',
        scan_date: '2026-01-01',
        methodology: 'STRIDE',
        total_threats_identified: 1,
        total_risks_identified: 1,
      },
      data_flow_diagram: {
        description: 'd',
        nodes: [],
        data_flows: [],
        trust_boundaries: [],
      },
      threat_model: {
        executive_summary: 's',
        threats: [
          {
            id: 'THREAT-001',
            title: 'Cookie leak',
            stride_category: 'Information Disclosure',
            severity: 'HIGH',
            affected_components: ['node-1'],
            description: 'desc',
            impact: 'impact',
            likelihood: 'HIGH',
            mitigation: 'mitigate',
          },
        ],
      },
      risk_registry: {
        summary: 'r',
        risks: [
          {
            id: 'RISK-001',
            title: 'Risk',
            category: 'Data',
            severity: 'HIGH',
            description: 'd',
            remediation_plan: 'fix',
            related_threats: ['THREAT-001'],
          },
        ],
      },
    },
  };

  it('parses valid first-pass report', () => {
    const ctx = parseThreatAdversaryPassContext(validContext);
    expect(ctx.threat_model_report.threat_model.threats).toHaveLength(1);
  });

  it('rejects missing threat_model_report', () => {
    expect(() => parseThreatAdversaryPassContext({})).toThrow(/threat_model_report/);
  });

  it('buildThreatAdversaryUserPrompt includes keep/drop and source_locations language', () => {
    const prompt = buildThreatAdversaryUserPrompt(parseThreatAdversaryPassContext(validContext), {});
    expect(prompt).toContain('concrete');
    expect(prompt).toContain('source_locations');
    expect(prompt).toContain('Do not fabricate');
  });
});
