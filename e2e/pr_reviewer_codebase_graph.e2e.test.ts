/**
 * E2E (integration): `pr_reviewer` diff-context path through `main()` with
 * temp `diff-context.json` + `codebase-graph-context.json`, no live LLM —
 * `AgentActions` is mocked. Validates the v2.6.0 (parent-app plan §8.18
 * Phase 2) wiring: file → loadCodebaseGraphContextFile →
 * formatCodebaseGraphContextForPrompt → buildDiffReviewPrompt →
 * diffReviewerWithOptions → output file.
 *
 * Mirror of `pr_reviewer_runtime_enrichment.e2e.test.ts` (v2.3.0) and
 * `pr_reviewer_import_graph.e2e.test.ts` (v2.2.0). We deliberately exercise
 * the full `main()` path so any future refactor that drops the
 * `--codebase-graph-context` flag, skips
 * `formatCodebaseGraphContextForPrompt`, or reorders the prompt assembly
 * gets caught here rather than at runtime on a live scan.
 *
 * Three cases:
 *   1. HAPPY PATH — codebase-graph context with three representative files
 *      (high/medium/low blast-radius) produces a prompt containing the
 *      `### Codebase-graph context` marker, the §8.18 Phase 2 advisory
 *      thresholds (`callers ≥ 1`, `blast radius ≥ 5`), the file table
 *      sorted blast-radius desc, and the truncated SHA; the output file
 *      is written; exit code is 0.
 *   2. FAIL-OPEN on bad payload — a malformed
 *      `codebase-graph-context.json` must NOT crash main(); the scan
 *      proceeds without the summary (Phase 2 is purely advisory; the
 *      authoritative cbm artifact remains shadow-only on the parent side
 *      until Phase 4).
 *   3. EMPTY FILES list — the parent app emits `files: []` when the cbm
 *      head row exists but no PR file overlaps with traceable symbols.
 *      The formatter must short-circuit so the LLM doesn't see an empty
 *      advisory header that confuses it.
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
  prNumber: 999,
  baseBranch: 'main',
  headBranch: 'feature/codebase-graph-e2e',
  headSha: 'cafebabedeadbeefcafebabedeadbeef00000003',
  owner: 'test-owner',
  repo: 'test-repo',
  files: [
    {
      filePath: 'backend/src/services/payments.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [{ startLine: 10, endLine: 12, changedCode: '+function chargeCard() {}' }],
    },
    {
      filePath: 'backend/src/services/notifications.ts',
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

const VALID_CODEBASE_GRAPH_CTX = {
  default_branch_sha: 'cafebabedeadbeefcafebabedeadbeef00000003',
  parsed_at: '2026-05-12T20:00:00Z',
  metadata: { project_name: 'test-repo' },
  coverage: 'full' as const,
  files: [
    {
      file: 'backend/src/services/payments.ts',
      symbols_changed: ['PaymentsService.charge'],
      callers: [
        'routes/api/payments.handlePost',
        'routes/webhooks/stripe.handler',
        'routes/admin/refunds.process',
      ],
      callees: ['db.transaction', 'audit.recordPayment'],
      blast_radius_files_count: 47,
      graph_status: 'ok' as const,
    },
    {
      file: 'backend/src/services/notifications.ts',
      symbols_changed: ['NotificationService.sendEmail'],
      callers: ['routes/api/users.notify'],
      callees: ['mailer.send'],
      blast_radius_files_count: 12,
      graph_status: 'ok' as const,
    },
    {
      file: 'backend/src/utils/format.ts',
      blast_radius_files_count: 1,
      graph_status: 'no_symbols' as const,
    },
  ],
};

describe('e2e pr_reviewer + --codebase-graph-context (mocked LLM)', () => {
  let testDir: string;
  const outName = 'e2e_pr_reviewer_cbm_out.json';
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
      `appsec-pr-reviewer-cbm-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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

  it('injects the codebase-graph summary into the diff-review prompt and writes the output file', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const cgPath = path.join(testDir, 'codebase-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    fs.writeFileSync(cgPath, JSON.stringify(VALID_CODEBASE_GRAPH_CTX), 'utf-8');

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        codebase_graph_context: cgPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;

      // Header emitted by formatCodebaseGraphContextForPrompt — catches
      // regressions where the format helper stops being invoked.
      expect(userPrompt).toContain(
        '### Codebase-graph context (symbol-level callers/callees, plan §8.18 Phase 2)',
      );
      // The §8.18 Phase 2 advisory thresholds must surface so the LLM
      // applies the structural signal consistently.
      expect(userPrompt).toContain('callers ≥ 1');
      expect(userPrompt).toContain('blast radius ≥ 5');
      // Truncated SHA (12 chars) appears in the header.
      expect(userPrompt).toContain('cafebabedead');
      // Each file in the context renders a table row.
      expect(userPrompt).toContain('`backend/src/services/payments.ts`');
      expect(userPrompt).toContain('`backend/src/services/notifications.ts`');
      expect(userPrompt).toContain('`backend/src/utils/format.ts`');
      // Sorted by blast_radius_files_count desc — payments (47) before
      // notifications (12) before format (1).
      const payIdx = userPrompt.indexOf('`backend/src/services/payments.ts`');
      const notifIdx = userPrompt.indexOf('`backend/src/services/notifications.ts`');
      const fmtIdx = userPrompt.indexOf('`backend/src/utils/format.ts`');
      expect(payIdx).toBeLessThan(notifIdx);
      expect(notifIdx).toBeLessThan(fmtIdx);
      // The high-callers row truncates to 3 + "+N" suffix.
      expect(userPrompt).toContain(
        '`routes/api/payments.handlePost`, `routes/webhooks/stripe.handler`, `routes/admin/refunds.process`',
      );

      // The diff-context PR preamble is still present — the codebase-graph
      // summary augments, not replaces, the diff framing.
      expect(userPrompt).toContain('PR #999');
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

  it('fails open on a malformed codebase-graph context (no summary, scan still runs)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const cgPath = path.join(testDir, 'codebase-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    // Deliberately invalid — missing the `files` array.
    fs.writeFileSync(cgPath, JSON.stringify({ project_id: 'x' }), 'utf-8');

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        codebase_graph_context: cgPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      // The diff review still ran — fail-open contract.
      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      // But NO codebase-graph header got injected — Phase 2 is purely
      // advisory and a bad payload must not block the scan.
      expect(userPrompt).not.toContain('### Codebase-graph context');
      // A warning was logged so ops can spot corrupt payloads.
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid codebase-graph context'));
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
      warnSpy.mockRestore();
    }
  });

  it('omits the advisory block entirely when files list is empty (no traceable overlap)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    const cgPath = path.join(testDir, 'codebase-graph-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');
    // Parent app contract: when the cbm head row exists but no changed
    // file produced traceable symbols, the `files` array is empty (root
    // `coverage` is set to `none` or `empty`). The formatter must
    // short-circuit so the prompt doesn't include a confusing empty
    // advisory header.
    fs.writeFileSync(
      cgPath,
      JSON.stringify({
        default_branch_sha: 'cafebabedeadbeefcafebabedeadbeef00000003',
        coverage: 'none',
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
        codebase_graph_context: cgPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      // Empty list → header omitted entirely.
      expect(userPrompt).not.toContain('### Codebase-graph context');
      // But the diff review still proceeded normally.
      expect(userPrompt).toContain('PR #999');
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
