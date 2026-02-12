/**
 * Tests for diff_chunking module
 */

import { estimateTokens, splitIntoBatches, ChunkingOptions } from '../diff_chunking';
import type { DiffContext, DiffContextFile, DiffHunk } from '../diff_context';

function createContext(overrides: Partial<DiffContext> & { files: DiffContextFile[] }): DiffContext {
  const { files = [], totalFilesChanged: _tf, ...rest } = overrides;
  return {
    prNumber: 1,
    baseBranch: 'main',
    headBranch: 'feature',
    headSha: 'abc123',
    owner: 'o',
    repo: 'r',
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    files,
    totalFilesChanged: files.length,
    ...rest
  };
}

function createFile(path: string, hunks: DiffHunk[] = [{ startLine: 1, endLine: 2, beforeContext: '', changedCode: '+x', afterContext: '' }]): DiffContextFile {
  return {
    filePath: path,
    language: 'typescript',
    fileType: 'modified',
    hunks
  };
}

describe('diff_chunking', () => {
  describe('estimateTokens', () => {
    it('should estimate tokens from string length', () => {
      expect(estimateTokens('')).toBe(0);
      expect(estimateTokens('abcd')).toBe(1);
      expect(estimateTokens('a'.repeat(8))).toBe(2);
      expect(estimateTokens('hello world')).toBeGreaterThanOrEqual(2);
    });
  });

  describe('splitIntoBatches', () => {
    it('should return one batch when maxTokensPerBatch is 0', () => {
      const ctx = createContext({
        files: [createFile('a.ts'), createFile('b.ts')]
      });
      const result = splitIntoBatches(ctx, { maxTokensPerBatch: 0, maxBatches: 3 });
      expect(result.batches.length).toBe(1);
      expect(result.batches[0].files.length).toBe(2);
      expect(result.skippedFiles.length).toBe(0);
      expect(result.skippedDueToBatches).toBe(false);
    });

    it('should exclude files matching excludePaths', () => {
      const ctx = createContext({
        files: [
          createFile('src/auth/login.ts'),
          createFile('src/analytics/events.ts'),
          createFile('src/api/handlers.ts')
        ]
      });
      const result = splitIntoBatches(ctx, {
        maxTokensPerBatch: 0,
        maxBatches: 3,
        excludePaths: ['src/analytics/']
      });
      expect(result.batches.length).toBe(1);
      expect(result.batches[0].files.length).toBe(2);
      expect(result.batches[0].files.map(f => f.filePath)).toEqual(['src/auth/login.ts', 'src/api/handlers.ts']);
      expect(result.skippedFiles.length).toBe(1);
      expect(result.skippedFiles[0].filePath).toBe('src/analytics/events.ts');
    });

    it('should apply maxFiles and skip rest', () => {
      const ctx = createContext({
        files: [
          createFile('a.ts'),
          createFile('b.ts'),
          createFile('c.ts'),
          createFile('d.ts')
        ]
      });
      const result = splitIntoBatches(ctx, {
        maxTokensPerBatch: 0,
        maxBatches: 3,
        maxFiles: 2
      });
      expect(result.batches.length).toBe(1);
      expect(result.batches[0].files.length).toBe(2);
      expect(result.skippedFiles.length).toBe(2);
    });

    it('should respect maxBatches', () => {
      const files: DiffContextFile[] = [];
      for (let i = 0; i < 20; i++) {
        files.push(createFile(`f${i}.ts`, [{ startLine: 1, endLine: 1, beforeContext: '', changedCode: '+'.repeat(8000), afterContext: '' }]));
      }
      const ctx = createContext({ files });
      const result = splitIntoBatches(ctx, {
        maxTokensPerBatch: 5000,
        maxBatches: 2
      });
      expect(result.batches.length).toBe(2);
      expect(result.skippedDueToBatches).toBe(true);
    });

    it('should return empty batches when all files excluded', () => {
      const ctx = createContext({
        files: [createFile('src/analytics/a.ts')]
      });
      const result = splitIntoBatches(ctx, {
        maxTokensPerBatch: 0,
        maxBatches: 3,
        excludePaths: ['src/']
      });
      expect(result.batches.length).toBe(0);
      expect(result.skippedFiles.length).toBe(1);
    });
  });
});
