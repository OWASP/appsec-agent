/**
 * Assemble OpenAI function tool definitions + local executors for the
 * DeepInfra agent loop from a resolved list of tool names.
 *
 * Author: Sam Li
 */

import { createReadToolHandler, READ_TOOL_DEFINITION } from '../tools/read_tool';
import { createGrepToolHandler, GREP_TOOL_DEFINITION } from '../tools/grep_tool';
import { createWriteToolHandler, WRITE_TOOL_DEFINITION } from '../tools/write_tool';
import { createBashToolHandler, BASH_TOOL_DEFINITION } from '../tools/bash_tool';

export interface OpenAiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

export interface LocalTools {
  definitions: OpenAiToolDefinition[];
  handlers: Map<string, ToolHandler>;
}

function toOpenAiTool(def: {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}): OpenAiToolDefinition {
  return {
    type: 'function',
    function: {
      name: def.name,
      description: def.description,
      parameters: def.inputSchema,
    },
  };
}

/**
 * Build tool definitions and executors for the given tool names, rooted at
 * `workDir`. Unknown names (e.g. `Graphviz`, which is a no-op on the Claude
 * path too) are skipped rather than exposed as broken functions.
 */
export function buildLocalTools(toolNames: string[], workDir: string): LocalTools {
  const definitions: OpenAiToolDefinition[] = [];
  const handlers = new Map<string, ToolHandler>();

  // Each concrete handler declares a narrower input type than the generic
  // ToolHandler; the model may send arbitrary JSON, so wrap and forward.
  const wrap = <T>(handler: (input: T) => Promise<unknown>): ToolHandler =>
    (args: Record<string, unknown>) => handler(args as T);

  for (const name of toolNames) {
    switch (name) {
      case 'Read':
        definitions.push(toOpenAiTool(READ_TOOL_DEFINITION));
        handlers.set('Read', wrap(createReadToolHandler(workDir)));
        break;
      case 'Grep':
        definitions.push(toOpenAiTool(GREP_TOOL_DEFINITION));
        handlers.set('Grep', wrap(createGrepToolHandler(workDir)));
        break;
      case 'Write':
        definitions.push(toOpenAiTool(WRITE_TOOL_DEFINITION));
        handlers.set('Write', wrap(createWriteToolHandler(workDir)));
        break;
      case 'Bash':
        definitions.push(toOpenAiTool(BASH_TOOL_DEFINITION));
        handlers.set('Bash', wrap(createBashToolHandler(workDir)));
        break;
      default:
        // Graphviz and any other non-executable capability are no-ops here,
        // matching the Claude path where they are not real SDK tools.
        break;
    }
  }

  return { definitions, handlers };
}
