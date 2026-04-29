import { resolveAgentRunMcpFields } from '../resolveAgentRunMcpEnv';

describe('resolveAgentRunMcpFields', () => {
  const saved: { url?: string; bearer?: string } = {};

  beforeEach(() => {
    saved.url = process.env.SAST_INTERNAL_TOOLS_MCP_URL;
    saved.bearer = process.env.SAST_INTERNAL_TOOLS_MCP_BEARER;
    delete process.env.SAST_INTERNAL_TOOLS_MCP_URL;
    delete process.env.SAST_INTERNAL_TOOLS_MCP_BEARER;
  });

  afterEach(() => {
    if (saved.url !== undefined) process.env.SAST_INTERNAL_TOOLS_MCP_URL = saved.url;
    else delete process.env.SAST_INTERNAL_TOOLS_MCP_URL;
    if (saved.bearer !== undefined) process.env.SAST_INTERNAL_TOOLS_MCP_BEARER = saved.bearer;
    else delete process.env.SAST_INTERNAL_TOOLS_MCP_BEARER;
  });

  it('uses CLI URL when env URL is unset', () => {
    const cli = 'http://cli-only/mcp';
    expect(resolveAgentRunMcpFields({ mcpServerUrl: cli })).toEqual({
      mcp_server_url: cli,
      mcp_server_name: undefined,
      mcp_server_bearer: undefined,
    });
  });

  it('prefers SAST_INTERNAL_TOOLS_MCP_URL over CLI when both set', () => {
    process.env.SAST_INTERNAL_TOOLS_MCP_URL = 'http://from-env/mcp';
    expect(
      resolveAgentRunMcpFields({ mcpServerUrl: 'http://from-cli/mcp' }).mcp_server_url,
    ).toBe('http://from-env/mcp');
  });

  it('passes mcp_server_name from CLI only', () => {
    expect(
      resolveAgentRunMcpFields({
        mcpServerUrl: undefined,
        mcpServerName: 'custom-name',
      }).mcp_server_name,
    ).toBe('custom-name');
  });

  it('reads bearer from SAST_INTERNAL_TOOLS_MCP_BEARER', () => {
    process.env.SAST_INTERNAL_TOOLS_MCP_BEARER = '  secret-bearer  ';
    expect(resolveAgentRunMcpFields({}).mcp_server_bearer).toBe('secret-bearer');
  });
});
