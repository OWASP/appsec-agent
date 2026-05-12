import {
  parseCodebaseGraphContext,
  formatCodebaseGraphContextForPrompt,
  type CodebaseGraphContext,
} from '../../schemas/codebase_graph';

describe('codebase_graph schema (v2.6.0 / parent-app plan §8.18 Phase 2)', () => {
  describe('parseCodebaseGraphContext', () => {
    it('parses a minimal valid payload', () => {
      const ctx = parseCodebaseGraphContext({
        files: [{ file: 'src/foo.ts', blast_radius_files_count: 0 }],
      });
      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0].file).toBe('src/foo.ts');
      expect(ctx.files[0].blast_radius_files_count).toBe(0);
      expect(ctx.files[0].callers).toBeUndefined();
      expect(ctx.files[0].callees).toBeUndefined();
      expect(ctx.files[0].symbols_changed).toBeUndefined();
      expect(ctx.files[0].graph_status).toBeUndefined();
    });

    it('accepts callers / callees / symbols_changed lists', () => {
      const ctx = parseCodebaseGraphContext({
        files: [
          {
            file: 'backend/src/services/payments.ts',
            symbols_changed: ['PaymentsService.charge', 'PaymentsService.refund'],
            callers: ['routes/api/payments.handlePost', 'routes/webhooks/stripe.handler'],
            callees: ['db.transaction', 'audit.recordPayment'],
            blast_radius_files_count: 17,
            graph_status: 'ok',
          },
        ],
      });
      const f = ctx.files[0];
      expect(f.symbols_changed).toEqual(['PaymentsService.charge', 'PaymentsService.refund']);
      expect(f.callers).toEqual(['routes/api/payments.handlePost', 'routes/webhooks/stripe.handler']);
      expect(f.callees).toEqual(['db.transaction', 'audit.recordPayment']);
      expect(f.blast_radius_files_count).toBe(17);
      expect(f.graph_status).toBe('ok');
    });

    it('floors fractional blast_radius_files_count and clamps negatives to 0', () => {
      const ctx = parseCodebaseGraphContext({
        files: [
          { file: 'a.ts', blast_radius_files_count: 3.7 },
          { file: 'b.ts', blast_radius_files_count: -5 },
        ],
      });
      expect(ctx.files[0].blast_radius_files_count).toBe(3);
      expect(ctx.files[1].blast_radius_files_count).toBe(0);
    });

    it('truncates callers/callees/symbols_changed at 20 entries each', () => {
      const big = Array.from({ length: 30 }, (_, i) => `pkg.func${i}`);
      const ctx = parseCodebaseGraphContext({
        files: [
          {
            file: 'src/wide.ts',
            symbols_changed: big,
            callers: big,
            callees: big,
            blast_radius_files_count: 100,
          },
        ],
      });
      expect(ctx.files[0].symbols_changed).toHaveLength(20);
      expect(ctx.files[0].callers).toHaveLength(20);
      expect(ctx.files[0].callees).toHaveLength(20);
      // Truncation preserves the leading entries (parent app's ranking).
      expect(ctx.files[0].callers?.[0]).toBe('pkg.func0');
      expect(ctx.files[0].callers?.[19]).toBe('pkg.func19');
    });

    it('drops empty / non-string entries from caller and callee lists', () => {
      const ctx = parseCodebaseGraphContext({
        files: [
          {
            file: 'src/mixed.ts',
            callers: ['valid.fn', '', '   ', 42, null, 'another.valid.fn'],
            callees: ['', '   '],
            blast_radius_files_count: 1,
          },
        ],
      });
      expect(ctx.files[0].callers).toEqual(['valid.fn', 'another.valid.fn']);
      // All-empty list collapses to undefined so the formatter renders an em-dash.
      expect(ctx.files[0].callees).toBeUndefined();
    });

    it('drops invalid graph_status values to undefined', () => {
      const ctx = parseCodebaseGraphContext({
        files: [
          { file: 'a.ts', blast_radius_files_count: 1, graph_status: 'bogus' },
          { file: 'b.ts', blast_radius_files_count: 1, graph_status: 42 },
          { file: 'c.ts', blast_radius_files_count: 1, graph_status: 'no_symbols' },
        ],
      });
      expect(ctx.files[0].graph_status).toBeUndefined();
      expect(ctx.files[1].graph_status).toBeUndefined();
      expect(ctx.files[2].graph_status).toBe('no_symbols');
    });

    it('accepts all four valid coverage values; drops invalid ones to undefined', () => {
      for (const coverage of ['full', 'partial', 'none', 'empty'] as const) {
        const ctx = parseCodebaseGraphContext({
          coverage,
          files: [{ file: 'a.ts', blast_radius_files_count: 0 }],
        });
        expect(ctx.coverage).toBe(coverage);
      }
      const bad = parseCodebaseGraphContext({
        coverage: 'definitely-not-a-coverage-value',
        files: [{ file: 'a.ts', blast_radius_files_count: 0 }],
      });
      expect(bad.coverage).toBeUndefined();
    });

    it('silently drops unknown extra fields on each file entry (defensive PHI minimization)', () => {
      // Mirrors runtime_enrichment's PHI gate even though cbm cannot
      // produce PHI by construction (it sees only source-code text from
      // CapsuleHealth-owned repos). Defense in depth: if a future cbm
      // version starts emitting comment/doc-string text in its query
      // responses, the schema strips anything off-contract before the
      // LLM ever sees it.
      const ctx = parseCodebaseGraphContext({
        files: [
          {
            file: 'src/a.ts',
            blast_radius_files_count: 2,
            graph_status: 'ok',
            comment_text: 'patient_id=1234 leaked here',
            doc_string: 'PHI in a doc-string',
            arbitrary_extension: { ssn: '...' },
          },
        ],
      });
      const f = ctx.files[0] as unknown as Record<string, unknown>;
      expect(Object.keys(f).sort()).toEqual([
        'blast_radius_files_count',
        'callees',
        'callers',
        'file',
        'graph_status',
        'symbols_changed',
      ]);
      expect(f.comment_text).toBeUndefined();
      expect(f.doc_string).toBeUndefined();
      expect(f.arbitrary_extension).toBeUndefined();
    });

    it('accepts metadata + default_branch_sha + parsed_at', () => {
      const ctx = parseCodebaseGraphContext({
        default_branch_sha: 'abc123',
        parsed_at: '2026-05-12T20:00:00Z',
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
        metadata: { project_name: 'example-app' },
      });
      expect(ctx.default_branch_sha).toBe('abc123');
      expect(ctx.parsed_at).toBe('2026-05-12T20:00:00Z');
      expect(ctx.metadata?.project_name).toBe('example-app');
    });

    it('silently drops non-string project_name to undefined (defensive validator)', () => {
      const ctx = parseCodebaseGraphContext({
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
        metadata: { project_name: 42 },
      });
      // Metadata object is preserved but the bad field collapses to undefined,
      // mirroring how invalid `graph_status` / `coverage` values are dropped
      // rather than thrown. Forensic metadata should never be load-bearing.
      expect(ctx.metadata).toEqual({ project_name: undefined });
    });

    it('rejects non-object input', () => {
      expect(() => parseCodebaseGraphContext(null)).toThrow(/must be a JSON object/);
      expect(() => parseCodebaseGraphContext('x')).toThrow(/must be a JSON object/);
    });

    it('rejects missing files array', () => {
      expect(() => parseCodebaseGraphContext({})).toThrow(/must include a "files" array/);
    });

    it('rejects files.length > 500', () => {
      const big = Array.from({ length: 501 }, (_, i) => ({
        file: `f${i}.ts`,
        blast_radius_files_count: 0,
      }));
      expect(() => parseCodebaseGraphContext({ files: big })).toThrow(/at most 500 files/);
    });

    it('rejects entries without a file string', () => {
      expect(() =>
        parseCodebaseGraphContext({ files: [{ blast_radius_files_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
      expect(() =>
        parseCodebaseGraphContext({ files: [{ file: '', blast_radius_files_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
      expect(() =>
        parseCodebaseGraphContext({ files: [{ file: '   ', blast_radius_files_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
    });

    it('rejects entries without numeric blast_radius_files_count', () => {
      expect(() =>
        parseCodebaseGraphContext({ files: [{ file: 'a.ts', blast_radius_files_count: 'x' }] }),
      ).toThrow(/numeric "blast_radius_files_count"/);
      expect(() =>
        parseCodebaseGraphContext({ files: [{ file: 'a.ts', blast_radius_files_count: NaN }] }),
      ).toThrow(/numeric "blast_radius_files_count"/);
      expect(() =>
        parseCodebaseGraphContext({ files: [{ file: 'a.ts', blast_radius_files_count: Infinity }] }),
      ).toThrow(/numeric "blast_radius_files_count"/);
    });

    it('rejects non-object file entries', () => {
      expect(() =>
        parseCodebaseGraphContext({ files: ['src/a.ts'] }),
      ).toThrow(/must be an object/);
      expect(() =>
        parseCodebaseGraphContext({ files: [null] }),
      ).toThrow(/must be an object/);
    });
  });

  describe('formatCodebaseGraphContextForPrompt', () => {
    it('returns empty string when files list is empty', () => {
      const out = formatCodebaseGraphContextForPrompt({ files: [] });
      expect(out).toBe('');
    });

    it('renders a compact markdown table sorted by blast_radius_files_count desc', () => {
      const ctx: CodebaseGraphContext = {
        default_branch_sha: 'deadbeefcafe1234567890',
        files: [
          {
            file: 'src/quiet.ts',
            blast_radius_files_count: 1,
            callers: ['caller.fn'],
            callees: [],
          },
          {
            file: 'src/hot.ts',
            blast_radius_files_count: 47,
            callers: ['a.fn', 'b.fn', 'c.fn', 'd.fn', 'e.fn'],
            callees: ['x.fn', 'y.fn'],
            graph_status: 'ok',
          },
          {
            file: 'src/medium.ts',
            blast_radius_files_count: 12,
            callers: ['m.fn'],
            callees: ['n.fn'],
          },
        ],
      };
      const out = formatCodebaseGraphContextForPrompt(ctx);
      expect(out).toContain(
        '### Codebase-graph context (symbol-level callers/callees, plan §8.18 Phase 2)',
      );
      // Sorted by blast_radius_files_count desc — hot.ts (47) before medium.ts (12) before quiet.ts (1).
      const hotIdx = out.indexOf('`src/hot.ts`');
      const mediumIdx = out.indexOf('`src/medium.ts`');
      const quietIdx = out.indexOf('`src/quiet.ts`');
      expect(hotIdx).toBeGreaterThan(0);
      expect(hotIdx).toBeLessThan(mediumIdx);
      expect(mediumIdx).toBeLessThan(quietIdx);
      // Truncated SHA (12 chars) appears in the header per the formatter contract.
      expect(out).toContain('deadbeefcafe');
      // High-callers row truncates to 3 + "+N" suffix.
      expect(out).toContain('`a.fn`, `b.fn`, `c.fn` (+2)');
      // Empty list renders as em-dash.
      expect(out).toContain('| `src/hot.ts` | `a.fn`, `b.fn`, `c.fn` (+2) | `x.fn`, `y.fn` | 47 | ok |');
    });

    it('truncates a long callees list with `(+N)` suffix and renders em-dash for empty callers', () => {
      // Symmetric to the callers `(+N)` assertion in the table test above —
      // ensures the formatter applies the same 3-entry truncation contract
      // to both edge directions. Also covers the `f.callers === undefined`
      // em-dash branch alongside the populated callees branch.
      const out = formatCodebaseGraphContextForPrompt({
        files: [
          {
            file: 'src/wide.ts',
            blast_radius_files_count: 9,
            callees: ['x.fn', 'y.fn', 'z.fn', 'w.fn', 'v.fn'],
          },
        ],
      });
      expect(out).toContain('`x.fn`, `y.fn`, `z.fn` (+2)');
      // Callers absent → row renders em-dash in that column. Match against
      // the surrounding pipes so we don't false-match an em-dash elsewhere.
      expect(out).toContain('| `src/wide.ts` | — |');
    });

    it('teaches the LLM the §8.18 Phase 2 advisory thresholds', () => {
      const out = formatCodebaseGraphContextForPrompt({
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
      });
      // The advisory line must surface the structural-impact heuristic
      // ("when callers ≥ 1 and blast radius ≥ 5") so the LLM can apply
      // the structural signal consistently across files.
      expect(out).toContain('callers ≥ 1');
      expect(out).toContain('blast radius ≥ 5');
      // The per-status fall-back guidance must surface so the LLM
      // doesn't downrank findings on `no_symbols` files (data files,
      // generated code, unsupported languages) just because the graph
      // has nothing to say about them.
      expect(out).toContain('no_symbols');
    });

    it('omits the SHA line when default_branch_sha is absent', () => {
      const out = formatCodebaseGraphContextForPrompt({
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
      });
      expect(out).not.toContain('Graph built from default-branch SHA');
    });

    it('renders a coverage banner when coverage is non-`full`', () => {
      const out = formatCodebaseGraphContextForPrompt({
        coverage: 'partial',
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
      });
      expect(out).toContain('Coverage: **partial**');
      expect(out).toContain('fail-open');
    });

    it('does not render a coverage banner when coverage is `full` or unset', () => {
      const fullOut = formatCodebaseGraphContextForPrompt({
        coverage: 'full',
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
      });
      const unsetOut = formatCodebaseGraphContextForPrompt({
        files: [{ file: 'a.ts', blast_radius_files_count: 1 }],
      });
      expect(fullOut).not.toContain('Coverage:');
      expect(unsetOut).not.toContain('Coverage:');
    });
  });
});
