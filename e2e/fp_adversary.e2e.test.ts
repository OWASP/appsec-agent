/**
 * E2E (integration): `fp_adversary` path through `main()` with temp
 * fp-adversary JSON, no live LLM — AgentActions is mocked. Validates
 * file → parse → prompt → output wiring for parent-app v2.8.0 / sast-ai-app
 * full-repo Phase 2.5.
 *
 * Parity with `pr_adversary.e2e.test.ts` so the two adversary roles stay
 * symmetric (same dispatch, same empty-input fast-path, same output file
 * write).
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

const mockAgentActions = {
  fpAdversaryWithOptions: jest.fn().mockResolvedValue(
    JSON.stringify({
      fp_adversary_report: {
        verdicts: [
          {
            fingerprint: 'fp-e2e-1',
            verdict: 'dismiss',
            confidence: 0.92,
            rationale: 'ORM mitigates; no concrete failure path observed.',
            cost_usd_estimate: 0.001,
          },
        ],
      },
    }),
  ),
  prAdversaryWithOptions: jest.fn(),
  simpleQueryClaudeWithOptions: jest.fn(),
  codeReviewerWithOptions: jest.fn(),
  threatModelerAgentWithOptions: jest.fn(),
  diffReviewerWithOptions: jest.fn(),
  codeFixerWithOptions: jest.fn(),
  qaVerifierWithOptions: jest.fn(),
  findingValidatorWithOptions: jest.fn(),
  contextExtractorWithOptions: jest.fn(),
  learnedGuidanceSynthesizerWithOptions: jest.fn(),
};

(AgentActions as jest.MockedClass<typeof AgentActions>).mockImplementation(
  () => mockAgentActions as any,
);

describe('e2e fp_adversary (mocked LLM)', () => {
  let testDir: string;
  const confDict = {
    default: {
      fp_adversary: { options: {} },
    },
  };
  let exitMock: jest.Mock;
  const realExit = process.exit;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `appsec-fp-adversary-e2e-${Date.now()}`);
    fs.ensureDirSync(testDir);
    exitMock = jest.fn();
    process.exit = exitMock as any;
    mockAgentActions.fpAdversaryWithOptions.mockClear();
  });

  afterEach(() => {
    process.exit = realExit;
    if (testDir && fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
    for (const f of ['e2e_fp_adversary_out.json', 'fp_adversary_report.json']) {
      if (fs.existsSync(f)) {
        fs.removeSync(f);
      }
    }
  });

  it('writes verdict report from fp_adversary context through main', async () => {
    const ctx = path.join(testDir, 'fp_in.json');
    fs.writeFileSync(
      ctx,
      JSON.stringify({
        findings: [
          {
            fingerprint: 'fp-e2e-1',
            id: 'SEC-001',
            title: 'SQL injection',
            file: 'src/db.ts',
            description: 'concatenated input',
            recommendation: 'use parameterized queries',
            severity: 'HIGH',
            confidence: 'MEDIUM',
            cwe_id: 'CWE-89',
          },
        ],
        project_summary: 'A Next.js SaaS app',
        security_context: 'Prisma ORM with parameterized queries',
        deployment_context: 'Vercel, multi-tenant',
        developer_context: 'PHI handling rules apply to user_data table',
        similar_dismissed: [
          {
            fingerprint: 'fp-old',
            file: 'src/db.ts',
            cwe: 'CWE-89',
            dismissal_reason: 'Prisma parameterized query',
          },
        ],
        metadata: { project_name: 'e2e' },
      }),
      'utf-8',
    );
    const prevCwd = process.cwd();
    const outName = 'e2e_fp_adversary_out.json';
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'fp_adversary',
        environment: 'default',
        adversarial_context: ctx,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.fpAdversaryWithOptions).toHaveBeenCalled();
      const prompt = mockAgentActions.fpAdversaryWithOptions.mock
        .calls[0][0] as string;
      // The prompt must surface the structured posture inputs and the
      // similar_dismissed precedent block so the agent has the full
      // context the parent app expects to inject.
      expect(prompt).toContain('fp-e2e-1');
      expect(prompt).toContain('Project posture');
      expect(prompt).toContain('Prisma ORM with parameterized queries');
      expect(prompt).toContain('Similar prior dismissals');
      expect(prompt).toContain('fp-old');

      const out = path.join(testDir, outName);
      expect(fs.existsSync(out)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'));
      expect(parsed.fp_adversary_report).toBeDefined();
      expect(parsed.fp_adversary_report.verdicts).toHaveLength(1);
      expect(parsed.fp_adversary_report.verdicts[0].fingerprint).toBe(
        'fp-e2e-1',
      );
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('writes empty fp_adversary report when no candidate findings', async () => {
    const ctx = path.join(testDir, 'fp_empty.json');
    fs.writeFileSync(ctx, JSON.stringify({ findings: [] }), 'utf-8');
    const prevCwd = process.cwd();
    const outName = 'e2e_fp_adversary_empty.json';
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'fp_adversary',
        environment: 'default',
        adversarial_context: ctx,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.fpAdversaryWithOptions).not.toHaveBeenCalled();
      const out = path.join(testDir, outName);
      expect(fs.existsSync(out)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'));
      expect(parsed.fp_adversary_report.verdicts).toEqual([]);
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });

  it('exits 1 when --adversarial-context is missing', async () => {
    // Override exitMock with throwing exit so we can assert the early-exit
    // branch fires before main() tries to dereference an undefined context.
    const throwingExit = jest.fn((code?: number) => {
      throw new Error(`__EXIT_${code}__`);
    });
    process.exit = throwingExit as any;
    await expect(
      main(confDict as any, {
        role: 'fp_adversary',
        environment: 'default',
        output_format: 'json',
      } as any),
    ).rejects.toThrow('__EXIT_1__');
    expect(throwingExit).toHaveBeenCalledWith(1);
  });
});
