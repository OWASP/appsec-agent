/**
 * Diff Context Types for PR-focused Code Review
 * 
 * These types define the structure for passing focused diff context
 * to the AI agent for efficient PR security reviews.
 * 
 * Author: Sam Li
 */

/**
 * Represents a single hunk (changed section) in a file
 */
export interface DiffHunk {
  /** Starting line number of the hunk in the file */
  startLine: number;
  /** Ending line number of the hunk in the file */
  endLine: number;
  /** Lines of code before the changed section (context) */
  beforeContext: string;
  /** The actual diff content with +/- markers */
  changedCode: string;
  /** Lines of code after the changed section (context) */
  afterContext: string;
  /** Function or class signature containing this change (if applicable) */
  containingFunction?: string;
}

/**
 * Represents a single file with its diff context
 */
export interface DiffContextFile {
  /** Path to the file relative to repository root */
  filePath: string;
  /** Programming language of the file */
  language: string;
  /** Type of change: added, modified, or renamed */
  fileType: 'added' | 'modified' | 'renamed' | 'deleted';
  /** Import statements from the file (always included for context) */
  imports?: string;
  /** List of changed hunks in the file */
  hunks: DiffHunk[];
  /** Whether the full file content is available for additional analysis */
  fullFileAvailable?: boolean;
  /** Original filename (only for renamed files) */
  previousFilename?: string;
}

/**
 * Complete diff context for a Pull Request
 */
export interface DiffContext {
  /** Pull Request number */
  prNumber: number;
  /** Base branch name (target of the PR) */
  baseBranch: string;
  /** Head branch name (source of the PR) */
  headBranch: string;
  /** SHA of the head commit */
  headSha: string;
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** List of files with their diff context */
  files: DiffContextFile[];
  /** Total number of files changed in the PR */
  totalFilesChanged: number;
  /** Total lines added across all files */
  totalLinesAdded: number;
  /** Total lines removed across all files */
  totalLinesRemoved: number;
  /** Optional deployment context from project settings */
  deploymentContext?: string;
}

/**
 * Build a formatted prompt section from diff context for AI analysis
 */
export function formatDiffContextForPrompt(context: DiffContext): string {
  const lines: string[] = [];
  
  lines.push('# Pull Request Security Review');
  lines.push('');
  lines.push(`**PR #${context.prNumber}**: ${context.headBranch} → ${context.baseBranch}`);
  lines.push(`**Repository**: ${context.owner}/${context.repo}`);
  lines.push(`**Commit**: ${context.headSha.substring(0, 8)}`);
  lines.push(`**Changes**: ${context.totalFilesChanged} files (+${context.totalLinesAdded}/-${context.totalLinesRemoved})`);
  lines.push('');
  
  if (context.deploymentContext) {
    lines.push('## Deployment Context');
    lines.push(context.deploymentContext);
    lines.push('');
  }
  
  lines.push('## Changed Files');
  lines.push('');
  
  for (const file of context.files) {
    lines.push(`### ${file.filePath} (${file.fileType})`);
    lines.push(`**Language**: ${file.language}`);
    
    if (file.previousFilename) {
      lines.push(`**Renamed from**: ${file.previousFilename}`);
    }
    
    if (file.imports) {
      lines.push('');
      lines.push('**Imports**:');
      lines.push('```');
      lines.push(file.imports);
      lines.push('```');
    }
    
    lines.push('');
    
    for (let i = 0; i < file.hunks.length; i++) {
      const hunk = file.hunks[i];
      lines.push(`#### Change ${i + 1} (lines ${hunk.startLine}-${hunk.endLine})`);
      
      if (hunk.containingFunction) {
        lines.push(`**In**: \`${hunk.containingFunction}\``);
      }
      
      lines.push('');
      
      if (hunk.beforeContext) {
        lines.push('**Before context**:');
        lines.push('```');
        lines.push(hunk.beforeContext);
        lines.push('```');
      }
      
      lines.push('**Changed code**:');
      lines.push('```diff');
      lines.push(hunk.changedCode);
      lines.push('```');
      
      if (hunk.afterContext) {
        lines.push('**After context**:');
        lines.push('```');
        lines.push(hunk.afterContext);
        lines.push('```');
      }
      
      lines.push('');
    }
    
    lines.push('---');
    lines.push('');
  }
  
  return lines.join('\n');
}

/**
 * Validate diff context JSON structure
 */
export function validateDiffContext(data: unknown): data is DiffContext {
  if (!data || typeof data !== 'object') {
    return false;
  }
  
  const ctx = data as Record<string, unknown>;
  
  // Required fields
  if (typeof ctx.prNumber !== 'number') return false;
  if (typeof ctx.baseBranch !== 'string') return false;
  if (typeof ctx.headBranch !== 'string') return false;
  if (typeof ctx.headSha !== 'string') return false;
  if (typeof ctx.owner !== 'string') return false;
  if (typeof ctx.repo !== 'string') return false;
  if (!Array.isArray(ctx.files)) return false;
  if (typeof ctx.totalFilesChanged !== 'number') return false;
  if (typeof ctx.totalLinesAdded !== 'number') return false;
  if (typeof ctx.totalLinesRemoved !== 'number') return false;
  
  // Validate each file
  for (const file of ctx.files) {
    if (!file || typeof file !== 'object') return false;
    if (typeof file.filePath !== 'string') return false;
    if (typeof file.language !== 'string') return false;
    if (!['added', 'modified', 'renamed', 'deleted'].includes(file.fileType)) return false;
    if (!Array.isArray(file.hunks)) return false;
    
    // Validate each hunk
    for (const hunk of file.hunks) {
      if (!hunk || typeof hunk !== 'object') return false;
      if (typeof hunk.startLine !== 'number') return false;
      if (typeof hunk.endLine !== 'number') return false;
      if (typeof hunk.changedCode !== 'string') return false;
    }
  }
  
  return true;
}
