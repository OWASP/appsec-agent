import {
  parseImportGraphContext,
  formatImportGraphContextForPrompt,
  type ImportGraphContext,
} from '../../schemas/import_graph';

describe('import_graph schema (v5.4.0 / plan §3.1 Stage B)', () => {
  describe('parseImportGraphContext', () => {
    it('parses a minimal valid payload', () => {
      const ctx = parseImportGraphContext({
        files: [{ file: 'src/foo.ts', inbound_prod_import_count: 0 }],
      });
      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0].file).toBe('src/foo.ts');
      expect(ctx.files[0].inbound_prod_import_count).toBe(0);
    });

    it('parses callers, entry-point flag, graph_status', () => {
      const ctx = parseImportGraphContext({
        files: [
          {
            file: 'src/a.ts',
            inbound_prod_import_count: 2,
            callers: ['src/index.ts', 'src/server.ts'],
            is_entry_point: false,
            graph_status: 'ok',
          },
        ],
      });
      expect(ctx.files[0].callers).toEqual(['src/index.ts', 'src/server.ts']);
      expect(ctx.files[0].is_entry_point).toBe(false);
      expect(ctx.files[0].graph_status).toBe('ok');
    });

    it('clamps callers to MAX_CALLERS_PER_FILE (20) and strips non-strings', () => {
      const many = Array.from({ length: 30 }, (_, i) => `c${i}.ts`);
      const ctx = parseImportGraphContext({
        files: [
          {
            file: 'src/a.ts',
            inbound_prod_import_count: 30,
            callers: [...many, 42, null, undefined],
          },
        ],
      });
      expect(ctx.files[0].callers).toHaveLength(20);
      expect(ctx.files[0].callers?.[0]).toBe('c0.ts');
    });

    it('floors fractional import counts and rejects negative as 0', () => {
      const ctx = parseImportGraphContext({
        files: [
          { file: 'a.ts', inbound_prod_import_count: 3.7 },
          { file: 'b.ts', inbound_prod_import_count: -5 },
        ],
      });
      expect(ctx.files[0].inbound_prod_import_count).toBe(3);
      expect(ctx.files[1].inbound_prod_import_count).toBe(0);
    });

    it('drops unknown graph_status values', () => {
      const ctx = parseImportGraphContext({
        files: [{ file: 'a.ts', inbound_prod_import_count: 0, graph_status: 'corrupted' }],
      });
      expect(ctx.files[0].graph_status).toBeUndefined();
    });

    it('accepts metadata and default_branch_sha + coverage', () => {
      const ctx = parseImportGraphContext({
        default_branch_sha: 'abc123',
        parsed_at: '2026-04-24T20:00:00Z',
        coverage: 'partial',
        files: [{ file: 'a.ts', inbound_prod_import_count: 1 }],
        metadata: { project_name: 'sast-ai-app' },
      });
      expect(ctx.default_branch_sha).toBe('abc123');
      expect(ctx.parsed_at).toBe('2026-04-24T20:00:00Z');
      expect(ctx.coverage).toBe('partial');
      expect(ctx.metadata?.project_name).toBe('sast-ai-app');
    });

    it('rejects non-object input', () => {
      expect(() => parseImportGraphContext(null)).toThrow(/must be a JSON object/);
      expect(() => parseImportGraphContext('x')).toThrow(/must be a JSON object/);
    });

    it('rejects missing files array', () => {
      expect(() => parseImportGraphContext({})).toThrow(/must include a "files" array/);
    });

    it('rejects files.length > 500', () => {
      const big = Array.from({ length: 501 }, (_, i) => ({
        file: `f${i}.ts`,
        inbound_prod_import_count: 0,
      }));
      expect(() => parseImportGraphContext({ files: big })).toThrow(/at most 500 files/);
    });

    it('rejects entries without a file string', () => {
      expect(() =>
        parseImportGraphContext({ files: [{ inbound_prod_import_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
      expect(() =>
        parseImportGraphContext({ files: [{ file: '', inbound_prod_import_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
    });

    it('rejects entries without numeric inbound_prod_import_count', () => {
      expect(() =>
        parseImportGraphContext({ files: [{ file: 'a.ts', inbound_prod_import_count: 'x' }] }),
      ).toThrow(/numeric "inbound_prod_import_count"/);
      expect(() =>
        parseImportGraphContext({ files: [{ file: 'a.ts', inbound_prod_import_count: NaN }] }),
      ).toThrow(/numeric "inbound_prod_import_count"/);
    });
  });

  describe('formatImportGraphContextForPrompt', () => {
    it('returns empty string when files list is empty', () => {
      const out = formatImportGraphContextForPrompt({ files: [] });
      expect(out).toBe('');
    });

    it('renders a compact markdown table with the key columns', () => {
      const ctx: ImportGraphContext = {
        default_branch_sha: 'deadbeefcafe1234567890',
        files: [
          {
            file: 'src/index.ts',
            inbound_prod_import_count: 5,
            callers: ['x.ts', 'y.ts', 'z.ts', 'w.ts'],
            is_entry_point: true,
            graph_status: 'ok',
          },
          {
            file: 'src/helper.ts',
            inbound_prod_import_count: 0,
            is_entry_point: false,
            graph_status: 'ok',
          },
        ],
      };
      const out = formatImportGraphContextForPrompt(ctx);
      expect(out).toContain('### File reachability summary (import-graph, Stage B)');
      expect(out).toContain('`src/index.ts`');
      expect(out).toContain('`src/helper.ts`');
      expect(out).toContain('deadbeefcafe'); // truncated sha
      // Only top 3 callers surface to keep the prompt compact
      expect(out).toContain('`x.ts`, `y.ts`, `z.ts`');
      expect(out).not.toContain('`w.ts`');
      // Unreachable-helper row should have 0 callers rendered as em-dash
      expect(out).toContain('`src/helper.ts` | 0 | no | ok | —');
    });

    it('surfaces non-full coverage so the agent knows fail-open applies', () => {
      const out = formatImportGraphContextForPrompt({
        coverage: 'partial',
        files: [{ file: 'a.ts', inbound_prod_import_count: 0, graph_status: 'missing' }],
      });
      expect(out).toContain('Coverage: **partial**');
      expect(out).toContain('will **not** be downranked (fail-open)');
    });

    it('omits coverage note when coverage=full', () => {
      const out = formatImportGraphContextForPrompt({
        coverage: 'full',
        files: [{ file: 'a.ts', inbound_prod_import_count: 1 }],
      });
      expect(out).not.toContain('Coverage:');
    });
  });
});
