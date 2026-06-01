/**
 * E2E: pr_reviewer Codex provider with MCP RoleSpec wiring (mocked SDK).
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { Codex } from '@openai/codex-sdk';
import { AgentActions } from '../src/agent_actions';
import { AgentOptions } from '../src/agent_options';
import { roleSpecToCodexClientOptions } from '../src/providers/codex_role_spec';
import { DEFAULT_MCP_SERVER_NAME } from '../src/mcp_internal';
import { ConfigDict } from '../src/utils';

const mockConfDict: ConfigDict = {
  default: {
    pr_reviewer: { options: {} },
  },
};

describe('pr_reviewer Codex MCP e2e wiring', () => {
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

  it('wires MCP through RoleSpec -> Codex client config and completes a diff review run', async () => {
    (Codex as jest.Mock).mockImplementation(() => ({
      startThread: jest.fn().mockReturnValue({
        runStreamed: jest.fn().mockResolvedValue({
          events: (async function* () {
            yield {
              type: 'turn.completed',
              usage: {
                input_tokens: 50,
                output_tokens: 25,
                cached_input_tokens: 0,
                reasoning_output_tokens: 0,
              },
            };
          })(),
        }),
      }),
    }));

    const ao = new AgentOptions(mockConfDict, 'default');
    const roleSpec = ao.getDiffReviewerRoleSpec(
      'pr_reviewer',
      '/tmp/src',
      'json',
      undefined,
      false,
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

    const agentActions = new AgentActions(mockConfDict, 'default', {
      role: 'pr_reviewer',
      environment: 'default',
      output_format: 'json',
      mcp_server_url: TEST_MCP_URL,
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await agentActions.diffReviewerWithOptions('Review PR diff', '/tmp/src');
    consoleSpy.mockRestore();
  });
});
