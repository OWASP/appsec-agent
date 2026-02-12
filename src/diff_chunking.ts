/**
 * PR diff chunking: token estimation, file filtering, and batching.
 * Kept in a separate module for easier tracking and rework (e.g. if 1M-context models reduce need for chunking).
 *
 * Author: Sam Li
 */

import { DiffContext, DiffContextFile, formatDiffContextForPrompt } from './diff_context';

/** Approximate chars per token for English/code. Used for prompt size estimation. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count for a string (approximate).
 */
export function estimateTokens(text: string): number {
  if (!text || text.length === 0) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export interface ChunkingOptions {
  /** Max tokens per batch (prompt body). 0 = no chunking. */
  maxTokensPerBatch: number;
  /** Max number of batches per run. */
  maxBatches: number;
  /** Optional cap on number of files to include; rest are skipped. */
  maxFiles?: number;
  /** Optional path patterns to exclude (prefix or glob-like *). e.g. "src/analytics/" or "src/analytics/*". */
  excludePaths?: string[];
}

export interface ChunkingResult {
  /** Batches to review (each under token limit). */
  batches: DiffContext[];
  /** Files excluded by excludePaths or maxFiles. */
  skippedFiles: DiffContextFile[];
  /** True if more batches would have been needed but maxBatches was reached. */
  skippedDueToBatches: boolean;
}

/**
 * Check if a file path matches any exclude pattern.
 * Patterns: prefix match (e.g. "src/analytics/") or suffix "*" for prefix (e.g. "src/analytics/*").
 */
function pathMatchesExclude(filePath: string, excludePaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  for (const pattern of excludePaths) {
    const p = pattern.replace(/\\/g, '/').trim();
    if (p.endsWith('*')) {
      const prefix = p.slice(0, -1);
      if (normalized.startsWith(prefix) || normalized === prefix.slice(0, -1)) return true;
    } else {
      if (normalized.startsWith(p) || normalized === p) return true;
    }
  }
  return false;
}

/**
 * Compute total lines added/removed for a list of files from their hunks.
 */
function sumLinesForFiles(files: DiffContextFile[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const file of files) {
    for (const hunk of file.hunks) {
      const code = hunk.changedCode || '';
      const lines = code.split('\n');
      for (const line of lines) {
        if (line.startsWith('+') && !line.startsWith('+++')) added += 1;
        else if (line.startsWith('-') && !line.startsWith('---')) removed += 1;
      }
    }
  }
  return { added, removed };
}

/**
 * Build a DiffContext with the given files and same metadata as the parent context.
 */
function buildBatchContext(parent: DiffContext, files: DiffContextFile[]): DiffContext {
  const { added, removed } = sumLinesForFiles(files);
  return {
    ...parent,
    files,
    totalFilesChanged: files.length,
    totalLinesAdded: added,
    totalLinesRemoved: removed
  };
}

/**
 * Filter and batch diff context for chunked PR review.
 * Applies exclude paths, maxFiles, then groups files into batches under maxTokensPerBatch, capped by maxBatches.
 */
export function splitIntoBatches(context: DiffContext, options: ChunkingOptions): ChunkingResult {
  const { maxTokensPerBatch, maxBatches, maxFiles, excludePaths } = options;

  let files = context.files;

  // Apply exclude paths
  const skippedByExclude: DiffContextFile[] = [];
  if (excludePaths && excludePaths.length > 0) {
    const included: DiffContextFile[] = [];
    for (const f of files) {
      if (pathMatchesExclude(f.filePath, excludePaths)) {
        skippedByExclude.push(f);
      } else {
        included.push(f);
      }
    }
    files = included;
  }

  // Apply maxFiles
  const skippedByMaxFiles: DiffContextFile[] = [];
  if (maxFiles !== undefined && maxFiles > 0 && files.length > maxFiles) {
    skippedByMaxFiles.push(...files.slice(maxFiles));
    files = files.slice(0, maxFiles);
  }

  const allSkippedFiles = [...skippedByExclude, ...skippedByMaxFiles];

  // No chunking: single batch if under limit
  if (maxTokensPerBatch <= 0) {
    const batchCtx = buildBatchContext(context, files);
    const promptText = formatDiffContextForPrompt(batchCtx);
    const tokens = estimateTokens(promptText);
    return {
      batches: files.length > 0 ? [batchCtx] : [],
      skippedFiles: allSkippedFiles,
      skippedDueToBatches: false
    };
  }

  // Build batches by adding files until the next would exceed maxTokensPerBatch
  const batches: DiffContext[] = [];
  let currentFiles: DiffContextFile[] = [];
  const promptOverhead = estimateTokens(
    'You are reviewing a Pull Request for security vulnerabilities.\n\n## Review Instructions\n\nAnalyze ONLY the changed code...'
  );

  for (const file of files) {
    const nextFiles = [...currentFiles, file];
    const nextContext = buildBatchContext(context, nextFiles);
    const nextPrompt = formatDiffContextForPrompt(nextContext);
    const nextTokens = estimateTokens(nextPrompt) + promptOverhead;

    // If this single file alone exceeds the batch limit, put it in its own batch (graceful degradation)
    if (currentFiles.length === 0 && nextTokens > maxTokensPerBatch) {
      batches.push(buildBatchContext(context, [file]));
      if (batches.length >= maxBatches) break;
      continue;
    }

    if (nextTokens > maxTokensPerBatch && currentFiles.length > 0) {
      batches.push(buildBatchContext(context, [...currentFiles]));
      if (batches.length >= maxBatches) break;
      currentFiles = [file];
    } else {
      currentFiles = nextFiles;
    }
  }

  if (currentFiles.length > 0 && batches.length < maxBatches) {
    batches.push(buildBatchContext(context, currentFiles));
  }

  const totalFilesInBatches = batches.reduce((sum, b) => sum + b.files.length, 0);
  const skippedDueToBatches = files.length > 0 && totalFilesInBatches < files.length;

  return {
    batches,
    skippedFiles: allSkippedFiles,
    skippedDueToBatches
  };
}
