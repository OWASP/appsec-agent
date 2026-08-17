/**
 * Tests for the Moonshot MCP bridge: exact mcp__<name>__<tool> naming, the
 * 64-char function-name guard, and tools/call proxying.
 */

const mockConnect = jest.fn();
const mockListTools = jest.fn();
const mockCallTool = jest.fn();
const mockClose = jest.fn();

jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    callTool: mockCallTool,
    close: mockClose,
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url: URL, opts: unknown) => ({ url, opts })),
}));

import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { connectMcpBridge, mcpToolFunctionName } from '../providers/moonshot_mcp_bridge';
import type { RoleMcpConfig } from '../providers/role_spec';

function mcpConfig(overrides: Partial<RoleMcpConfig> = {}): RoleMcpConfig {
  return {
    url: 'https://mcp.test/stream',
    name: 'appsec-internal',
    bearer: 'secret',
    toolNames: [],
    ...overrides,
  };
}

describe('connectMcpBridge', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockListTools.mockReset();
    mockCallTool.mockReset();
    mockClose.mockReset().mockResolvedValue(undefined);
    (StreamableHTTPClientTransport as jest.Mock).mockClear();
  });

  it('exposes tools under mcp__<name>__<tool> and forwards the bearer header', async () => {
    mockListTools.mockResolvedValue({
      tools: [{ name: 'queryFindingsHistory', description: 'history', inputSchema: { type: 'object' } }],
    });

    const bridge = await connectMcpBridge(mcpConfig());
    expect(bridge.tools).toHaveLength(1);
    expect(bridge.tools[0].function.name).toBe('mcp__appsec-internal__queryFindingsHistory');

    const opts = (StreamableHTTPClientTransport as jest.Mock).mock.calls[0][1];
    expect(opts.requestInit.headers.Authorization).toBe('Bearer secret');
  });

  it('proxies calls through tools/call and returns the text content', async () => {
    mockListTools.mockResolvedValue({ tools: [{ name: 'queryImportGraph' }] });
    mockCallTool.mockResolvedValue({ content: [{ type: 'text', text: 'graph-data' }] });

    const bridge = await connectMcpBridge(mcpConfig());
    const out = await bridge.call('mcp__appsec-internal__queryImportGraph', { path: 'a.ts' });
    expect(mockCallTool).toHaveBeenCalledWith({ name: 'queryImportGraph', arguments: { path: 'a.ts' } });
    expect(out).toBe('graph-data');
  });

  it('rejects a function name that exceeds the 64-char limit', async () => {
    mockListTools.mockResolvedValue({ tools: [{ name: 'x'.repeat(60) }] });
    await expect(connectMcpBridge(mcpConfig({ name: 'a'.repeat(20) }))).rejects.toThrow(/64-char/);
    expect(mockClose).toHaveBeenCalled();
  });

  it('closes the transport', async () => {
    mockListTools.mockResolvedValue({ tools: [] });
    const bridge = await connectMcpBridge(mcpConfig());
    await bridge.close();
    expect(mockClose).toHaveBeenCalled();
  });
});

describe('mcpToolFunctionName', () => {
  it('matches the codebase-wide mcp__ id shape', () => {
    expect(mcpToolFunctionName('appsec-internal', 'queryFindingsHistory')).toBe(
      'mcp__appsec-internal__queryFindingsHistory',
    );
  });
});
