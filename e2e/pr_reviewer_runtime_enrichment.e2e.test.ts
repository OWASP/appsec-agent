/**
 * E2E (integration): `pr_reviewer` diff-context path through `main()` with
 * temp `diff-context.json` + `runtime-enrichment-context.json`, no live
 * LLM — `AgentActions` is mocked. Validates the v2.3.0 (sast-ai-app plan
 * §4 + §8.14) wiring: file → loadRuntimeEnrichmentContextFile →
 * formatRuntimeEnrichmentContextForPrompt → buildDiffReviewPrompt →
 * diffReviewerWithOptions → output file.
 *
 * Mirror of `pr_reviewer_import_graph.e2e.test.ts` (v5.4.0). We deliberately
 * exercise the full `main()` path so any future refactor that drops the
 * `--runtime-enrichment-context` flag, skips
 * `formatRuntimeEnrichmentContextForPrompt`, or reorders the prompt
 * assembly gets caught here rather than at runtime on a live scan.
 *
 * Three cases:
 *   1. HAPPY PATH — runtime-enrichment context with three representative
 *      files (high/medium/low incident count) produces a prompt containing
 *      the `### Runtime-signal context` marker, the §4 transform numbers
 *      (medium → low / 0.6 → 0.4), the file table sorted incident-count
 *      desc, and the truncated SHA; the output file is written; exit code
 *      is 0.
 *   2. FAIL-OPEN on bad payload — a malformed
 *      `runtime-enrichment-context.json` must NOT crash main(); the scan
 *      proceeds without the summary (the authoritative gate override lives
 *      in the parent app and only depends on `matchedFiles`).
 *   3. EMPTY FILES list — the parent app emits `files: []` when
 *      enrichment is configured but no PR file overlaps with the hot-file
 *      list. The formatter must short-circuit so the LLM doesn't see an
 *      empty advisory header that confuses it.
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

const VALID_DIFF_CONTEXT = {
  prNumber: 888,
  baseBranch: 'main',
  headBranch: 'feature/runtime-enrichment-e2e',
  headSha: 'cafebabedeadbeefcafebabedeadbeef00000002',
  owner: 'test-owner',
  repo: 'test-repo',
  files: [
    {
      filePath: 'backend/src/services/paymentProcessor.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [{ startLine: 10, endLine: 12, changedCode: '+function chargeCard() {}' }],
    },
    {
      filePath: 'backend/src/services/notificationService.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [{ startLine: 42, endLine: 45, changedCode: '+function sendEmail() {}' }],
    },
    {
      filePath: 'backend/src/utils/format.ts',
      language: 'typescript',
      fileType: 'added' as const,
      hunks: [{ startLine: 1, endLine: 3, changedCode: '+export function fmt() { return 1; }' }],
    },
  ],
  totalFilesChanged: 3,
  totalLinesAdded: 3,
  totalLinesRemoved: 0,
};

const VALID_RUNTIME_ENRICHMENT_CTX = {
  default_branch_sha: 'cafebabedeadbeefcafebabedeadbeef00000002',
  parsed_at: '2026-04-25T20:00:00Z',
  metadata: { project_name: 'test-repo' },
  files: [
    {
      file: 'backend/src/services/paymentProcessor.ts',
      incident_count: 12,
      last_seen_at: '2026-04-24',
    },
    {
      file: 'backend/src/services/notificationService.ts',
      incident_count: 4,
      last_seen_at: '2026-04-18',
    },
    {
      file: 'backend/src/utils/format.ts',
      incident_count: 1,
    },
  ],
};

describe('e2e pr_reviewer + --runtime-enrichment-context (mocked LLM)', () => {
  let testDir: string;
  const outName = 'e2e_pr_reviewer_re_out.json';
  let exitMock: jest.Mock;
  const realExit = process.exit;
  const confDict = {
    default: {
      code_reviewer: { options: {} },
      pr_reviewer: { options: {} },
    },
  };

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `appsec-pr-reviewer-re-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
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

  it('injects the runtime-enrichment summary into the diff-review prompt and writes the output file', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const rePath = path.join(testDir, 'runtime-enrichment-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    fs.writeFileSync(rePath, JSON.stringify(VALID_RUNTIME_ENRICHMENT_CTX), 'utf-8');

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        runtime_enrichment_context: rePath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;

      // Header emitted by formatRuntimeEnrichmentContextForPrompt — catches
      // regressions where the format helper stops being invoked.
      expect(userPrompt).toContain('### Runtime-signal context (production incidents, plan §4)');
      // The §4 transform numbers must surface so the LLM and the post-LLM
      // gate override apply consistent thresholds. Failing this assertion
      // means the prompt has drifted away from the gate behavior — high
      // signal for a manual review.
      expect(userPrompt).toContain('medium → low');
      expect(userPrompt).toContain('0.6 → 0.4');
      // Truncated SHA (12 chars) appears in the header.
      expect(userPrompt).toContain('cafebabedead');
      // Each file in the context renders a table row.
      expect(userPrompt).toContain('`backend/src/services/paymentProcessor.ts`');
      expect(userPrompt).toContain('`backend/src/services/notificationService.ts`');
      expect(userPrompt).toContain('`backend/src/utils/format.ts`');
      // Sorted by incident_count desc — paymentProcessor (12) must appear
      // before notificationService (4) and format (1).
      const payIdx = userPrompt.indexOf('`backend/src/services/paymentProcessor.ts`');
      const notifIdx = userPrompt.indexOf('`backend/src/services/notificationService.ts`');
      const fmtIdx = userPrompt.indexOf('`backend/src/utils/format.ts`');
      expect(payIdx).toBeLessThan(notifIdx);
      expect(notifIdx).toBeLessThan(fmtIdx);

      // The diff-context PR preamble is still present — the runtime
      // summary augments, not replaces, the diff framing.
      expect(userPrompt).toContain('PR #888');
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

  it('fails open on a malformed runtime-enrichment context (no summary, scan still runs)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const rePath = path.join(testDir, 'runtime-enrichment-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    // Deliberately invalid — missing the `files` array.
    fs.writeFileSync(rePath, JSON.stringify({ project_id: 'x' }), 'utf-8');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        runtime_enrichment_context: rePath,
        output_file: outName,
        output_format: 'json',
      } as any);

      // The diff review still ran — fail-open contract.
      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      // But NO runtime-enrichment header got injected — the authoritative
      // gate override lives in the parent app and must not be blocked by
      // a bad payload here.
      expect(userPrompt).not.toContain('### Runtime-signal context');
      // A warning was logged so ops can spot corrupt payloads.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid runtime-enrichment context'));
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
      warnSpy.mockRestore();
    }
  });

  it('omits the advisory block entirely when files list is empty (no PR overlap)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const rePath = path.join(testDir, 'runtime-enrichment-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    // Parent app contract: when enrichment is configured but no changed
    // file overlaps with the hot-file list, the `files` array is empty.
    // The formatter must short-circuit so the prompt doesn't include a
    // confusing empty advisory header.
    fs.writeFileSync(
      rePath,
      JSON.stringify({
        default_branch_sha: 'cafebabedeadbeefcafebabedeadbeef00000002',
        files: [],
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
        runtime_enrichment_context: rePath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      // Empty list → header omitted entirely.
      expect(userPrompt).not.toContain('### Runtime-signal context');
      // But the diff review still proceeded normally.
      expect(userPrompt).toContain('PR #888');
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
