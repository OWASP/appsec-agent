/**
 * E2E (integration): `pr_reviewer` diff-context path through `main()` with
 * temp `diff-context.json` + `import-graph-context.json`, no live LLM —
 * `AgentActions` is mocked. Validates the v5.4.0 (§3.1 Stage B) wiring:
 * file → loadImportGraphContextFile → formatImportGraphContextForPrompt
 * → buildDiffReviewPrompt → diffReviewerWithOptions → output file.
 *
 * Mirror of `pr_adversary.e2e.test.ts` (v5.3.0 / §8.7). We deliberately
 * exercise the full `main()` path so any future refactor that drops the
 * `--import-graph-context` flag, skips `formatImportGraphContextForPrompt`,
 * or reorders the prompt assembly gets caught here rather than at runtime
 * on a live scan.
 *
 * Three cases:
 *   1. HAPPY PATH — import-graph context with three representative files
 *      (entry-point, reachable, unreachable) produces a prompt containing
 *      the `### File reachability summary` marker, the downrank coefficient
 *      guidance, the file-table rows, and the top-callers column; the
 *      output file is written; exit code is 0.
 *   2. FAIL-OPEN on bad payload — a malformed `import-graph-context.json`
 *      must NOT crash main(); the scan proceeds without the summary (the
 *      authoritative downrank lives in the parent app).
 *   3. PARTIAL COVERAGE — `coverage=partial` causes the fail-open
 *      advisory line to render in the prompt so the LLM knows graph
 *      coverage is incomplete.
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { main } from '../src/main';
import { AgentActions } from '../src/agent_actions';

jest.mock('../src/agent_actions', () => ({
  AgentActions: jest.fn(),
  AgentArgs: {},
}));
jest.mock('../src/utils', () => ({
  ...jest.requireActual('../src/utils'),
  copyProjectSrcDir: jest.fn(),
}));

// Minimal "no findings" report the diff reviewer returns. main() writes
// this truthy string straight to the output file — we don't need a real
// LLM round-trip for the wiring check.
const EMPTY_DIFF_REPORT = JSON.stringify({
  security_review_report: {
    metadata: {
      project_name: 'e2e',
      total_issues_found: 0,
      scan_type: 'pr_diff_review',
    },
    executive_summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, overview: 'ok' },
    findings: [],
  },
});

const mockAgentActions = {
  diffReviewerWithOptions: jest.fn(),
  prAdversaryWithOptions: jest.fn(),
  simpleQueryClaudeWithOptions: jest.fn(),
  codeReviewerWithOptions: jest.fn(),
  threatModelerAgentWithOptions: jest.fn(),
  codeFixerWithOptions: jest.fn(),
  qaVerifierWithOptions: jest.fn(),
  findingValidatorWithOptions: jest.fn(),
  contextExtractorWithOptions: jest.fn(),
};

(AgentActions as jest.MockedClass<typeof AgentActions>).mockImplementation(
  () => mockAgentActions as any,
);

// The real main() routes pr_reviewer+diff_context through the "diff review"
// branch. buildDiffReviewPrompt ultimately yields a string that's passed
// to diffReviewerWithOptions — we assert on that prompt.
const VALID_DIFF_CONTEXT = {
  prNumber: 777,
  baseBranch: 'main',
  headBranch: 'feature/import-graph-e2e',
  headSha: 'deadbeefcafebabedeadbeefcafebabe00000001',
  owner: 'test-owner',
  repo: 'test-repo',
  files: [
    {
      filePath: 'backend/src/api/users.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [
        { startLine: 10, endLine: 12, changedCode: '+export function handler() {}' },
      ],
    },
    {
      filePath: 'backend/src/services/userService.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [
        { startLine: 42, endLine: 45, changedCode: '+function updateUser() {}' },
      ],
    },
    {
      filePath: 'backend/src/utils/dead.ts',
      language: 'typescript',
      fileType: 'added' as const,
      hunks: [
        { startLine: 1, endLine: 3, changedCode: '+export function unused() { return 1; }' },
      ],
    },
  ],
  totalFilesChanged: 3,
  totalLinesAdded: 3,
  totalLinesRemoved: 0,
};

const VALID_IMPORT_GRAPH_CTX = {
  project_id: 'test-project',
  project_name: 'test-repo',
  default_branch_sha: 'deadbeefcafebabedeadbeefcafebabe00000001',
  coverage: 'full' as const,
  files: [
    {
      file: 'backend/src/api/users.ts',
      inbound_prod_import_count: 0,
      callers: [],
      is_entry_point: true,
      graph_status: 'ok' as const,
    },
    {
      file: 'backend/src/services/userService.ts',
      inbound_prod_import_count: 5,
      callers: [
        'backend/src/api/users.ts',
        'backend/src/api/admin.ts',
        'backend/src/routes/accounts.ts',
      ],
      is_entry_point: false,
      graph_status: 'ok' as const,
    },
    {
      file: 'backend/src/utils/dead.ts',
      inbound_prod_import_count: 0,
      callers: [],
      is_entry_point: false,
      graph_status: 'ok' as const,
    },
  ],
};

describe('e2e pr_reviewer + --import-graph-context (mocked LLM)', () => {
  let testDir: string;
  const outName = 'e2e_pr_reviewer_out.json';
  let exitMock: jest.Mock;
  const realExit = process.exit;
  const confDict = {
    default: {
      code_reviewer: { options: {} },
      pr_reviewer: { options: {} },
    },
  };

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `appsec-pr-reviewer-ig-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    fs.ensureDirSync(testDir);
    exitMock = jest.fn();
    process.exit = exitMock as any;
    mockAgentActions.diffReviewerWithOptions.mockReset();
    mockAgentActions.diffReviewerWithOptions.mockResolvedValue(EMPTY_DIFF_REPORT);
  });

  afterEach(() => {
    process.exit = realExit;
    if (testDir && fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  it('injects the import-graph summary into the diff-review prompt and writes the output file', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const igPath = path.join(testDir, 'import-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    fs.writeFileSync(igPath, JSON.stringify(VALID_IMPORT_GRAPH_CTX), 'utf-8');

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        import_graph_context: igPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;

      // Header emitted by formatImportGraphContextForPrompt — catches
      // regressions where the format helper stops being invoked.
      expect(userPrompt).toContain('### File reachability summary (import-graph, Stage B)');
      // Downrank-coefficient guidance: the LLM must be told about × 0.3
      // so it stops raising HIGH on unreachable helpers before the
      // parent-app scorer does it mechanically.
      expect(userPrompt).toContain('0.3');
      expect(userPrompt).toContain('inbound_prod_import_count == 0');
      // Short SHA (12 chars) appears in the header per the schema formatter.
      expect(userPrompt).toContain('deadbeefcafe');
      // Each file in the context renders a table row.
      expect(userPrompt).toContain('`backend/src/api/users.ts`');
      expect(userPrompt).toContain('`backend/src/services/userService.ts`');
      expect(userPrompt).toContain('`backend/src/utils/dead.ts`');
      // Top-callers column shows at least one caller for the reachable
      // file; the unreachable row should NOT have any caller fenced code
      // other than the em-dash placeholder. We only assert the reachable
      // side positively so the format can evolve the "no callers" render
      // without breaking this test.
      expect(userPrompt).toContain('`backend/src/api/users.ts`');

      // The diff-context PR preamble is still present — the graph summary
      // augments, not replaces, the diff framing.
      expect(userPrompt).toContain('PR #777');
      expect(userPrompt).toContain('test-owner/test-repo');

      // Output file written with the mock LLM body.
      const outPath = path.join(testDir, outName);
      expect(fs.existsSync(outPath)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
      expect(parsed.security_review_report).toBeDefined();

      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('fails open on a malformed import-graph context (no summary, scan still runs)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const igPath = path.join(testDir, 'import-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    // Deliberately invalid — missing the `files` array.
    fs.writeFileSync(igPath, JSON.stringify({ project_id: 'x' }), 'utf-8');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        import_graph_context: igPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      // The diff review still ran — fail-open contract.
      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      // But NO import-graph header got injected — the authoritative
      // downrank lives in the parent app and must not be blocked by a
      // bad payload here.
      expect(userPrompt).not.toContain('### File reachability summary (import-graph, Stage B)');
      // A warning was logged so ops can spot corrupt payloads.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid import-graph context'));
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
      warnSpy.mockRestore();
    }
  });

  it('renders the partial-coverage advisory line when coverage is not full', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const igPath = path.join(testDir, 'import-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    fs.writeFileSync(
      igPath,
      JSON.stringify({
        ...VALID_IMPORT_GRAPH_CTX,
        coverage: 'partial',
      }),
      'utf-8',
    );

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        import_graph_context: igPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      expect(userPrompt).toContain('### File reachability summary (import-graph, Stage B)');
      // Partial-coverage advisory — the LLM needs to know missing files
      // won't be downranked so it can be appropriately conservative.
      expect(userPrompt).toContain('partial');
      expect(userPrompt).toContain('fail-open');
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
