/**
 * E2E: pr_adversary Codex provider with MCP RoleSpec wiring (mocked SDK).
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { Codex } from '@openai/codex-sdk';
import { AgentActions } from '../src/agent_actions';
import { AgentOptions } from '../src/agent_options';
import { roleSpecToCodexClientOptions } from '../src/providers/codex_role_spec';
import { DEFAULT_MCP_SERVER_NAME } from '../src/mcp_internal';
import { SECURITY_REPORT_SCHEMA } from '../src/schemas/security_report';
import { ConfigDict } from '../src/utils';

const validFilteredReport = {
  security_review_report: {
    metadata: {
      project_name: 'e2e',
      total_issues_found: 0,
      scan_type: 'adversarial_pass',
    },
    executive_summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      overview: 'All borderline findings dropped after adversarial review.',
    },
    findings: [],
  },
};

const mockConfDict: ConfigDict = {
  default: {
    pr_adversary: { options: {} },
  },
};

describe('pr_adversary Codex e2e wiring', () => {
  const originalProvider = process.env.AGENT_PROVIDER;
  const TEST_MCP_URL = 'http://127.0.0.1:9999/mcp';

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

  it('wires MCP through RoleSpec -> Codex client config and completes an adversarial pass', async () => {
    (Codex as jest.Mock).mockImplementation(() => ({
      startThread: jest.fn().mockReturnValue({
        runStreamed: jest.fn().mockResolvedValue({
          events: (async function* () {
            yield {
              type: 'item.completed',
              item: {
                id: '1',
                type: 'agent_message',
                text: JSON.stringify(validFilteredReport),
              },
            };
            yield {
              type: 'turn.completed',
              usage: {
                input_tokens: 80,
                output_tokens: 40,
                cached_input_tokens: 0,
                reasoning_output_tokens: 0,
              },
            };
          })(),
        }),
      }),
    }));

    const ao = new AgentOptions(mockConfDict, 'default');
    const roleSpec = ao.getPrAdversaryRoleSpec(
      'pr_adversary',
      '/tmp/src',
      undefined,
      false,
      TEST_MCP_URL,
    );
    const clientOpts = roleSpecToCodexClientOptions(roleSpec);
    expect(clientOpts.config).toEqual(
      expect.objectContaining({
        mcp_servers: {
          [DEFAULT_MCP_SERVER_NAME]: { url: TEST_MCP_URL, enabled: true },
        },
      }),
    );
    expect(roleSpec.outputSchema).toBe(SECURITY_REPORT_SCHEMA);

    const agentActions = new AgentActions(mockConfDict, 'default', {
      role: 'pr_adversary',
      environment: 'default',
      output_format: 'json',
      mcp_server_url: TEST_MCP_URL,
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await agentActions.prAdversaryWithOptions(
      'Adversarial second pass on candidate findings',
      '/tmp/src',
    );

    expect(result).toBe(JSON.stringify(validFilteredReport, null, 2));
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('security_review_report');
    expect(SECURITY_REPORT_SCHEMA.required).toContain('security_review_report');

    consoleSpy.mockRestore();
  });
});
