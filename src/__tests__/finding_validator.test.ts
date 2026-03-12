/**
 * Tests for finding validator context loading and schema
 */

import { loadRetestContext, RETEST_VERDICT_SCHEMA } from '../schemas/finding_validator';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';

describe('finding_validator', () => {
  let testDir: string;

  const validContext = {
    finding: {
      title: 'SQL Injection',
      category: 'Injection',
      severity: 'HIGH',
      cwe: 'CWE-89',
      file: 'src/db.ts',
      line_numbers: '42-44',
      description: 'User input concatenated into SQL query',
    },
    code_snippet: '  42| const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);\n  43| return result;\n  44| }',
  };

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `finding-validator-test-${Date.now()}`);
    fs.ensureDirSync(testDir);
  });

  afterEach(() => {
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  describe('loadRetestContext', () => {
    it('should load valid retest context from file', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadRetestContext(filePath, testDir);

      expect(ctx.finding.title).toBe('SQL Injection');
      expect(ctx.finding.category).toBe('Injection');
      expect(ctx.finding.severity).toBe('HIGH');
      expect(ctx.finding.cwe).toBe('CWE-89');
      expect(ctx.finding.file).toBe('src/db.ts');
      expect(ctx.finding.line_numbers).toBe('42-44');
      expect(ctx.code_snippet).toContain('SELECT * FROM users');
    });

    it('should resolve relative paths against cwd', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadRetestContext('retest.json', testDir);

      expect(ctx.finding.title).toBe('SQL Injection');
    });

    it('should resolve absolute paths directly', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify(validContext));

      const ctx = loadRetestContext(filePath, '/some/other/dir');

      expect(ctx.finding.title).toBe('SQL Injection');
    });

    it('should throw when file does not exist', () => {
      expect(() => loadRetestContext('nonexistent.json', testDir))
        .toThrow('Retest context file not found');
    });

    it('should throw when finding is missing', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ code_snippet: 'some code' }));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid finding object');
    });

    it('should throw when finding is not an object', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: 'not an object', code_snippet: 'code' }));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid finding object');
    });

    it('should throw when finding.title is missing', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, title: '' } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid title');
    });

    it('should throw when finding.title is not a string', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, title: 123 } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid title');
    });

    it('should throw when finding.file is missing', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, file: '' } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid file path');
    });

    it('should throw when finding.file is not a string', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, file: null } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid file path');
    });

    it('should throw when code_snippet is missing', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: validContext.finding }));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid code_snippet');
    });

    it('should throw when code_snippet is not a string', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: validContext.finding, code_snippet: 42 }));

      expect(() => loadRetestContext(filePath, testDir))
        .toThrow('valid code_snippet');
    });

    it('should throw on invalid JSON', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, 'not json');

      expect(() => loadRetestContext(filePath, testDir)).toThrow();
    });

    it('should accept null cwe and line_numbers', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = {
        ...validContext,
        finding: { ...validContext.finding, cwe: null, line_numbers: null },
      };
      fs.writeFileSync(filePath, JSON.stringify(ctx));

      const loaded = loadRetestContext(filePath, testDir);

      expect(loaded.finding.cwe).toBeNull();
      expect(loaded.finding.line_numbers).toBeNull();
    });
  });

  describe('RETEST_VERDICT_SCHEMA', () => {
    it('should have correct schema structure', () => {
      expect(RETEST_VERDICT_SCHEMA.name).toBe('retest_verdict');
      expect(RETEST_VERDICT_SCHEMA.strict).toBe(true);
      expect(RETEST_VERDICT_SCHEMA.schema.type).toBe('object');
      expect(RETEST_VERDICT_SCHEMA.schema.required).toEqual([
        'still_present', 'confidence', 'reasoning', 'current_line'
      ]);
      expect(RETEST_VERDICT_SCHEMA.schema.additionalProperties).toBe(false);
    });

    it('should define all expected properties', () => {
      const props = RETEST_VERDICT_SCHEMA.schema.properties;
      expect(props.still_present.type).toBe('boolean');
      expect(props.confidence.type).toBe('string');
      expect(props.confidence.enum).toEqual(['high', 'medium', 'low']);
      expect(props.reasoning.type).toBe('string');
      expect(props.current_line.type).toEqual(['number', 'null']);
    });
  });
});
