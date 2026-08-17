/**
 * Grep Tool for the Moonshot agent loop.
 *
 * Thin wrapper over ripgrep (`rg`), confined to the working directory with a
 * bounded output size so a broad search cannot blow the context window.
 */

import { execFileSync } from 'child_process';
import * as path from 'path';

const MAX_OUTPUT_SIZE = 50_000;
const MAX_MATCHES = 200;

interface GrepToolInput {
  pattern: string;
  path?: string;
  glob?: string;
}

interface GrepToolResult {
  output: string;
  error?: string;
}

export function createGrepToolHandler(workDir: string, timeoutMs: number = 60_000) {
  const resolvedWorkDir = path.resolve(workDir);

  return async (input: GrepToolInput): Promise<GrepToolResult> => {
    if (!input || typeof input.pattern !== 'string' || input.pattern.length === 0) {
      return { output: '', error: 'pattern must be a non-empty string' };
    }

    const args = ['--line-number', '--no-heading', '--color', 'never', '--max-count', String(MAX_MATCHES)];
    if (input.glob && typeof input.glob === 'string') {
      args.push('--glob', input.glob);
    }
    args.push('--regexp', input.pattern);
    // Restrict the search root to a relative subpath, never an absolute one.
    args.push(input.path && !path.isAbsolute(input.path) ? input.path : '.');

    try {
      const stdout = execFileSync('rg', args, {
        cwd: resolvedWorkDir,
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_SIZE * 4,
      });
      return { output: stdout.slice(0, MAX_OUTPUT_SIZE) };
    } catch (error: unknown) {
      const err = error as { status?: number; stdout?: string; stderr?: string; message?: string };
      // ripgrep exits 1 with no output when there are simply no matches.
      if (err.status === 1 && !err.stderr) {
        return { output: 'No matches found.' };
      }
      return {
        output: (err.stdout ?? '').slice(0, MAX_OUTPUT_SIZE),
        error: (err.stderr ?? err.message ?? 'Search failed').slice(0, 2_000),
      };
    }
  };
}

export const GREP_TOOL_DEFINITION = {
  name: 'Grep',
  description: 'Search file contents with a regular expression (ripgrep) within the project working directory.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      pattern: {
        type: 'string' as const,
        description: 'The regular expression to search for.',
      },
      path: {
        type: 'string' as const,
        description: 'Optional relative subdirectory or file to restrict the search to.',
      },
      glob: {
        type: 'string' as const,
        description: 'Optional glob filter, e.g. "*.ts".',
      },
    },
    required: ['pattern'] as const,
  },
};
