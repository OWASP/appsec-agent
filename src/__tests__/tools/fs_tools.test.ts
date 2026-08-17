/**
 * Tests for the local Read / Write / Grep tools, with emphasis on
 * working-directory confinement (the hand-rolled loop has no runtime sandbox).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createReadToolHandler } from '../../tools/read_tool';
import { createWriteToolHandler } from '../../tools/write_tool';
import { resolveInsideWorkDir } from '../../tools/workdir';

describe('resolveInsideWorkDir', () => {
  const root = path.resolve('/tmp/work');

  it('allows paths inside the working directory', () => {
    expect(resolveInsideWorkDir(root, 'src/index.ts')).toBe(path.join(root, 'src/index.ts'));
    expect(resolveInsideWorkDir(root, '.')).toBe(root);
  });

  it('rejects traversal outside the working directory', () => {
    expect(resolveInsideWorkDir(root, '../secrets.txt')).toBeNull();
    expect(resolveInsideWorkDir(root, '/etc/passwd')).toBeNull();
  });
});

describe('Read tool', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonshot-read-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('reads a file inside the working directory', async () => {
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'hello');
    const read = createReadToolHandler(workDir);
    expect(await read({ path: 'a.txt' })).toEqual({ content: 'hello' });
  });

  it('rejects reads that escape the working directory', async () => {
    const read = createReadToolHandler(workDir);
    const result = await read({ path: '../../etc/passwd' });
    expect(result.error).toMatch(/escapes the working directory/);
  });

  it('returns a directory listing when the path is a directory', async () => {
    fs.mkdirSync(path.join(workDir, 'sub'));
    fs.writeFileSync(path.join(workDir, 'a.txt'), 'x');
    const read = createReadToolHandler(workDir);
    const result = await read({ path: '.' });
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('a.txt');
    expect(result.content).toContain('sub/');
  });
});

describe('Write tool', () => {
  let workDir: string;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moonshot-write-'));
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  it('writes a file (creating parent dirs) inside the working directory', async () => {
    const write = createWriteToolHandler(workDir);
    const result = await write({ path: 'nested/out.txt', content: 'data' });
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(workDir, 'nested/out.txt'), 'utf-8')).toBe('data');
  });

  it('rejects writes that escape the working directory', async () => {
    const write = createWriteToolHandler(workDir);
    const result = await write({ path: '../evil.txt', content: 'x' });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/escapes the working directory/);
    expect(fs.existsSync(path.join(path.dirname(workDir), 'evil.txt'))).toBe(false);
  });
});
