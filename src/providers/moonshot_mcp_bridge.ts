/**
 * MCP bridge for the Moonshot provider.
 *
 * Moonshot's chat-completions API has no built-in remote-MCP client, so this
 * bridge connects to the role's MCP server over Streamable HTTP, lists its
 * tools, and exposes them to the model as OpenAI functions under the exact
 * `mcp__<name>__<tool>` ids the rest of the codebase assumes (see
 * `claude_role_spec.ts` and `buildPrReviewerMcpNudgeSystemPromptSuffix`).
 *
 * Author: Sam Li
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { RoleMcpConfig } from './role_spec';
import type { OpenAiToolDefinition } from './moonshot_tools';

/** OpenAI function names must be <=64 chars and match this pattern. */
const OPENAI_FUNCTION_NAME_MAX = 64;
const OPENAI_FUNCTION_NAME_RE = /^[a-zA-Z0-9_-]+$/;

export function mcpToolFunctionName(serverName: string, toolName: string): string {
  return `mcp__${serverName}__${toolName}`;
}

export interface McpBridge {
  tools: OpenAiToolDefinition[];
  call(functionName: string, args: Record<string, unknown>): Promise<string>;
  close(): Promise<void>;
}

interface McpListedTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/**
 * Connect to the role's MCP server, list its tools, and return a bridge that
 * proxies OpenAI function calls through to `tools/call`. Callers MUST invoke
 * `close()` in a `finally` to release the transport.
 */
export async function connectMcpBridge(mcp: RoleMcpConfig): Promise<McpBridge> {
  const headers: Record<string, string> = {};
  if (mcp.bearer) {
    headers.Authorization = `Bearer ${mcp.bearer}`;
  }

  const transport = new StreamableHTTPClientTransport(new URL(mcp.url), {
    requestInit: Object.keys(headers).length > 0 ? { headers } : undefined,
  });
  const client = new Client({ name: 'appsec-agent-moonshot', version: '1.0.0' });

  await client.connect(transport);

  const listed = (await client.listTools()) as { tools: McpListedTool[] };

  const nameByFunction = new Map<string, string>();
  const tools: OpenAiToolDefinition[] = [];
  for (const tool of listed.tools) {
    const functionName = mcpToolFunctionName(mcp.name, tool.name);
    if (functionName.length > OPENAI_FUNCTION_NAME_MAX || !OPENAI_FUNCTION_NAME_RE.test(functionName)) {
      await client.close();
      throw new Error(
        `MCP tool "${tool.name}" maps to function name "${functionName}" which exceeds ` +
          `OpenAI's ${OPENAI_FUNCTION_NAME_MAX}-char / [a-zA-Z0-9_-] limit. ` +
          `Use a shorter --mcp-server-name.`,
      );
    }
    nameByFunction.set(functionName, tool.name);
    tools.push({
      type: 'function',
      function: {
        name: functionName,
        description: tool.description ?? tool.name,
        parameters: tool.inputSchema ?? { type: 'object', properties: {} },
      },
    });
  }

  return {
    tools,
    async call(functionName: string, args: Record<string, unknown>): Promise<string> {
      const toolName = nameByFunction.get(functionName);
      if (!toolName) {
        return JSON.stringify({ error: `Unknown MCP tool: ${functionName}` });
      }
      const result = (await client.callTool({ name: toolName, arguments: args })) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };
      const text = (result.content ?? [])
        .map((part) => (part.type === 'text' ? part.text ?? '' : JSON.stringify(part)))
        .join('\n');
      return text || JSON.stringify(result);
    },
    async close(): Promise<void> {
      await client.close();
    },
  };
}
