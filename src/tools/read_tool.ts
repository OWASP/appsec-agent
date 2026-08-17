/**
 * Read Tool for the Moonshot agent loop.
 *
 * Returns the contents of a file confined to the working directory. The
 * Claude/Codex SDKs sandbox their own filesystem access; this hand-rolled loop
 * has no sandbox, so path traversal outside the working directory is rejected.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveInsideWorkDir } from './workdir';

const MAX_OUTPUT_SIZE = 50_000;

interface ReadToolInput {
  path: string;
}

interface ReadToolResult {
  content: string;
  error?: string;
}

export function createReadToolHandler(workDir: string) {
  const resolvedWorkDir = path.resolve(workDir);

  return async (input: ReadToolInput): Promise<ReadToolResult> => {
    if (!input || typeof input.path !== 'string' || input.path.length === 0) {
      return { content: '', error: 'path must be a non-empty string' };
    }

    const target = resolveInsideWorkDir(resolvedWorkDir, input.path);
    if (!target) {
      return { content: '', error: `path escapes the working directory: ${input.path}` };
    }

    try {
      // No dedicated LS/Glob tool exists, so reading a directory returns a
      // listing rather than an EISDIR error, keeping the loop navigable.
      const stat = fs.statSync(target);
      if (stat.isDirectory()) {
        const entries = fs
          .readdirSync(target, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort();
        const listing = `Directory listing for ${input.path}:\n${entries.join('\n')}`;
        return { content: listing.slice(0, MAX_OUTPUT_SIZE) };
      }

      const raw = fs.readFileSync(target, 'utf-8');
      if (raw.length > MAX_OUTPUT_SIZE) {
        return {
          content: raw.slice(0, MAX_OUTPUT_SIZE) + '\n... [truncated]',
        };
      }
      return { content: raw };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { content: '', error: err.message ?? 'Failed to read file' };
    }
  };
}

export const READ_TOOL_DEFINITION = {
  name: 'Read',
  description:
    'Read the UTF-8 contents of a file within the project working directory. ' +
    'If the path is a directory, returns a listing of its entries.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string' as const,
        description: 'Path to the file to read, relative to the project working directory.',
      },
    },
    required: ['path'] as const,
  },
};
