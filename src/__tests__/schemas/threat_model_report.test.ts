import {
  SOURCE_LOCATION_SCHEMA,
  SOURCE_LOCATIONS_ARRAY_SCHEMA,
  THREAT_MODEL_REPORT_SCHEMA,
} from '../../schemas/threat_model_report';

describe('THREAT_MODEL_REPORT_SCHEMA source_locations', () => {
  it('declares source_locations on threats, risks, and nodes', () => {
    const tmr = THREAT_MODEL_REPORT_SCHEMA.properties as Record<string, unknown>;
    const report = (tmr.threat_model_report as Record<string, unknown>).properties as Record<
      string,
      unknown
    >;
    const threatItems = (
      ((report.threat_model as Record<string, unknown>).properties as Record<string, unknown>)
        .threats as Record<string, unknown>
    ).items as Record<string, unknown>;
    const threatProps = threatItems.properties as Record<string, unknown>;
    expect(threatProps.source_locations).toEqual(SOURCE_LOCATIONS_ARRAY_SCHEMA);

    const riskItems = (
      ((report.risk_registry as Record<string, unknown>).properties as Record<string, unknown>)
        .risks as Record<string, unknown>
    ).items as Record<string, unknown>;
    const riskProps = riskItems.properties as Record<string, unknown>;
    expect(riskProps.source_locations).toEqual(SOURCE_LOCATIONS_ARRAY_SCHEMA);

    const nodeItems = (
      ((report.data_flow_diagram as Record<string, unknown>).properties as Record<string, unknown>)
        .nodes as Record<string, unknown>
    ).items as Record<string, unknown>;
    const nodeProps = nodeItems.properties as Record<string, unknown>;
    expect(nodeProps.source_locations).toEqual(SOURCE_LOCATIONS_ARRAY_SCHEMA);
  });

  it('requires file on SourceLocation items', () => {
    expect(SOURCE_LOCATION_SCHEMA.required).toContain('file');
  });
});
