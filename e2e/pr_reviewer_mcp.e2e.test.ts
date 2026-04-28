/**
 * E2E (integration): `pr_reviewer` diff-context path through `main()` with
 * the v2.4.0 `--mcp-server-url` flag wired in. No live LLM — `AgentActions`
 * is mocked so we observe the args object the CLI threads through, and we
 * also exercise `AgentOptions.getDiffReviewerOptions` directly to verify
 * the SDK-shaped `Options` it would have produced.
 *
 * This test pins the wiring contract between the agent and a parent
 * app's per-scan in-process MCP server. If any future refactor drops
 * the `--mcp-server-url` flag, stops propagating `args.mcp_server_url`
 * into `AgentActions`, or breaks the `Options.mcpServers` shape the SDK
 * expects, the failure surfaces here instead of as a silent regression
 * in production scans.
 *
 * Three cases:
 *   1. HAPPY PATH — `--mcp-server-url` is supplied. `AgentActions` is
 *      constructed with `args.mcp_server_url` set, `diffReviewerWithOptions`
 *      is invoked, and the role builder produces an `Options` object with
 *      the expected `mcpServers` block + extended `tools` whitelist.
 *   2. NO-FLAG BASELINE — without `--mcp-server-url`, the agent falls
 *      back to the v2.3.0 behavior: `Options.mcpServers` is undefined,
 *      and the subagent's tool whitelist matches the historic
 *      `['Read', 'Grep', 'Write']` list. Front-loaded JSON paths
 *      (`--import-graph-context`, `--runtime-enrichment-context`) remain
 *      the always-available alternative.
 *   3. ROLE GATE — `--mcp-server-url` is set but the role
 *      (`finding_validator` here) is one of the four MCP-aware roles.
 *      The args still propagate correctly. (Roles outside the
 *      MCP-aware set don't reach `getDiffReviewerOptions`; the bin/
 *      level warning is exercised in `agent-run.test.ts`.)
 *
 * The fourth role builder coverage (`getCodeFixerOptions`,
 * `getFindingValidatorOptions`, `getPrAdversaryOptions`) lives in the
 * unit suite at `src/__tests__/agent_options.mcp.test.ts`; here we only
 * need to demonstrate that the CLI → main() → AgentActions path
 * threads the URL through unchanged for the highest-volume reasoning
 * role.
 */
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs-extra';
import { main } from '../src/main';
import { AgentActions, AgentArgs } from '../src/agent_actions';
import {
  AgentOptions,
  MCP_INTERNAL_SERVER_NAME,
  buildMcpInternalToolNames,
} from '../src/agent_options';

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
    executive_summary: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
      overview: 'ok',
    },
    findings: [],
  },
});

