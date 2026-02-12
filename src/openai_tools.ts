/**
 * OpenAI fallback tools: write_file and stream accumulation.
 * Kept in a separate file so the write tool can be identified and maintained easily.
 *
 * Author: Sam Li
 */

import * as fs from 'fs';
import type OpenAI from 'openai';
import { validateOutputFilePath } from './utils';

/** OpenAI tool definition for writing a file (matches Anthropic Write tool behavior). */
export const WRITE_FILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'write_file',
    description:
      'Write content to a file at the given path. Use a relative path under the current working directory. Create the file or overwrite it.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Relative path to the file (e.g. code_review_report.md)'
        },
        content: {
          type: 'string',
          description: 'Full text content to write to the file'
        }
      },
      required: ['path', 'content']
    }
  }
};

export type ToolCall = OpenAI.Chat.ChatCompletionMessageToolCall;

/**
 * Accumulate streaming chunks into a full ChatCompletionMessage (content + tool_calls).
 * Mirrors OpenAI stream-with-tools behavior so we can execute tool_calls after the stream.
 */
export function messageReducer(
  previous: OpenAI.Chat.ChatCompletionMessage,
  chunk: OpenAI.Chat.ChatCompletionChunk
): OpenAI.Chat.ChatCompletionMessage {
  const choice = chunk.choices?.[0];
  if (!choice?.delta) return previous;

  const delta = choice.delta as OpenAI.Chat.ChatCompletionChunk.Choice.Delta;
  const acc = { ...previous } as OpenAI.Chat.ChatCompletionMessage;

  const accRecord = acc as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(delta)) {
    if (value === undefined) continue;
    const k = key as keyof typeof delta;
    if (accRecord[k] === undefined || accRecord[k] === null) {
      accRecord[k] = Array.isArray(value)
        ? value.map((v: { index?: number }) => {
            const { index: _i, ...rest } = v as { index?: number };
            return rest;
          })
        : value;
    } else if (typeof accRecord[k] === 'string' && typeof value === 'string') {
      accRecord[k] = (accRecord[k] as string) + value;
    } else if (Array.isArray(accRecord[k]) && Array.isArray(value)) {
      const accArray = accRecord[k] as unknown[];
      for (let i = 0; i < value.length; i++) {
        const chunkItem = value[i] as { index?: number; [k: string]: unknown };
        const { index, ...rest } = chunkItem;
        const idx = index ?? i;
        if (idx >= accArray.length) {
          accArray[idx] = rest;
        } else {
          const existing = accArray[idx] as Record<string, unknown>;
          accArray[idx] = mergeToolCallPart(existing, rest);
        }
      }
    } else if (
      typeof accRecord[k] === 'object' &&
      accRecord[k] !== null &&
      typeof value === 'object' &&
      value !== null
    ) {
      accRecord[k] = mergeToolCallPart(
        accRecord[k] as unknown as Record<string, unknown>,
        value as Record<string, unknown>
      );
    }
  }
  return accRecord as unknown as OpenAI.Chat.ChatCompletionMessage;
}

function mergeToolCallPart(
  existing: Record<string, unknown>,
  part: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...existing };
  for (const [k, v] of Object.entries(part)) {
    if (v === undefined) continue;
    if (out[k] === undefined || out[k] === null) {
      out[k] = v;
    } else if (typeof out[k] === 'string' && typeof v === 'string') {
      out[k] = (out[k] as string) + v;
    } else if (typeof out[k] === 'object' && typeof v === 'object' && v !== null) {
      out[k] = mergeToolCallPart(
        (out[k] as Record<string, unknown>) ?? {},
        v as Record<string, unknown>
      );
    }
  }
  return out;
}

export type WriteToolResult = { tool_call_id: string; success: boolean; error?: string };

/**
 * Execute write_file tool calls: validate path under baseDir and write content.
 * Returns one result per tool call (success or error message).
 */
export function executeWriteToolCalls(
  toolCalls: ToolCall[],
  baseDir: string
): WriteToolResult[] {
  const results: WriteToolResult[] = [];
  for (const call of toolCalls) {
    if (call.type !== 'function' || call.function?.name !== 'write_file') {
      results.push({
        tool_call_id: call.id,
        success: false,
        error: `Unknown tool: ${(call as { function?: { name?: string } }).function?.name ?? 'unknown'}`
      });
      continue;
    }
    let args: { path?: string; content?: string };
    try {
      args = JSON.parse(
        typeof call.function.arguments === 'string'
          ? call.function.arguments
          : JSON.stringify(call.function.arguments)
      ) as { path?: string; content?: string };
    } catch {
      results.push({ tool_call_id: call.id, success: false, error: 'Invalid JSON arguments' });
      continue;
    }
    const pathArg = args.path;
    const content = args.content;
    if (pathArg === undefined || content === undefined) {
      results.push({
        tool_call_id: call.id,
        success: false,
        error: 'Missing path or content'
      });
      continue;
    }
    const resolvedPath = validateOutputFilePath(pathArg, baseDir);
    if (resolvedPath === null) {
      results.push({
        tool_call_id: call.id,
        success: false,
        error: 'Invalid or disallowed path'
      });
      continue;
    }
    try {
      fs.writeFileSync(resolvedPath, content, 'utf8');
      results.push({ tool_call_id: call.id, success: true });
    } catch (e) {
      results.push({
        tool_call_id: call.id,
        success: false,
        error: e instanceof Error ? e.message : String(e)
      });
    }
  }
  return results;
}
