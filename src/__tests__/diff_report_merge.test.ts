/**
 * Tests for diff_report_merge module
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { mergeBatchReports } from '../diff_report_merge';

describe('diff_report_merge', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `merge-test-${Date.now()}`);
    await fs.ensureDir(tempDir);
  });

  afterEach(async () => {
    if (tempDir && await fs.pathExists(tempDir)) {
      await fs.remove(tempDir);
    }
  });

  it('should merge JSON batch reports with findings array', async () => {
    const batch1 = path.join(tempDir, 'batch1.json');
    const batch2 = path.join(tempDir, 'batch2.json');
    const out = path.join(tempDir, 'merged.json');
    await fs.writeFile(batch1, JSON.stringify({ findings: [{ id: 1, file: 'a.ts' }] }, null, 2));
    await fs.writeFile(batch2, JSON.stringify({ findings: [{ id: 2, file: 'b.ts' }] }, null, 2));

    mergeBatchReports({
      batchPaths: [batch1, batch2],
      outputPath: out,
      format: 'json',
      totalCostUsd: 0.05,
      batchCosts: [0.02, 0.03]
    });

    const merged = JSON.parse(await fs.readFile(out, 'utf-8'));
    expect(merged.findings).toHaveLength(2);
    expect(merged.findings[0].file).toBe('a.ts');
    expect(merged.findings[1].file).toBe('b.ts');
    expect(merged.meta).toEqual({ total_cost_usd: 0.05, batch_costs: [0.02, 0.03] });
  });

  it('should merge Markdown batch reports with Skipped section and cost', async () => {
    const batch1 = path.join(tempDir, 'batch1.md');
    const batch2 = path.join(tempDir, 'batch2.md');
    const out = path.join(tempDir, 'merged.md');
    await fs.writeFile(batch1, '## Issue 1\nFinding in file A.');
    await fs.writeFile(batch2, '## Issue 2\nFinding in file B.');

    mergeBatchReports({
      batchPaths: [batch1, batch2],
      outputPath: out,
      format: 'markdown',
      totalCostUsd: 0.1,
      skippedFilePaths: ['src/skipped.ts'],
      skippedMessage: '1 file(s) excluded by config.'
    });

    const content = await fs.readFile(out, 'utf-8');
    expect(content).toContain('## Batch 1');
    expect(content).toContain('## Batch 2');
    expect(content).toContain('## Skipped');
    expect(content).toContain('1 file(s) excluded');
    expect(content).toContain('src/skipped.ts');
    expect(content).toContain('Total API cost');
    expect(content).toContain('0.1000');
  });

  it('should write merged JSON when batch reports use issues key', async () => {
    const batch1 = path.join(tempDir, 'b1.json');
    const out = path.join(tempDir, 'out.json');
    await fs.writeFile(batch1, JSON.stringify({ issues: [{ severity: 'high' }], summary: 'Batch 1' }));

    mergeBatchReports({
      batchPaths: [batch1],
      outputPath: out,
      format: 'json'
    });

    const merged = JSON.parse(await fs.readFile(out, 'utf-8'));
    expect(merged.issues).toHaveLength(1);
    expect(merged.summary).toBe('Batch 1');
  });
});
