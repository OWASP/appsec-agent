/**
 * Merge PR review batch reports into a single output file.
 * Kept in a separate module for easier tracking and rework.
 *
 * Author: Sam Li
 */

import * as fs from 'fs-extra';
import * as path from 'path';

export interface MergeOptions {
  /** Paths to batch report files in order. */
  batchPaths: string[];
  /** Final output file path. */
  outputPath: string;
  /** Output format: json, markdown, etc. */
  format: string;
  /** Total API cost (sum of batches) for metadata. */
  totalCostUsd?: number;
  /** Per-batch costs for metadata. */
  batchCosts?: number[];
  /** File paths that were skipped (for "Skipped" section). */
  skippedFilePaths?: string[];
  /** Human-readable message for skipped section (e.g. batch limit or size). */
  skippedMessage?: string;
}

/** Common keys that might hold an array of findings in a JSON report. */
const FINDINGS_KEYS = ['findings', 'issues', 'results', 'items'];

function tryParseJson(filePath: string): unknown {
  const content = fs.readFileSync(filePath, 'utf-8');
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function mergeJsonReports(batchPaths: string[], outputPath: string, meta: Record<string, unknown>): void {
  const merged: Record<string, unknown> = {};
  let mergedArray: unknown[] = [];
  let usedKey: string | null = null;
  let firstBatchUsed = false;

  for (let i = 0; i < batchPaths.length; i++) {
    const p = batchPaths[i];
    if (!fs.existsSync(p)) continue;
    const data = tryParseJson(p);
    if (data === null) continue;

    if (Array.isArray(data)) {
      mergedArray = mergedArray.concat(data);
      continue;
    }

    if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      if (!firstBatchUsed) {
        Object.assign(merged, obj);
        firstBatchUsed = true;
      }
      for (const key of FINDINGS_KEYS) {
        if (Array.isArray(obj[key])) {
          usedKey = usedKey || key;
          mergedArray = mergedArray.concat(obj[key] as unknown[]);
          break;
        }
      }
      if (!usedKey) {
        mergedArray.push(data);
      }
    }
  }

  if (usedKey) {
    merged[usedKey] = mergedArray;
  } else if (mergedArray.length > 0) {
    merged.findings = mergedArray;
  }

  if (Object.keys(meta).length > 0) {
    merged.meta = meta;
  }

  fs.ensureDirSync(path.dirname(outputPath) || '.');
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf-8');
}

function mergeMarkdownReports(
  batchPaths: string[],
  outputPath: string,
  options: {
    skippedFilePaths?: string[];
    skippedMessage?: string;
    totalCostUsd?: number;
  }
): void {
  const sections: string[] = [];

  for (let i = 0; i < batchPaths.length; i++) {
    const p = batchPaths[i];
    if (!fs.existsSync(p)) continue;
    const content = fs.readFileSync(p, 'utf-8').trim();
    if (!content) continue;
    sections.push(`## Batch ${i + 1}\n\n${content}`);
  }

  if (options.skippedFilePaths && options.skippedFilePaths.length > 0 && options.skippedMessage) {
    sections.push('## Skipped\n\n' + options.skippedMessage);
    sections.push('\nSkipped files:\n' + options.skippedFilePaths.map(f => `- ${f}`).join('\n'));
  } else if (options.skippedMessage) {
    sections.push('## Skipped\n\n' + options.skippedMessage);
  }

  if (options.totalCostUsd !== undefined && options.totalCostUsd > 0) {
    sections.push(`\n---\nTotal API cost for this run: $${options.totalCostUsd.toFixed(4)}`);
  }

  const merged = sections.join('\n\n---\n\n');
  fs.ensureDirSync(path.dirname(outputPath) || '.');
  fs.writeFileSync(outputPath, merged, 'utf-8');
}

/**
 * Merge batch report files into a single output file.
 * Format-specific: JSON (merge findings arrays + meta), Markdown (concat with batch headers + Skipped + cost).
 */
export function mergeBatchReports(options: MergeOptions): void {
  const { batchPaths, outputPath, format, totalCostUsd, batchCosts, skippedFilePaths, skippedMessage } = options;

  const meta: Record<string, unknown> = {};
  if (totalCostUsd !== undefined) meta.total_cost_usd = totalCostUsd;
  if (batchCosts && batchCosts.length > 0) meta.batch_costs = batchCosts;

  const normFormat = (format || 'markdown').toLowerCase();

  if (normFormat === 'json') {
    mergeJsonReports(batchPaths, outputPath, meta);
    return;
  }

  if (normFormat === 'markdown') {
    mergeMarkdownReports(batchPaths, outputPath, {
      skippedFilePaths,
      skippedMessage,
      totalCostUsd
    });
    return;
  }

  // Other formats: concatenate raw content with batch headers
  const sections: string[] = [];
  for (let i = 0; i < batchPaths.length; i++) {
    const p = batchPaths[i];
    if (!fs.existsSync(p)) continue;
    sections.push(`## Batch ${i + 1}\n\n` + fs.readFileSync(p, 'utf-8'));
  }
  if (sections.length > 0) {
    fs.ensureDirSync(path.dirname(outputPath) || '.');
    fs.writeFileSync(outputPath, sections.join('\n\n'), 'utf-8');
  }
}
