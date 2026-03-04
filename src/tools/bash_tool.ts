/**
 * Restricted Bash Tool for QA Verification
 * 
 * Provides controlled shell access for the qa_verifier agent role.
 * Enforces security constraints: command validation, timeout, working
 * directory isolation, and output size limits.
 */

import { execSync } from 'child_process';
import * as path from 'path';

const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\//,
  /mkfs\b/,
  /dd\s+if=/,
  />\s*\/dev\/sd/,
  /chmod\s+777\s+\//,
  /curl\s.*\|\s*(ba)?sh/,
  /wget\s.*\|\s*(ba)?sh/,
  /eval\s/,
  /\bsudo\b/,
  /\bsu\s/,
  /\/etc\/passwd/,
  /\/etc\/shadow/,
];

const MAX_OUTPUT_SIZE = 50_000;

interface BashToolInput {
  command: string;
}

interface BashToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

function validateBashCommand(command: string): string | null {
  if (!command || typeof command !== 'string') {
    return 'Command must be a non-empty string';
  }
  if (command.length > 10_000) {
    return 'Command exceeds maximum length (10000 chars)';
  }
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      return `Command blocked by security policy: matches dangerous pattern`;
    }
  }
  return null;
}

export function createBashToolHandler(workDir: string, timeoutMs: number = 120_000) {
  const resolvedWorkDir = path.resolve(workDir);

  return async (input: BashToolInput): Promise<BashToolResult> => {
    const validationError = validateBashCommand(input.command);
    if (validationError) {
      return { stdout: '', stderr: validationError, exitCode: 1 };
    }

    try {
      const stdout = execSync(input.command, {
        cwd: resolvedWorkDir,
        encoding: 'utf-8',
        timeout: timeoutMs,
        maxBuffer: MAX_OUTPUT_SIZE * 2,
        env: {
          ...process.env,
          NODE_ENV: 'test',
          CI: 'true',
        },
      });

      return {
        stdout: stdout.slice(-MAX_OUTPUT_SIZE),
        stderr: '',
        exitCode: 0,
      };
    } catch (error: unknown) {
      const err = error as { status?: number; stdout?: string; stderr?: string; message?: string };
      return {
        stdout: (err.stdout || '').slice(-MAX_OUTPUT_SIZE),
        stderr: (err.stderr || err.message || 'Command failed').slice(-MAX_OUTPUT_SIZE),
        exitCode: err.status || 1,
      };
    }
  };
}

export const BASH_TOOL_DEFINITION = {
  name: 'Bash',
  description: 'Execute a shell command in the project working directory. Use this to run tests, install dependencies, or inspect the project.',
  inputSchema: {
    type: 'object' as const,
    properties: {
      command: {
        type: 'string' as const,
        description: 'The shell command to execute',
      },
    },
    required: ['command'] as const,
  },
};
