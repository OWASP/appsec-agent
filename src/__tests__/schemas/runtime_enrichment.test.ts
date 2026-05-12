import {
  parseRuntimeEnrichmentContext,
  formatRuntimeEnrichmentContextForPrompt,
  type RuntimeEnrichmentContext,
} from '../../schemas/runtime_enrichment';

describe('runtime_enrichment schema (v2.3.0 / parent-app plan §4 + §8.14)', () => {
  describe('parseRuntimeEnrichmentContext', () => {
    it('parses a minimal valid payload', () => {
      const ctx = parseRuntimeEnrichmentContext({
        files: [{ file: 'src/foo.ts', incident_count: 0 }],
      });
      expect(ctx.files).toHaveLength(1);
      expect(ctx.files[0].file).toBe('src/foo.ts');
      expect(ctx.files[0].incident_count).toBe(0);
      expect(ctx.files[0].last_seen_at).toBeUndefined();
    });

    it('parses last_seen_at when provided', () => {
      const ctx = parseRuntimeEnrichmentContext({
        files: [
          {
            file: 'src/a.ts',
            incident_count: 5,
            last_seen_at: '2026-04-20',
          },
        ],
      });
      expect(ctx.files[0].last_seen_at).toBe('2026-04-20');
    });

    it('drops empty/whitespace last_seen_at strings', () => {
      const ctx = parseRuntimeEnrichmentContext({
        files: [
          { file: 'src/a.ts', incident_count: 1, last_seen_at: '' },
          { file: 'src/b.ts', incident_count: 1, last_seen_at: '   ' },
          { file: 'src/c.ts', incident_count: 1, last_seen_at: 42 },
        ],
      });
      expect(ctx.files[0].last_seen_at).toBeUndefined();
      expect(ctx.files[1].last_seen_at).toBeUndefined();
      expect(ctx.files[2].last_seen_at).toBeUndefined();
    });

    it('floors fractional incident counts and clamps negatives to 0', () => {
      const ctx = parseRuntimeEnrichmentContext({
        files: [
          { file: 'a.ts', incident_count: 3.7 },
          { file: 'b.ts', incident_count: -5 },
        ],
      });
      expect(ctx.files[0].incident_count).toBe(3);
      expect(ctx.files[1].incident_count).toBe(0);
    });

    it('silently drops unknown extra fields on each file entry (PHI minimization)', () => {
      // §8.5 PHI gate: even if a buggy backend includes incident bodies /
      // stack traces / request payloads in a future revision, the schema
      // strips them before the LLM ever sees them.
      const ctx = parseRuntimeEnrichmentContext({
        files: [
          {
            file: 'src/a.ts',
            incident_count: 2,
            last_seen_at: '2026-04-01',
            stack_trace: 'patient_id=1234 leaked here',
            request_body: '{"ssn":"..."}',
          },
        ],
      });
      const f = ctx.files[0] as unknown as Record<string, unknown>;
      expect(Object.keys(f).sort()).toEqual(['file', 'incident_count', 'last_seen_at']);
      expect(f.stack_trace).toBeUndefined();
      expect(f.request_body).toBeUndefined();
    });

    it('accepts metadata + default_branch_sha + parsed_at', () => {
      const ctx = parseRuntimeEnrichmentContext({
        default_branch_sha: 'abc123',
        parsed_at: '2026-04-25T20:00:00Z',
        files: [{ file: 'a.ts', incident_count: 1 }],
        metadata: { project_name: 'example-parent-app' },
      });
      expect(ctx.default_branch_sha).toBe('abc123');
      expect(ctx.parsed_at).toBe('2026-04-25T20:00:00Z');
      expect(ctx.metadata?.project_name).toBe('example-parent-app');
    });

    it('rejects non-object input', () => {
      expect(() => parseRuntimeEnrichmentContext(null)).toThrow(/must be a JSON object/);
      expect(() => parseRuntimeEnrichmentContext('x')).toThrow(/must be a JSON object/);
    });

    it('rejects missing files array', () => {
      expect(() => parseRuntimeEnrichmentContext({})).toThrow(/must include a "files" array/);
    });

    it('rejects files.length > 500', () => {
      const big = Array.from({ length: 501 }, (_, i) => ({
        file: `f${i}.ts`,
        incident_count: 0,
      }));
      expect(() => parseRuntimeEnrichmentContext({ files: big })).toThrow(/at most 500 files/);
    });

    it('rejects entries without a file string', () => {
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ incident_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ file: '', incident_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ file: '   ', incident_count: 0 }] }),
      ).toThrow(/non-empty string "file"/);
    });

    it('rejects entries without numeric incident_count', () => {
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ file: 'a.ts', incident_count: 'x' }] }),
      ).toThrow(/numeric "incident_count"/);
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ file: 'a.ts', incident_count: NaN }] }),
      ).toThrow(/numeric "incident_count"/);
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [{ file: 'a.ts', incident_count: Infinity }] }),
      ).toThrow(/numeric "incident_count"/);
    });

    it('rejects non-object file entries', () => {
      expect(() =>
        parseRuntimeEnrichmentContext({ files: ['src/a.ts'] }),
      ).toThrow(/must be an object/);
      expect(() =>
        parseRuntimeEnrichmentContext({ files: [null] }),
      ).toThrow(/must be an object/);
    });
  });

  describe('formatRuntimeEnrichmentContextForPrompt', () => {
    it('returns empty string when files list is empty', () => {
      const out = formatRuntimeEnrichmentContextForPrompt({ files: [] });
      expect(out).toBe('');
    });

    it('renders a compact markdown table sorted by incident_count desc', () => {
      const ctx: RuntimeEnrichmentContext = {
        default_branch_sha: 'deadbeefcafe1234567890',
        files: [
          { file: 'src/quiet.ts', incident_count: 1, last_seen_at: '2026-04-22' },
          { file: 'src/hot.ts', incident_count: 12, last_seen_at: '2026-04-24' },
          { file: 'src/medium.ts', incident_count: 4 },
        ],
      };
      const out = formatRuntimeEnrichmentContextForPrompt(ctx);
      expect(out).toContain('### Runtime-signal context (production incidents, plan §4)');
      // Sorted by incident_count desc — hot.ts must appear before medium.ts and quiet.ts
      const hotIdx = out.indexOf('`src/hot.ts`');
      const mediumIdx = out.indexOf('`src/medium.ts`');
      const quietIdx = out.indexOf('`src/quiet.ts`');
      expect(hotIdx).toBeGreaterThan(0);
      expect(hotIdx).toBeLessThan(mediumIdx);
      expect(mediumIdx).toBeLessThan(quietIdx);
      // Truncated SHA (12 chars) appears in the header per the schema formatter.
      expect(out).toContain('deadbeefcafe');
      // last_seen_at renders inline; missing values render as em-dash.
      expect(out).toContain('| `src/hot.ts` | 12 | 2026-04-24 |');
      expect(out).toContain('| `src/medium.ts` | 4 | — |');
    });

    it('teaches the LLM the §4 transform numbers (medium → low / 0.6 → 0.4)', () => {
      const out = formatRuntimeEnrichmentContextForPrompt({
        files: [{ file: 'a.ts', incident_count: 1 }],
      });
      // The advisory line must surface BOTH halves of the §4 transform so
      // the LLM can match what the post-LLM gate override will do — the
      // value of the prompt hint is precisely that the LLM sees the same
      // numbers the gate is using.
      expect(out).toContain('medium → low');
      expect(out).toContain('0.6 → 0.4');
      // The "operationally fragile" phrasing is the one the LLM should
      // anchor on — specific enough not to be ignored, generic enough to
      // not over-fit on a single CWE class.
      expect(out).toContain('operationally fragile');
    });

    it('omits the SHA line when default_branch_sha is absent', () => {
      const out = formatRuntimeEnrichmentContextForPrompt({
        files: [{ file: 'a.ts', incident_count: 1 }],
      });
      expect(out).not.toContain('Hot-file list anchored');
    });
  });
});
