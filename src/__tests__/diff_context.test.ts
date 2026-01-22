/**
 * Tests for diff_context module
 */

import { 
  validateDiffContext, 
  formatDiffContextForPrompt,
  DiffContext,
  DiffContextFile,
  DiffHunk
} from '../diff_context';

describe('diff_context', () => {
  // Helper to create a valid minimal diff context
  const createValidDiffContext = (overrides: Partial<DiffContext> = {}): DiffContext => ({
    prNumber: 123,
    baseBranch: 'main',
    headBranch: 'feature/test',
    headSha: 'abc123def456',
    owner: 'test-owner',
    repo: 'test-repo',
    files: [],
    totalFilesChanged: 0,
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    ...overrides
  });

  // Helper to create a valid file
  const createValidFile = (overrides: Partial<DiffContextFile> = {}): DiffContextFile => ({
    filePath: 'src/test.ts',
    language: 'typescript',
    fileType: 'modified',
    hunks: [],
    ...overrides
  });

  // Helper to create a valid hunk
  const createValidHunk = (overrides: Partial<DiffHunk> = {}): DiffHunk => {
    const base: DiffHunk = {
      startLine: 10,
      endLine: 20,
      beforeContext: '',
      changedCode: '+const x = 1;',
      afterContext: ''
    };
    return { ...base, ...overrides };
  };

  describe('validateDiffContext', () => {
    describe('basic validation', () => {
      it('should return true for valid minimal diff context', () => {
        const ctx = createValidDiffContext();
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for null', () => {
        expect(validateDiffContext(null)).toBe(false);
      });

      it('should return false for undefined', () => {
        expect(validateDiffContext(undefined)).toBe(false);
      });

      it('should return false for non-object', () => {
        expect(validateDiffContext('string')).toBe(false);
        expect(validateDiffContext(123)).toBe(false);
        expect(validateDiffContext([])).toBe(false);
      });
    });

    describe('required field validation', () => {
      it('should return false for missing prNumber', () => {
        const ctx = createValidDiffContext();
        delete (ctx as any).prNumber;
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for negative prNumber', () => {
        const ctx = createValidDiffContext({ prNumber: -1 });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for non-number prNumber', () => {
        const ctx = createValidDiffContext();
        (ctx as any).prNumber = '123';
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for empty baseBranch', () => {
        const ctx = createValidDiffContext({ baseBranch: '' });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for empty headBranch', () => {
        const ctx = createValidDiffContext({ headBranch: '' });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for empty headSha', () => {
        const ctx = createValidDiffContext({ headSha: '' });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for empty owner', () => {
        const ctx = createValidDiffContext({ owner: '' });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for empty repo', () => {
        const ctx = createValidDiffContext({ repo: '' });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for non-array files', () => {
        const ctx = createValidDiffContext();
        (ctx as any).files = 'not an array';
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for negative totalFilesChanged', () => {
        const ctx = createValidDiffContext({ totalFilesChanged: -1 });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for negative totalLinesAdded', () => {
        const ctx = createValidDiffContext({ totalLinesAdded: -1 });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for negative totalLinesRemoved', () => {
        const ctx = createValidDiffContext({ totalLinesRemoved: -1 });
        expect(validateDiffContext(ctx)).toBe(false);
      });
    });

    describe('optional field validation', () => {
      it('should accept valid deploymentContext string', () => {
        const ctx = createValidDiffContext({ deploymentContext: 'Production AWS deployment' });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-string deploymentContext', () => {
        const ctx = createValidDiffContext();
        (ctx as any).deploymentContext = 123;
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept undefined deploymentContext', () => {
        const ctx = createValidDiffContext();
        expect(validateDiffContext(ctx)).toBe(true);
      });
    });

    describe('file validation', () => {
      it('should validate files with valid structure', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile()],
          totalFilesChanged: 1
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for file with empty filePath', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ filePath: '' })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for file with empty language', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ language: '' })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for invalid fileType', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ fileType: 'invalid' as any })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept all valid fileTypes', () => {
        const validTypes: Array<'added' | 'modified' | 'renamed' | 'deleted'> = 
          ['added', 'modified', 'renamed', 'deleted'];
        
        for (const fileType of validTypes) {
          const ctx = createValidDiffContext({
            files: [createValidFile({ fileType })]
          });
          expect(validateDiffContext(ctx)).toBe(true);
        }
      });

      it('should return false for non-string imports', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ imports: 123 as any })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept valid imports string', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ imports: "import fs from 'fs';" })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-string previousFilename', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ previousFilename: 123 as any })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept valid previousFilename', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ fileType: 'renamed', previousFilename: 'old-name.ts' })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-boolean fullFileAvailable', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ fullFileAvailable: 'true' as any })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept valid fullFileAvailable boolean', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({ fullFileAvailable: true })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });
    });

    describe('hunk validation', () => {
      it('should validate hunks with valid structure', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk()]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for negative startLine', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ startLine: -1 })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for negative endLine', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ endLine: -1 })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false when startLine > endLine', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ startLine: 20, endLine: 10 })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept startLine equal to endLine', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ startLine: 10, endLine: 10 })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-string changedCode', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ changedCode: 123 as any })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept empty changedCode (for deletions)', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ changedCode: '' })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-string beforeContext', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ beforeContext: 123 as any })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept valid beforeContext', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ beforeContext: 'const y = 2;' })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });

      it('should return false for non-string afterContext', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ afterContext: 123 as any })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should return false for non-string containingFunction', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ containingFunction: 123 as any })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(false);
      });

      it('should accept valid containingFunction', () => {
        const ctx = createValidDiffContext({
          files: [createValidFile({
            hunks: [createValidHunk({ containingFunction: 'function myFunc()' })]
          })]
        });
        expect(validateDiffContext(ctx)).toBe(true);
      });
    });
  });

  describe('formatDiffContextForPrompt', () => {
    it('should format basic diff context correctly', () => {
      const ctx = createValidDiffContext({
        prNumber: 42,
        baseBranch: 'main',
        headBranch: 'feature/auth',
        headSha: 'abc123def456789',
        owner: 'myorg',
        repo: 'myrepo',
        totalFilesChanged: 2,
        totalLinesAdded: 50,
        totalLinesRemoved: 10
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('# Pull Request Security Review');
      expect(result).toContain('**PR #42**');
      expect(result).toContain('feature/auth → main');
      expect(result).toContain('**Repository**: myorg/myrepo');
      expect(result).toContain('**Commit**: abc123de'); // truncated to 8 chars
      expect(result).toContain('**Changes**: 2 files (+50/-10)');
    });

    it('should include deployment context when provided', () => {
      const ctx = createValidDiffContext({
        deploymentContext: 'Production AWS environment with strict compliance requirements'
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('## Deployment Context');
      expect(result).toContain('Production AWS environment with strict compliance requirements');
    });

    it('should format file changes correctly', () => {
      const ctx = createValidDiffContext({
        files: [createValidFile({
          filePath: 'src/auth/login.ts',
          language: 'typescript',
          fileType: 'modified'
        })]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('### src/auth/login.ts (modified)');
      expect(result).toContain('**Language**: typescript');
    });

    it('should include previous filename for renamed files', () => {
      const ctx = createValidDiffContext({
        files: [createValidFile({
          filePath: 'src/new-name.ts',
          fileType: 'renamed',
          previousFilename: 'src/old-name.ts'
        })]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('**Renamed from**: src/old-name.ts');
    });

    it('should include imports when provided', () => {
      const ctx = createValidDiffContext({
        files: [createValidFile({
          imports: "import fs from 'fs';\nimport path from 'path';"
        })]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('**Imports**:');
      expect(result).toContain("import fs from 'fs';");
    });

    it('should format hunks correctly', () => {
      const ctx = createValidDiffContext({
        files: [createValidFile({
          hunks: [createValidHunk({
            startLine: 10,
            endLine: 15,
            changedCode: '+const password = req.body.password;',
            containingFunction: 'async function login(req, res)'
          })]
        })]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('#### Change 1 (lines 10-15)');
      expect(result).toContain('**In**: `async function login(req, res)`');
      expect(result).toContain('**Changed code**:');
      expect(result).toContain('+const password = req.body.password;');
    });

    it('should include before and after context when provided', () => {
      const ctx = createValidDiffContext({
        files: [createValidFile({
          hunks: [createValidHunk({
            beforeContext: '// Previous code here',
            afterContext: '// Following code here'
          })]
        })]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('**Before context**:');
      expect(result).toContain('// Previous code here');
      expect(result).toContain('**After context**:');
      expect(result).toContain('// Following code here');
    });

    it('should handle multiple files and hunks', () => {
      const ctx = createValidDiffContext({
        files: [
          createValidFile({
            filePath: 'file1.ts',
            hunks: [
              createValidHunk({ startLine: 1, endLine: 5 }),
              createValidHunk({ startLine: 10, endLine: 15 })
            ]
          }),
          createValidFile({
            filePath: 'file2.ts',
            hunks: [createValidHunk({ startLine: 20, endLine: 25 })]
          })
        ]
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('### file1.ts');
      expect(result).toContain('### file2.ts');
      expect(result).toContain('#### Change 1 (lines 1-5)');
      expect(result).toContain('#### Change 2 (lines 10-15)');
      expect(result).toContain('#### Change 1 (lines 20-25)');
    });

    it('should handle short headSha gracefully', () => {
      const ctx = createValidDiffContext({
        headSha: 'abc'  // less than 8 characters
      });

      const result = formatDiffContextForPrompt(ctx);

      expect(result).toContain('**Commit**: abc');
    });
  });
});