const EMPTY_RETEST_VERDICT = JSON.stringify({
  retest_verdict: {
    finding_id: 'placeholder',
    status: 'still_present',
    confidence: 'low',
    reasoning: 'mock',
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
  headBranch: 'feature/mcp-e2e',
  headSha: 'cafebabedeadbeefcafebabedeadbeef00000003',
  owner: 'test-owner',
  repo: 'test-repo',
  files: [
    {
      filePath: 'backend/src/services/paymentProcessor.ts',
      language: 'typescript',
      fileType: 'modified' as const,
      hunks: [{ startLine: 10, endLine: 12, changedCode: '+function chargeCard() {}' }],
    },
  ],
  totalFilesChanged: 1,
  totalLinesAdded: 1,
  totalLinesRemoved: 0,
};

const TEST_MCP_URL = 'http://127.0.0.1:9999/mcp';
const expectedMcpToolNames = buildMcpInternalToolNames();

describe('e2e pr_reviewer + --mcp-server-url (mocked LLM, v2.4.0)', () => {
  let testDir: string;
  const outName = 'e2e_pr_reviewer_mcp_out.json';
  let exitMock: jest.Mock;
  const realExit = process.exit;
  const confDict = {
    default: {
      code_reviewer: { options: {} },
      pr_reviewer: { options: {} },
      pr_adversary: { options: {} },
      finding_validator: { options: {} },
      code_fixer: { options: {} },
    },
  };

  beforeEach(() => {
    testDir = path.join(
      os.tmpdir(),
      `appsec-pr-reviewer-mcp-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    );
    fs.ensureDirSync(testDir);
    exitMock = jest.fn();
    process.exit = exitMock as any;
    (AgentActions as jest.MockedClass<typeof AgentActions>).mockClear();
    mockAgentActions.diffReviewerWithOptions.mockReset();
    mockAgentActions.diffReviewerWithOptions.mockResolvedValue(EMPTY_DIFF_REPORT);
    mockAgentActions.findingValidatorWithOptions.mockReset();
    mockAgentActions.findingValidatorWithOptions.mockResolvedValue(EMPTY_RETEST_VERDICT);
  });

  afterEach(() => {
    process.exit = realExit;
    if (testDir && fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  /**
   * HAPPY PATH — verify two halves of the v2.4.0 contract in one test:
   *   (a) main() constructs `AgentActions` with `args.mcp_server_url` set,
   *   (b) the role builder, when called with that URL, produces the SDK
   *       Options shape the parent app's MCP server depends on.
   */
  it('threads --mcp-server-url through main() and produces the expected Options shape', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        output_file: outName,
        output_format: 'json',
        mcp_server_url: TEST_MCP_URL,
      } as any);

      // (a) AgentActions constructor sees the URL on the args object —
      // `new AgentActions(confDict, environment, args)`.
      expect(AgentActions).toHaveBeenCalledTimes(1);
      const ctorCall = (AgentActions as jest.MockedClass<typeof AgentActions>)
        .mock.calls[0];
      const passedArgs = ctorCall[2] as AgentArgs;
      expect(passedArgs.mcp_server_url).toBe(TEST_MCP_URL);
      expect(passedArgs.role).toBe('pr_reviewer');

      // The diff review still ran with the diff context attached — the
      // MCP wiring augments, not replaces, the diff framing.
      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      const userPrompt =
        mockAgentActions.diffReviewerWithOptions.mock.calls[0][0] as string;
      expect(userPrompt).toContain('PR #999');
      expect(userPrompt).toContain('test-owner/test-repo');

      // Output file written.
      const outPath = path.join(testDir, outName);
      expect(fs.existsSync(outPath)).toBe(true);
      expect(exitMock).toHaveBeenCalledWith(0);

      // (b) Sanity-check the SDK Options shape the role builder would
      // produce given that args.mcp_server_url. We re-invoke the
      // builder directly because `diffReviewerWithOptions` is mocked
      // (the real `AgentActions` would call this builder internally).
      // Using the same confDict/environment the test uses for main().
      const ao = new AgentOptions(confDict as any, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        'json',
        undefined,
        false,
        false,
        TEST_MCP_URL,
      );
      // The MCP server config is keyed by the deterministic name the
      // model and the per-tool counters reference.
      expect(opts.mcpServers).toEqual({
        [MCP_INTERNAL_SERVER_NAME]: { type: 'http', url: TEST_MCP_URL },
      });
      // The diff-reviewer subagent's tools whitelist is the v2.3.0 list
      // PLUS the three backend-backed tools (in that order).
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual([
        'Read',
        'Grep',
        'Write',
        ...expectedMcpToolNames,
      ]);
    } finally {
      process.chdir(prevCwd);
    }
  });

  /**
   * NO-FLAG BASELINE — when `--mcp-server-url` is omitted, we expect
   * exactly the v2.3.0 behavior: no MCP server in Options, no extra
   * tools. This catches accidental defaults / hidden auto-wiring.
   */
  it('does not attach mcpServers when the flag is omitted (v2.3.0 baseline preserved)', async () => {
    const diffPath = path.join(testDir, 'diff-context.json');
    fs.writeFileSync(diffPath, JSON.stringify(VALID_DIFF_CONTEXT), 'utf-8');

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_reviewer',
        environment: 'default',
        diff_context: diffPath,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(AgentActions).toHaveBeenCalledTimes(1);
      const passedArgs =
        (AgentActions as jest.MockedClass<typeof AgentActions>).mock.calls[0][2] as AgentArgs;
      expect(passedArgs.mcp_server_url).toBeUndefined();
      expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledTimes(1);
      expect(exitMock).toHaveBeenCalledWith(0);

      // Confirm Options shape: no mcpServers, no MCP tools in the
      // whitelist, identical to v2.3.0.
      const ao = new AgentOptions(confDict as any, 'default');
      const opts = ao.getDiffReviewerOptions('pr_reviewer', null, 'json');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Read', 'Grep', 'Write']);
      for (const mcpTool of expectedMcpToolNames) {
        expect(agent.tools).not.toContain(mcpTool);
      }
    } finally {
      process.chdir(prevCwd);
    }
  });

  /**
   * ROLE GATE — when `finding_validator` is invoked with --mcp-server-url
   * (one of the four MCP-aware roles), the URL is propagated through to
   * the AgentActions args. The role-builder side of the contract is
   * exercised by the unit suite (`agent_options.mcp.test.ts`); here we
   * only validate the CLI → main() propagation path.
   */
  it('propagates --mcp-server-url to AgentActions for finding_validator role', async () => {
    const retestPath = path.join(testDir, 'retest-context.json');
    // finding_validator expects a JSON file with a finding shape.
    fs.writeFileSync(
      retestPath,
      JSON.stringify({
        finding: {
          title: 'SQL injection in user lookup',
          file: 'backend/src/db.ts',
          line: 42,
          severity: 'high',
          description: 'Concatenated user input directly into a SQL string.',
        },
        code_snippet: "db.query('SELECT * FROM users WHERE id = ' + userId)",
      }),
      'utf-8',
    );

    const prevCwd = process.cwd();
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'finding_validator',
        environment: 'default',
        retest_context: retestPath,
        output_file: outName,
        output_format: 'json',
        mcp_server_url: TEST_MCP_URL,
      } as any);

      expect(AgentActions).toHaveBeenCalledTimes(1);
      const passedArgs =
        (AgentActions as jest.MockedClass<typeof AgentActions>).mock.calls[0][2] as AgentArgs;
      expect(passedArgs.mcp_server_url).toBe(TEST_MCP_URL);
      expect(passedArgs.role).toBe('finding_validator');
      expect(mockAgentActions.findingValidatorWithOptions).toHaveBeenCalledTimes(1);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
