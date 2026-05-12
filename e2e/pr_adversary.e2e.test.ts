/**
 * E2E (integration): `pr_adversary` path through `main()` with temp adversarial JSON,
 * no live LLM — AgentActions is mocked. Validates file → parse → prompt → output wiring
 * for parent-app v5.3.0 / quality plan §8.7.
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
  prAdversaryWithOptions: jest.fn().mockResolvedValue(
    JSON.stringify({
      security_review_report: {
        metadata: { project_name: 'e2e', total_issues_found: 0, scan_type: 'adversarial_pass' },
        executive_summary: { critical: 0, high: 0, medium: 0, low: 0, info: 0, overview: 'ok' },
        findings: [],
      },
    }),
  ),
  simpleQueryClaudeWithOptions: jest.fn(),
  codeReviewerWithOptions: jest.fn(),
  threatModelerAgentWithOptions: jest.fn(),
  diffReviewerWithOptions: jest.fn(),
  codeFixerWithOptions: jest.fn(),
  qaVerifierWithOptions: jest.fn(),
  findingValidatorWithOptions: jest.fn(),
  contextExtractorWithOptions: jest.fn(),
};

(AgentActions as jest.MockedClass<typeof AgentActions>).mockImplementation(() => mockAgentActions as any);

describe('e2e pr_adversary (mocked LLM)', () => {
  let testDir: string;
  const confDict = {
    default: {
      pr_adversary: { options: {} },
    },
  };
  let exitMock: jest.Mock;
  const realExit = process.exit;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `appsec-pr-adversary-e2e-${Date.now()}`);
    fs.ensureDirSync(testDir);
    exitMock = jest.fn();
    process.exit = exitMock as any;
  });

  afterEach(() => {
    process.exit = realExit;
    if (testDir && fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
    for (const f of ['e2e_pr_adversary_out.json']) {
      if (fs.existsSync(f)) {
        fs.removeSync(f);
      }
    }
  });

  it('writes filtered report from adversarial context through main', async () => {
    const adv = path.join(testDir, 'adv_in.json');
    fs.writeFileSync(
      adv,
      JSON.stringify({
        findings: [
          {
            id: 'E2E-1',
            title: 'Test',
            file: 'a.ts',
            description: 'desc',
            recommendation: 'fix',
            severity: 'MEDIUM',
            confidence: 'HIGH',
          },
        ],
      }),
      'utf-8',
    );
    const prevCwd = process.cwd();
    const outName = 'e2e_pr_adversary_out.json';
    try {
      process.chdir(testDir);

      await main(confDict as any, {
        role: 'pr_adversary',
        environment: 'default',
        adversarial_context: adv,
        output_file: outName,
        output_format: 'json',
      } as any);

      expect(mockAgentActions.prAdversaryWithOptions).toHaveBeenCalled();
      const prompt = mockAgentActions.prAdversaryWithOptions.mock.calls[0][0] as string;
      expect(prompt).toContain('E2E-1');
      const out = path.join(testDir, outName);
      expect(fs.existsSync(out)).toBe(true);
      const parsed = JSON.parse(fs.readFileSync(out, 'utf-8'));
      expect(parsed.security_review_report).toBeDefined();
      expect(exitMock).toHaveBeenCalledWith(0);
    } finally {
      process.chdir(prevCwd);
    }
  });
});
