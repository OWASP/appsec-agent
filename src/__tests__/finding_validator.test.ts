/**
 * Tests for finding validator context loading and schema
 */

import {
  loadRetestContext,
  RETEST_VERDICT_SCHEMA,
  RETEST_CONTEXT_INVALID_SIGNAL,
  RetestContextValidationError,
} from '../schemas/finding_validator';
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

  // Pins the structured stderr signal + typed error contract that parent
  // apps (e.g., parent-app's findingRetestService) grep for to tell
  // "caller-input invalid" apart from "agent crashed unexpectedly".
  // Production crash 2026-05-12 ~21:17Z surfaced as 500 chars of generic
  // Node stack trace ending in `Module._compile / executeUserEntryPoint`
  // because the throwing-frame line lived OUTSIDE the parent's stderr
  // capture window. The signal prefix is engineered so even a 200-char
  // capture window catches it.
  describe('loadRetestContext — structured invalid-input signal', () => {
    let stderrSpy: jest.SpyInstance;

    beforeEach(() => {
      stderrSpy = jest.spyOn(console, 'error').mockImplementation(() => {
        // Suppress noisy output during these negative-path tests; the
        // assertions inspect the mocked calls explicitly.
      });
    });

    afterEach(() => {
      stderrSpy.mockRestore();
    });

    it('throws RetestContextValidationError (not generic Error) on invalid input', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: validContext.finding, code_snippet: '' }));

      let caught: unknown;
      try {
        loadRetestContext(filePath, testDir);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(RetestContextValidationError);
      if (caught instanceof RetestContextValidationError) {
        expect(caught.kind).toBe('missing_code_snippet');
        expect(caught.name).toBe('RetestContextValidationError');
      }
    });

    it('emits the structured stderr signal BEFORE throwing (production-crash repro)', () => {
      // This is the exact failure mode that crashed prod on 2026-05-12:
      // an empty code_snippet, which the parent's findingRetestService
      // could not interpret because the human-readable error message
      // was outside the 500-char stderr capture window. The structured
      // signal makes the failure mode greppable regardless of window
      // size.
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: validContext.finding, code_snippet: '' }));

      expect(() => loadRetestContext(filePath, testDir)).toThrow(
        RetestContextValidationError,
      );

      expect(stderrSpy).toHaveBeenCalled();
      const firstCallArg = stderrSpy.mock.calls[0][0] as string;
      expect(firstCallArg).toContain(RETEST_CONTEXT_INVALID_SIGNAL);
      expect(firstCallArg).toContain('missing_code_snippet');
    });

    function captureValidationKind(thunk: () => unknown): string {
      let caught: unknown;
      try {
        thunk();
      } catch (e) {
        caught = e;
      }
      if (!(caught instanceof RetestContextValidationError)) {
        throw new Error(
          `Expected RetestContextValidationError, got: ${caught instanceof Error ? caught.message : String(caught)}`,
        );
      }
      return caught.kind;
    }

    it('tags file-not-found with kind="file_not_found"', () => {
      const kind = captureValidationKind(() => loadRetestContext('nonexistent-file.json', testDir));
      expect(kind).toBe('file_not_found');
      const firstCallArg = stderrSpy.mock.calls[0][0] as string;
      expect(firstCallArg).toContain('file_not_found');
    });

    it('tags malformed JSON with kind="json_parse_error"', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, 'not-valid-json{');

      const kind = captureValidationKind(() => loadRetestContext(filePath, testDir));
      expect(kind).toBe('json_parse_error');
      const firstCallArg = stderrSpy.mock.calls[0][0] as string;
      expect(firstCallArg).toContain('json_parse_error');
    });

    it('tags missing finding with kind="missing_finding"', () => {
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ code_snippet: 'some code' }));
      expect(captureValidationKind(() => loadRetestContext(filePath, testDir))).toBe(
        'missing_finding',
      );
    });

    it('tags missing title with kind="missing_finding_title"', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, title: '' } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));
      expect(captureValidationKind(() => loadRetestContext(filePath, testDir))).toBe(
        'missing_finding_title',
      );
    });

    it('tags missing file with kind="missing_finding_file"', () => {
      const filePath = path.join(testDir, 'retest.json');
      const ctx = { ...validContext, finding: { ...validContext.finding, file: '' } };
      fs.writeFileSync(filePath, JSON.stringify(ctx));
      expect(captureValidationKind(() => loadRetestContext(filePath, testDir))).toBe(
        'missing_finding_file',
      );
    });

    it('emits a single-line signal that fits in a 200-char capture window', () => {
      // Smoke check against the parent-side constraint: the signal line
      // must be short enough that a small stderr capture window still
      // shows the full prefix + kind. The longest kind is
      // 'missing_finding_title' (21 chars). Prefix + kind + minimum
      // message text comfortably fits in ~120 chars; this assertion
      // pins that we don't regress with a verbose new kind name.
      const filePath = path.join(testDir, 'retest.json');
      fs.writeFileSync(filePath, JSON.stringify({ finding: validContext.finding, code_snippet: '' }));

      expect(() => loadRetestContext(filePath, testDir)).toThrow();

      const firstCallArg = stderrSpy.mock.calls[0][0] as string;
      // Each call is a single line; no embedded newlines until callers
      // join them. Length budget = 200 chars (matches the previously
      // diagnosed parent-side truncation point).
      expect(firstCallArg.split('\n')).toHaveLength(1);
      expect(firstCallArg.length).toBeLessThanOrEqual(200);
    });
  });

  describe('RETEST_VERDICT_SCHEMA', () => {
    it('should have correct schema structure', () => {
      expect(RETEST_VERDICT_SCHEMA.type).toBe('object');
      expect(RETEST_VERDICT_SCHEMA.required).toEqual([
        'still_present', 'confidence', 'reasoning', 'current_line'
      ]);
      expect(RETEST_VERDICT_SCHEMA.additionalProperties).toBe(false);
    });

    it('should define all expected properties', () => {
      const props = RETEST_VERDICT_SCHEMA.properties as Record<string, any>;
      expect(props.still_present.type).toBe('boolean');
      expect(props.confidence.type).toBe('string');
      expect(props.confidence.enum).toEqual(['high', 'medium', 'low']);
      expect(props.reasoning.type).toBe('string');
      expect(props.current_line.type).toEqual(['number', 'null']);
    });
  });
});
