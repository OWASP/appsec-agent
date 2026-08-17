/**
 * E2E wiring: threat_modeler on the Moonshot provider with the openai SDK mock.
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { __reset, __setChatResponses } from '../src/__tests__/mocks/openai_sdk';
import { __resetModelListCache } from '../src/providers/moonshot_model';
import { AgentActions } from '../src/agent_actions';
import { ConfigDict } from '../src/utils';
import { THREAT_MODEL_REPORT_SCHEMA } from '../src/schemas/threat_model_report';

const validReport = {
  threat_model_report: {
    metadata: {
      project_name: 'e2e',
      scan_date: '2026-06-01',
      methodology: 'STRIDE',
      total_threats_identified: 1,
      total_risks_identified: 1,
    },
    data_flow_diagram: {
      description: 'dfd',
      nodes: [],
      data_flows: [],
      trust_boundaries: [],
    },
    threat_model: { executive_summary: 'summary', threats: [] },
    risk_registry: { summary: 'risks', risks: [] },
  },
};

describe('threat_modeler Moonshot e2e wiring', () => {
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

  const originalProvider = process.env.AGENT_PROVIDER;
  const originalKey = process.env.MOONSHOT_API_KEY;

  beforeEach(() => {
    process.env.AGENT_PROVIDER = 'moonshot';
    process.env.MOONSHOT_API_KEY = 'test-key';
    __reset();
    __resetModelListCache();
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.AGENT_PROVIDER;
    else process.env.AGENT_PROVIDER = originalProvider;
    if (originalKey === undefined) delete process.env.MOONSHOT_API_KEY;
    else process.env.MOONSHOT_API_KEY = originalKey;
  });

  it('returns schema-valid structured JSON via MoonshotProvider', async () => {
    __setChatResponses([[
      { choices: [{ delta: { content: JSON.stringify(validReport) }, finish_reason: 'stop' }] },
      { choices: [{ finish_reason: null }], usage: { prompt_tokens: 200, completion_tokens: 100 } },
    ]]);

    const agentActions = new AgentActions(mockConfDict, 'default', {
      role: 'threat_modeler',
      environment: 'default',
      output_format: 'json',
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await agentActions.threatModelerAgentWithOptions('Threat model scan', '/tmp/src');

    expect(result).toBe(JSON.stringify(validReport, null, 2));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^Tokens input: /));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringMatching(/^Tokens output: /));

    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('threat_model_report');
    expect(THREAT_MODEL_REPORT_SCHEMA.required).toContain('threat_model_report');

    consoleSpy.mockRestore();
  });
});
