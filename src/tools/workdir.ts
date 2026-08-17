/**
 * Working-directory confinement helper shared by the local file tools.
 *
 * The Moonshot provider runs a hand-rolled tool loop with no runtime sandbox
 * (unlike the Claude/Codex SDKs). Every file path a tool receives must be
 * resolved and checked so a prompt-injected model cannot read or overwrite
 * files outside the project working directory.
 */

import * as path from 'path';

/**
 * Resolve `requestedPath` (relative to `workDir`) and return the absolute path
 * only if it stays inside `workDir`. Returns null when the path escapes.
 */
export function resolveInsideWorkDir(workDir: string, requestedPath: string): string | null {
  const root = path.resolve(workDir);
  const resolved = path.resolve(root, requestedPath);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    return null;
  }
  return resolved;
}
