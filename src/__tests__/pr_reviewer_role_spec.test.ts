/**
 * Golden parity: RoleSpec -> Claude Options for pr_reviewer MCP wiring (Phase 4).
 */

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));

import { AgentOptions } from '../agent_options';
import { roleSpecToClaudeOptions } from '../providers/claude_role_spec';
import { buildMcpInternalToolNames, DEFAULT_MCP_SERVER_NAME } from '../mcp_internal';
import { ConfigDict } from '../utils';

describe('pr_reviewer RoleSpec MCP golden parity', () => {
  const confDict: ConfigDict = {
    default: {
      pr_reviewer: { options: {} },
    },
  };

  it('RoleSpec -> Claude Options matches getDiffReviewerOptions with MCP', () => {
    const ao = new AgentOptions(confDict, 'default');
    const url = 'http://127.0.0.1:9999/mcp';
    const fromLegacy = ao.getDiffReviewerOptions('pr_reviewer', null, 'json', undefined, false, false, url);
    const fromSpec = roleSpecToClaudeOptions(
      ao.getDiffReviewerRoleSpec('pr_reviewer', null, 'json', undefined, false, false, url),
    );
    expect(fromSpec).toEqual(fromLegacy);
    expect(fromSpec.mcpServers).toEqual({
      [DEFAULT_MCP_SERVER_NAME]: { type: 'http', url },
    });
    expect((fromSpec.agents as any)['diff-reviewer'].tools).toEqual([
      'Read',
      'Grep',
      'Write',
      ...buildMcpInternalToolNames(),
    ]);
  });
});
