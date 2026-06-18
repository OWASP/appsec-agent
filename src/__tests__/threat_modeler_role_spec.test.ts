/**
 * Golden parity: RoleSpec -> ClaudeProvider Options reproduces historic threat_modeler shape.
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { AgentOptions } from '../agent_options';
import { roleSpecToClaudeOptions } from '../providers/claude_role_spec';
import { ConfigDict } from '../utils';
import { THREAT_MODEL_REPORT_SCHEMA } from '../schemas/threat_model_report';

describe('threat_modeler RoleSpec golden parity', () => {
  const mockConfDict: ConfigDict = {
    default: {
      threat_modeler: {
        options: {
          system_prompt: 'Threat modeler system prompt',
          max_turns: 20,
        },
      },
    },
  };
  const environment = 'default';

  it('RoleSpec -> Claude Options matches getThreatModelerOptions for markdown', () => {
    const agentOptions = new AgentOptions(mockConfDict, environment);
    const fromLegacy = agentOptions.getThreatModelerOptions('threat_modeler', 'markdown');
    const fromSpec = roleSpecToClaudeOptions(
      agentOptions.getThreatModelerRoleSpec('threat_modeler', 'markdown'),
    );
    expect(fromSpec).toEqual(fromLegacy);
  });

  it('RoleSpec -> Claude Options matches getThreatModelerOptions for json', () => {
    const agentOptions = new AgentOptions(mockConfDict, environment);
    const fromLegacy = agentOptions.getThreatModelerOptions('threat_modeler', 'json');
    const fromSpec = roleSpecToClaudeOptions(
      agentOptions.getThreatModelerRoleSpec('threat_modeler', 'json'),
    );
    expect(fromSpec).toEqual(fromLegacy);
    expect(fromSpec.outputFormat).toEqual({
      type: 'json_schema',
      schema: THREAT_MODEL_REPORT_SCHEMA,
    });
    expect(fromSpec.agents?.['threat-modeler'].tools).toEqual(['Read', 'Grep']);
    expect(fromSpec.permissionMode).toBe('bypassPermissions');
  });

  it('json RoleSpec sets read-only capabilities and output schema', () => {
    const agentOptions = new AgentOptions(mockConfDict, environment);
    const spec = agentOptions.getThreatModelerRoleSpec('threat_modeler', 'json', '/tmp/scan');
    expect(spec.roleId).toBe('threat_modeler');
    expect(spec.agentName).toBe('threat-modeler');
    expect(spec.capabilities).toEqual({ read: true, grep: true });
    expect(spec.outputSchema).toBe(THREAT_MODEL_REPORT_SCHEMA);
    expect(spec.workingDirectory).toBe('/tmp/scan');
    expect(spec.maxTurns).toBe(20);
  });

  it('honors maxTurns override over config default', () => {
    const agentOptions = new AgentOptions(mockConfDict, environment);
    const spec = agentOptions.getThreatModelerRoleSpec('threat_modeler', 'json', undefined, 42);
    expect(spec.maxTurns).toBe(42);
  });

  it('defaults maxTurns to 100 when config omits max_turns', () => {
    const agentOptions = new AgentOptions({ default: { threat_modeler: { options: {} } } }, 'default');
    const spec = agentOptions.getThreatModelerRoleSpec('threat_modeler', 'json');
    expect(spec.maxTurns).toBe(100);
  });
});
