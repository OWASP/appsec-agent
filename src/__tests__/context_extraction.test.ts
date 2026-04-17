/**
 * Tests for ExtractionContext schema and loadExtractionContext loader.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  loadExtractionContext,
  CONTEXT_EXTRACTION_SCHEMA,
  type ExtractionContext
} from '../schemas/context_extraction';

describe('context_extraction', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ctx-extract-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const writeContext = (filename: string, ctx: unknown): string => {
    const p = path.join(tmpDir, filename);
    fs.writeFileSync(p, JSON.stringify(ctx), 'utf-8');
    return p;
  };

  describe('loadExtractionContext', () => {
    const validCtx: ExtractionContext = {
      owner: 'acme',
      repo: 'widgets',
      description: 'Widget service',
      language: 'TypeScript',
      languages: { TypeScript: 100 },
      files: [{ path: 'package.json', content: '{}' }]
    };

    it('loads context from an absolute path', () => {
      const filePath = writeContext('ctx.json', validCtx);
      const result = loadExtractionContext(filePath, '/some/other/cwd');
      expect(result.owner).toBe('acme');
      expect(result.repo).toBe('widgets');
      expect(result.files).toHaveLength(1);
    });

    it('loads context from a relative path resolved against cwd', () => {
      writeContext('ctx.json', validCtx);
      const result = loadExtractionContext('ctx.json', tmpDir);
      expect(result.owner).toBe('acme');
    });

    it('preserves optional tree_summary field when present', () => {
      const ctxWithTree = { ...validCtx, tree_summary: 'src/\n  index.ts' };
      const filePath = writeContext('ctx.json', ctxWithTree);
      const result = loadExtractionContext(filePath, tmpDir);
      expect(result.tree_summary).toBe('src/\n  index.ts');
    });

    it('throws when the context file does not exist', () => {
      const missing = path.join(tmpDir, 'does-not-exist.json');
      expect(() => loadExtractionContext(missing, tmpDir)).toThrow(
        /Extraction context file not found/
      );
    });

    it('throws when owner is missing', () => {
      const filePath = writeContext('ctx.json', { ...validCtx, owner: '' });
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow(
        /must include a valid owner/
      );
    });

    it('throws when owner is not a string', () => {
      const filePath = writeContext('ctx.json', { ...validCtx, owner: 123 });
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow(
        /must include a valid owner/
      );
    });

    it('throws when repo is missing', () => {
      const filePath = writeContext('ctx.json', { ...validCtx, repo: '' });
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow(
        /must include a valid repo/
      );
    });

    it('throws when repo is not a string', () => {
      const filePath = writeContext('ctx.json', { ...validCtx, repo: { name: 'x' } });
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow(
        /must include a valid repo/
      );
    });

    it('throws when files is not an array', () => {
      const filePath = writeContext('ctx.json', { ...validCtx, files: 'not-an-array' });
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow(
        /must include a files array/
      );
    });

    it('throws when JSON is malformed', () => {
      const filePath = path.join(tmpDir, 'bad.json');
      fs.writeFileSync(filePath, '{not valid json', 'utf-8');
      expect(() => loadExtractionContext(filePath, tmpDir)).toThrow();
    });
  });

  describe('CONTEXT_EXTRACTION_SCHEMA', () => {
    it('declares all required output fields', () => {
      expect(CONTEXT_EXTRACTION_SCHEMA.required).toEqual([
        'project_summary',
        'security_context',
        'deployment_context',
        'developer_context',
        'suggested_exclusions'
      ]);
    });

    it('disallows additional properties', () => {
      expect(CONTEXT_EXTRACTION_SCHEMA.additionalProperties).toBe(false);
    });
  });
});
