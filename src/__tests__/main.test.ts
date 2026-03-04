/**
 * Tests for main function
 */

import { main } from '../main';
import { AgentActions, AgentArgs } from '../agent_actions';
import { copyProjectSrcDir, validateInputFilePath } from '../utils';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock dependencies
jest.mock('../agent_actions', () => ({
  AgentActions: jest.fn(),
  AgentArgs: {}
}));
jest.mock('../utils', () => ({
  ...jest.requireActual('../utils'),
  copyProjectSrcDir: jest.fn()
}));

// Mock readline
const mockQuestion = jest.fn();
const mockClose = jest.fn();
const mockReadlineInterface = {
  question: mockQuestion,
  close: mockClose
};
jest.mock('readline', () => ({
  createInterface: jest.fn(() => mockReadlineInterface)
}));

describe('main', () => {
  let mockConfDict: any;
  let mockAgentActions: jest.Mocked<AgentActions>;
  let testDir: string;
  let exitMock: jest.Mock;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    testDir = path.join(os.tmpdir(), `appsec-agent-main-test-${Date.now()}`);
    fs.ensureDirSync(testDir);

    mockConfDict = {
      default: {
        simple_query_agent: {},
        code_reviewer: {},
        threat_modeler: {}
      }
    };

    mockAgentActions = {
      simpleQueryClaudeWithOptions: jest.fn().mockResolvedValue(''),
      codeReviewerWithOptions: jest.fn().mockResolvedValue(''),
      threatModelerAgentWithOptions: jest.fn().mockResolvedValue(''),
      diffReviewerWithOptions: jest.fn().mockResolvedValue(''),
      codeFixerWithOptions: jest.fn().mockResolvedValue(''),
      qaVerifierWithOptions: jest.fn().mockResolvedValue('')
    } as any;

    (AgentActions as jest.MockedClass<typeof AgentActions>).mockImplementation(() => mockAgentActions);

    // Mock process.exit to prevent actual exit in tests
    originalExit = process.exit;
    exitMock = jest.fn();
    process.exit = exitMock as unknown as typeof process.exit;

    mockQuestion.mockReset();
    mockClose.mockReset();
  });

  afterEach(() => {
    process.exit = originalExit;
    jest.clearAllMocks();
    if (fs.existsSync(testDir)) {
      fs.removeSync(testDir);
    }
  });

  // Helper to mock readline responses
  const mockReadlineResponses = (...responses: string[]) => {
    let callCount = 0;
    mockQuestion.mockImplementation((_query: string, callback: (answer: string) => void) => {
      callback(responses[callCount++] || '/end');
    });
  };

  // Helper to create source and tmp directories
  const setupSourceDirs = () => {
    const sourceDir = path.join(testDir, 'source');
    const tmpDir = path.join(testDir, '.source');
    fs.ensureDirSync(sourceDir);
    (copyProjectSrcDir as jest.Mock).mockReturnValue(tmpDir);
    return { sourceDir, tmpDir };
  };

  describe('simple_query_agent', () => {
    it('should run simple query agent and exit on /end', async () => {
      mockReadlineResponses('test query', '/end');

      await main(mockConfDict, { role: 'simple_query_agent', environment: 'default' });

      expect(mockAgentActions.simpleQueryClaudeWithOptions).toHaveBeenCalledWith('test query', null);
      expect(mockClose).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should skip empty prompts and continue', async () => {
      mockReadlineResponses('   ', 'test query', '/end');

      await main(mockConfDict, { role: 'simple_query_agent', environment: 'default' });

      expect(mockAgentActions.simpleQueryClaudeWithOptions).toHaveBeenCalledTimes(1);
      expect(mockAgentActions.simpleQueryClaudeWithOptions).toHaveBeenCalledWith('test query', null);
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should handle case-insensitive /end command', async () => {
      mockReadlineResponses('/END');

      await main(mockConfDict, { role: 'simple_query_agent', environment: 'default' });

      expect(mockAgentActions.simpleQueryClaudeWithOptions).not.toHaveBeenCalled();
      expect(mockClose).toHaveBeenCalled();
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should run simple query agent with src_dir', async () => {
      const { sourceDir, tmpDir } = setupSourceDirs();
      mockReadlineResponses('test query', '/end');

      await main(mockConfDict, { role: 'simple_query_agent', environment: 'default', src_dir: sourceDir });

      expect(copyProjectSrcDir).toHaveBeenCalled();
      expect(mockAgentActions.simpleQueryClaudeWithOptions).toHaveBeenCalledWith('test query', tmpDir);
      expect(exitMock).toHaveBeenCalledWith(0);
    });
  });

  describe('code_reviewer', () => {
    const codeReviewerArgs: AgentArgs = {
      role: 'code_reviewer',
      environment: 'default',
      output_file: 'report.md',
      output_format: 'markdown'
    };

    it('should run code review agent without src_dir', async () => {
      await main(mockConfDict, codeReviewerArgs);

      expect(mockAgentActions.codeReviewerWithOptions).toHaveBeenCalled();
      const callArg = mockAgentActions.codeReviewerWithOptions.mock.calls[0][0];
      expect(callArg).toContain('current working directory');
      expect(callArg).toContain('report.md');
      expect(callArg).toContain('markdown');
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should run code review agent with src_dir', async () => {
      const { sourceDir, tmpDir } = setupSourceDirs();

      await main(mockConfDict, { ...codeReviewerArgs, src_dir: sourceDir });

      expect(copyProjectSrcDir).toHaveBeenCalled();
      const callArg = mockAgentActions.codeReviewerWithOptions.mock.calls[0][0];
      expect(callArg).toContain(tmpDir);
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    describe('with diff_context', () => {
      let diffContextFile: string;
      const validDiffContext = {
        prNumber: 42,
        baseBranch: 'main',
        headBranch: 'feature/test',
        headSha: 'abc123def456',
        owner: 'test-owner',
        repo: 'test-repo',
        files: [{
          filePath: 'src/test.ts',
          language: 'typescript',
          fileType: 'modified',
          hunks: [{
            startLine: 10,
            endLine: 20,
            changedCode: '+const x = 1;'
          }]
        }],
        totalFilesChanged: 1,
        totalLinesAdded: 1,
        totalLinesRemoved: 0
      };

      beforeEach(() => {
        diffContextFile = path.join(testDir, 'diff-context.json');
      });

      it('should run diff reviewer when diff_context is provided', async () => {
        fs.writeFileSync(diffContextFile, JSON.stringify(validDiffContext));

        await main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: diffContextFile
        });

        expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalled();
        expect(mockAgentActions.codeReviewerWithOptions).not.toHaveBeenCalled();
        expect(exitMock).toHaveBeenCalledWith(0);
      });

      it('should include PR info in diff reviewer prompt', async () => {
        fs.writeFileSync(diffContextFile, JSON.stringify(validDiffContext));

        await main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: diffContextFile
        });

        const callArg = mockAgentActions.diffReviewerWithOptions.mock.calls[0][0];
        expect(callArg).toContain('PR #42');
        expect(callArg).toContain('feature/test');
        expect(callArg).toContain('test-owner/test-repo');
      });

      it('should exit with error for invalid diff context format', async () => {
        const invalidContext = { invalid: 'data' };
        fs.writeFileSync(diffContextFile, JSON.stringify(invalidContext));
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        // Make exitMock throw to simulate process.exit stopping execution
        exitMock.mockImplementationOnce((code?: number) => {
          throw new Error(`process.exit(${code})`);
        });

        await expect(main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: diffContextFile
        })).rejects.toThrow('process.exit(1)');

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid diff context format'));
        consoleErrorSpy.mockRestore();
      });

      it('should exit with error for non-existent diff context file', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        exitMock.mockImplementationOnce((code?: number) => {
          throw new Error(`process.exit(${code})`);
        });

        await expect(main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: path.join(testDir, 'nonexistent.json')
        })).rejects.toThrow('process.exit(1)');

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'));
        consoleErrorSpy.mockRestore();
      });

      it('should exit with error for invalid JSON in diff context file', async () => {
        fs.writeFileSync(diffContextFile, 'not valid json');
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        exitMock.mockImplementationOnce((code?: number) => {
          throw new Error(`process.exit(${code})`);
        });

        await expect(main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: diffContextFile
        })).rejects.toThrow('process.exit(1)');

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to read diff context file'));
        consoleErrorSpy.mockRestore();
      });

      it('should exit with error for path traversal in diff context path', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
        
        exitMock.mockImplementationOnce((code?: number) => {
          throw new Error(`process.exit(${code})`);
        });

        await expect(main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: '../../../etc/passwd'
        })).rejects.toThrow('process.exit(1)');

        expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid diff context file path'));
        consoleErrorSpy.mockRestore();
      });

      it('should pass src_dir to diff reviewer when both are provided', async () => {
        const { sourceDir, tmpDir } = setupSourceDirs();
        fs.writeFileSync(diffContextFile, JSON.stringify(validDiffContext));

        await main(mockConfDict, {
          ...codeReviewerArgs,
          diff_context: diffContextFile,
          src_dir: sourceDir
        });

        expect(copyProjectSrcDir).toHaveBeenCalled();
        expect(mockAgentActions.diffReviewerWithOptions).toHaveBeenCalledWith(
          expect.any(String),
          tmpDir
        );
      });
    });
  });

  describe('threat_modeler', () => {
    const threatModelerArgs: AgentArgs = {
      role: 'threat_modeler',
      environment: 'default',
      output_file: 'report.md',
      output_format: 'markdown'
    };

    it('should run threat modeler without src_dir', async () => {
      await main(mockConfDict, threatModelerArgs);

      expect(mockAgentActions.threatModelerAgentWithOptions).toHaveBeenCalled();
      const callArg = mockAgentActions.threatModelerAgentWithOptions.mock.calls[0][0];
      expect(callArg).toContain('current working directory');
      expect(callArg).toContain('Data Flow Diagram');
      expect(callArg).toContain('STRIDE');
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should run threat modeler with src_dir and clean up', async () => {
      const { sourceDir, tmpDir } = setupSourceDirs();
      fs.ensureDirSync(tmpDir);

      await main(mockConfDict, { ...threatModelerArgs, src_dir: sourceDir });

      expect(copyProjectSrcDir).toHaveBeenCalled();
      const callArg = mockAgentActions.threatModelerAgentWithOptions.mock.calls[0][0];
      expect(callArg).toContain(tmpDir);
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should include deployment context in prompt when context is provided', async () => {
      await main(mockConfDict, {
        ...threatModelerArgs,
        context: 'AWS Lambda in prod VPC; PCI-DSS compliant'
      });

      const callArg = mockAgentActions.threatModelerAgentWithOptions.mock.calls[0][0];
      expect(callArg).toContain('DEPLOYMENT & ENVIRONMENT CONTEXT');
      expect(callArg).toContain('AWS Lambda in prod VPC; PCI-DSS compliant');
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should include deployment context in JSON prompt when context is provided', async () => {
      await main(mockConfDict, {
        ...threatModelerArgs,
        output_format: 'json',
        context: 'Kubernetes on GKE; SOC2 Type II'
      });

      const callArg = mockAgentActions.threatModelerAgentWithOptions.mock.calls[0][0];
      expect(callArg).toContain('DEPLOYMENT & ENVIRONMENT CONTEXT');
      expect(callArg).toContain('Kubernetes on GKE; SOC2 Type II');
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should not include deployment context when context is not provided', async () => {
      await main(mockConfDict, threatModelerArgs);

      const callArg = mockAgentActions.threatModelerAgentWithOptions.mock.calls[0][0];
      expect(callArg).not.toContain('DEPLOYMENT & ENVIRONMENT CONTEXT');
    });

    it('should clean up temporary directory after threat modeler', async () => {
      const { sourceDir, tmpDir } = setupSourceDirs();
      fs.ensureDirSync(tmpDir);
      expect(fs.existsSync(tmpDir)).toBe(true);

      await main(mockConfDict, { ...threatModelerArgs, src_dir: sourceDir });

      expect(exitMock).toHaveBeenCalledWith(0);
    });
  });

  describe('code_fixer', () => {
    let fixContextPath: string;
    const sampleFixContext = {
      finding: {
        title: 'SQL Injection',
        severity: 'HIGH',
        cwe: 'CWE-89',
        owasp: 'A03:2021',
        file: 'src/db.ts',
        line: 42,
        description: 'User input directly concatenated into SQL query',
        recommendation: 'Use parameterized queries',
        category: 'Injection'
      },
      code_context: {
        language: 'typescript',
        imports: 'import { db } from "./database";',
        vulnerable_section: 'const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);',
        vulnerable_section_start: 40,
        vulnerable_section_end: 44,
        full_file_with_line_numbers: '  40| const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);',
        indentation_guidance: 'Use 2-space indentation'
      },
      security_guidance: 'Use parameterized queries to prevent SQL injection.',
      learned_examples: '',
      negative_examples: '',
      custom_instructions: '',
      chain_of_thought: false
    };

    beforeEach(() => {
      fixContextPath = path.join(testDir, 'fix_context.json');
      fs.writeFileSync(fixContextPath, JSON.stringify(sampleFixContext), 'utf-8');
    });

    it('should exit with error when --fix-context is missing', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      exitMock.mockImplementationOnce((code?: number) => {
        throw new Error(`process.exit(${code})`);
      });

      await expect(main(mockConfDict, { role: 'code_fixer', environment: 'default' }))
        .rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--fix-context is required'));
      consoleErrorSpy.mockRestore();
    });

    it('should run code fixer with fix context', async () => {
      const structuredFix = JSON.stringify({
        fixed_code: 'const result = db.query("SELECT * FROM users WHERE id = ?", [userId]);',
        start_line: 42,
        end_line: 42,
        explanation: 'Use parameterized query',
        confidence: 'high',
        breaking_changes: false
      });
      mockAgentActions.codeFixerWithOptions.mockResolvedValue(structuredFix);

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json'
      });

      expect(mockAgentActions.codeFixerWithOptions).toHaveBeenCalledWith(
        expect.stringContaining('SQL Injection'),
        null
      );
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should include finding details in prompt', async () => {
      mockAgentActions.codeFixerWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.codeFixerWithOptions.mock.calls[0][0];
      expect(prompt).toContain('CWE-89');
      expect(prompt).toContain('src/db.ts');
      expect(prompt).toContain('Line**: 42');
      expect(prompt).toContain('parameterized queries');
    });

    it('should run code fixer with src_dir', async () => {
      const { sourceDir, tmpDir } = setupSourceDirs();
      mockAgentActions.codeFixerWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json',
        src_dir: sourceDir
      });

      expect(copyProjectSrcDir).toHaveBeenCalled();
      expect(mockAgentActions.codeFixerWithOptions).toHaveBeenCalledWith(
        expect.any(String),
        tmpDir
      );
    });

    it('should include deployment context in prompt when present', async () => {
      const ctxWithDeployment = {
        ...sampleFixContext,
        deployment_context: 'AWS Lambda in prod VPC; handles PII data'
      };
      fs.writeFileSync(fixContextPath, JSON.stringify(ctxWithDeployment), 'utf-8');
      mockAgentActions.codeFixerWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.codeFixerWithOptions.mock.calls[0][0];
      expect(prompt).toContain('Deployment & Environment Context');
      expect(prompt).toContain('AWS Lambda in prod VPC; handles PII data');
    });

    it('should not include deployment context section when not present', async () => {
      mockAgentActions.codeFixerWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.codeFixerWithOptions.mock.calls[0][0];
      expect(prompt).not.toContain('Deployment & Environment Context');
    });

    it('should include retry context when previous_fix_code is present', async () => {
      const retryContext = {
        ...sampleFixContext,
        previous_fix_code: 'bad fix code',
        validation_errors: ['Syntax error at line 1', 'Missing semicolon']
      };
      fs.writeFileSync(fixContextPath, JSON.stringify(retryContext), 'utf-8');
      mockAgentActions.codeFixerWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'code_fixer',
        environment: 'default',
        fix_context: fixContextPath,
        output_file: 'fix_output.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.codeFixerWithOptions.mock.calls[0][0];
      expect(prompt).toContain('Previous Fix Failed Validation');
      expect(prompt).toContain('bad fix code');
      expect(prompt).toContain('Syntax error at line 1');
    });
  });

  describe('qa_verifier', () => {
    let qaContextPath: string;
    const sampleQaContext = {
      pr_url: 'https://github.com/owner/repo/pull/42',
      test_command: 'npm test',
      test_framework: 'jest',
      setup_commands: 'npm ci',
      timeout_seconds: 120,
      block_on_failure: true,
    };

    beforeEach(() => {
      qaContextPath = path.join(testDir, 'qa_context.json');
      fs.writeFileSync(qaContextPath, JSON.stringify(sampleQaContext), 'utf-8');
    });

    it('should exit with error when --qa-context is missing', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      exitMock.mockImplementationOnce((code?: number) => {
        throw new Error(`process.exit(${code})`);
      });

      await expect(main(mockConfDict, { role: 'qa_verifier', environment: 'default' }))
        .rejects.toThrow('process.exit(1)');

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('--qa-context is required'));
      consoleErrorSpy.mockRestore();
    });

    it('should run qa verifier with context', async () => {
      const structuredVerdict = JSON.stringify({
        pass: true,
        test_exit_code: 0,
        failures: [],
        logs: 'All tests passed',
      });
      mockAgentActions.qaVerifierWithOptions.mockResolvedValue(structuredVerdict);

      await main(mockConfDict, {
        role: 'qa_verifier',
        environment: 'default',
        qa_context: qaContextPath,
        output_file: 'qa_verdict.json',
        output_format: 'json'
      });

      expect(mockAgentActions.qaVerifierWithOptions).toHaveBeenCalledWith(
        expect.stringContaining('QA Verification Task'),
        null
      );
      expect(exitMock).toHaveBeenCalledWith(0);
    });

    it('should include deployment context in prompt when present', async () => {
      const ctxWithDeployment = {
        ...sampleQaContext,
        deployment_context: 'Production Kubernetes cluster with Istio mesh',
      };
      fs.writeFileSync(qaContextPath, JSON.stringify(ctxWithDeployment), 'utf-8');
      mockAgentActions.qaVerifierWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'qa_verifier',
        environment: 'default',
        qa_context: qaContextPath,
        output_file: 'qa_verdict.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.qaVerifierWithOptions.mock.calls[0][0];
      expect(prompt).toContain('Deployment & Environment Context');
      expect(prompt).toContain('Production Kubernetes cluster with Istio mesh');
    });

    it('should include test configuration in prompt', async () => {
      mockAgentActions.qaVerifierWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'qa_verifier',
        environment: 'default',
        qa_context: qaContextPath,
        output_file: 'qa_verdict.json',
        output_format: 'json'
      });

      const prompt = mockAgentActions.qaVerifierWithOptions.mock.calls[0][0];
      expect(prompt).toContain('npm test');
      expect(prompt).toContain('jest');
      expect(prompt).toContain('npm ci');
      expect(prompt).toContain('120 seconds');
    });

    it('should run qa verifier with src_dir', async () => {
      const { sourceDir } = setupSourceDirs();
      mockAgentActions.qaVerifierWithOptions.mockResolvedValue('{}');

      await main(mockConfDict, {
        role: 'qa_verifier',
        environment: 'default',
        qa_context: qaContextPath,
        output_file: 'qa_verdict.json',
        output_format: 'json',
        src_dir: sourceDir
      });

      expect(copyProjectSrcDir).toHaveBeenCalled();
      expect(mockAgentActions.qaVerifierWithOptions).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String)
      );
    });
  });

  describe('invalid role', () => {
    it('should exit with error for invalid role', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await main(mockConfDict, { role: 'invalid_role', environment: 'default' });

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid appsec AI agent role'));
      expect(exitMock).toHaveBeenCalledWith(1);

      consoleErrorSpy.mockRestore();
    });
  });
});

