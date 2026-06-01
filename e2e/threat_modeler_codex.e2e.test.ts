/**
 * E2E wiring: threat_modeler on Codex provider with mocked @openai/codex-sdk.
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { Codex } from '@openai/codex-sdk';
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

describe('threat_modeler Codex e2e wiring', () => {
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

  beforeEach(() => {
    process.env.AGENT_PROVIDER = 'codex';
    jest.clearAllMocks();
  });

  afterEach(() => {
    if (originalProvider === undefined) {
      delete process.env.AGENT_PROVIDER;
    } else {
      process.env.AGENT_PROVIDER = originalProvider;
    }
  });

  it('returns schema-valid structured JSON via CodexProvider', async () => {
    (Codex as jest.Mock).mockImplementation(() => ({
      startThread: jest.fn().mockReturnValue({
        runStreamed: jest.fn().mockResolvedValue({
          events: (async function* () {
            yield {
              type: 'item.completed',
              item: { id: '1', type: 'agent_message', text: JSON.stringify(validReport) },
            };
            yield {
              type: 'turn.completed',
              usage: {
                input_tokens: 200,
                output_tokens: 100,
                cached_input_tokens: 0,
                reasoning_output_tokens: 0,
              },
            };
          })(),
        }),
      }),
    }));

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
