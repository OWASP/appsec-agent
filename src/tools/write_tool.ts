/**
 * Write Tool for the DeepInfra agent loop.
 *
 * Creates or overwrites a file confined to the working directory. Only declared
 * when a role has the `write` capability, so declaration is the access gate.
 */

import * as fs from 'fs';
import * as path from 'path';
import { resolveInsideWorkDir } from './workdir';

interface WriteToolInput {
  path: string;
  content: string;
}

interface WriteToolResult {
  ok: boolean;
  bytes_written?: number;
  error?: string;
}

export function createWriteToolHandler(workDir: string) {
  const resolvedWorkDir = path.resolve(workDir);

  return async (input: WriteToolInput): Promise<WriteToolResult> => {
    if (!input || typeof input.path !== 'string' || input.path.length === 0) {
      return { ok: false, error: 'path must be a non-empty string' };
    }
    if (typeof input.content !== 'string') {
      return { ok: false, error: 'content must be a string' };
    }

    const target = resolveInsideWorkDir(resolvedWorkDir, input.path);
    if (!target) {
      return { ok: false, error: `path escapes the working directory: ${input.path}` };
    }

    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, input.content, 'utf-8');
      return { ok: true, bytes_written: Buffer.byteLength(input.content, 'utf-8') };
    } catch (error: unknown) {
      const err = error as { message?: string };
      return { ok: false, error: err.message ?? 'Failed to write file' };
    }
  };
}

export const WRITE_TOOL_DEFINITION = {
  name: 'Write',
  description: 'Create or overwrite a file within the project working directory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string' as const,
        description: 'Path to the file to write, relative to the project working directory.',
      },
      content: {
        type: 'string' as const,
        description: 'The full UTF-8 content to write to the file.',
      },
    },
    required: ['path', 'content'] as const,
  },
};
