/**
 * Tests for AgentActions class
 */

import { AgentActions, AgentArgs } from '../agent_actions';
import { AgentOptions } from '../agent_options';
import { ConfigDict } from '../utils';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Mock the Claude SDK (used by ClaudeProvider)
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));

describe('AgentActions', () => {
  let mockConfDict: ConfigDict;
  let mockArgs: AgentArgs;
  const environment = 'default';

  beforeEach(() => {
    mockConfDict = {
      default: {
        simple_query_agent: {
          options: {
            system_prompt: 'Test prompt',
            max_turns: 1
          }
        },
        code_reviewer: {
          options: {
            system_prompt: 'Code review prompt'
          }
        },
        threat_modeler: {
          options: {
            system_prompt: 'Threat modeler prompt'
          }
        }
      }
    };

    mockArgs = {
      role: 'simple_query_agent',
      environment: 'default',
      output_file: 'test.md',
      output_format: 'markdown',
      verbose: false
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with config dict, environment, and args', () => {
      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      expect(agentActions).toBeInstanceOf(AgentActions);
    });
  });

  describe('simpleQueryClaudeWithOptions', () => {
    it('should process query and return empty string', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Test response'
              }
            ]
          }
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      
      const result = await agentActions.simpleQueryClaudeWithOptions('Test prompt');

      expect(query).toHaveBeenCalled();
      expect(result).toBe('');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle empty message content', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: []
          }
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      const result = await agentActions.simpleQueryClaudeWithOptions('Test prompt');

      expect(result).toBe('');
    });

    it('should handle result messages with cost', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Test response'
              }
            ]
          }
        },
        {
          type: 'result',
          total_cost_usd: 0.001
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      
      const result = await agentActions.simpleQueryClaudeWithOptions('Test prompt');

      expect(result).toBe('');
      const costLog = consoleSpy.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Cost')
      );
      expect(costLog).toBeTruthy();
      
      consoleSpy.mockRestore();
    });

    it('should handle errors during query', async () => {
      const error = new Error('Test error');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw error;
        }
      });

      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      
      await expect(agentActions.simpleQueryClaudeWithOptions('Test prompt')).rejects.toThrow('Test error');
    });
  });

  describe('codeReviewerWithOptions', () => {
    it('should process code review query', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Code review response'
              }
            ]
          }
        },
        {
          type: 'result',
          total_cost_usd: 0.001
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer'
      });
      
      const result = await agentActions.codeReviewerWithOptions('Review code');

      expect(query).toHaveBeenCalled();
      expect(result).toBe('');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should display cost when available', async () => {
      const mockMessages = [
        {
          type: 'result',
          total_cost_usd: 0.0025
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer'
      });
      
      await agentActions.codeReviewerWithOptions('Review code');

      const costLog = consoleSpy.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Cost')
      );
      expect(costLog).toBeTruthy();
      
      consoleSpy.mockRestore();
    });

    it('should not display cost when zero', async () => {
      const mockMessages = [
        {
          type: 'result',
          total_cost_usd: 0
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer'
      });
      
      await agentActions.codeReviewerWithOptions('Review code');

      const costLog = consoleSpy.mock.calls.find(call => 
        typeof call[0] === 'string' && call[0].includes('Cost')
      );
      expect(costLog).toBeFalsy();
      
      consoleSpy.mockRestore();
    });

    it('should handle errors during code review', async () => {
      const error = new Error('Test error');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw error;
        }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer'
      });
      
      await expect(agentActions.codeReviewerWithOptions('Review code')).rejects.toThrow('Test error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during code review:', error);
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('threatModelerAgentWithOptions', () => {
    it('should process threat modeling query', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Threat model response'
              }
            ]
          }
        },
        {
          type: 'result',
          total_cost_usd: 0.001
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'threat_modeler'
      });
      
      const result = await agentActions.threatModelerAgentWithOptions('Threat model');

      expect(query).toHaveBeenCalled();
      expect(result).toBe('');
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle multiple message types', async () => {
      const mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Response 1'
              }
            ]
          }
        },
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'text',
                text: 'Response 2'
              }
            ]
          }
        },
        {
          type: 'result',
          total_cost_usd: 0.001
        }
      ];

      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          for (const msg of mockMessages) {
            yield msg;
          }
        }
      });

      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'threat_modeler'
      });
      
      const result = await agentActions.threatModelerAgentWithOptions('Threat model');

      expect(result).toBe('');
    });

    it('should handle errors during threat modeling', async () => {
      const error = new Error('Test error');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw error;
        }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'threat_modeler'
      });
      
      await expect(agentActions.threatModelerAgentWithOptions('Threat model')).rejects.toThrow('Test error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during threat modeling:', error);
      
      consoleErrorSpy.mockRestore();
    });
  });

  // -------------------------------------------------------------------------
  // Helpers for building mock async iterables of SDK messages
  // -------------------------------------------------------------------------
  const mockQueryWith = (messages: any[]) => {
    (query as jest.Mock).mockReturnValue({
      [Symbol.asyncIterator]: async function* () {
        for (const msg of messages) {
          yield msg;
        }
      }
    });
  };

  describe('codeFixerWithOptions', () => {
    const codeFixerArgs: AgentArgs = {
      role: 'code_fixer',
      environment: 'default',
      output_format: 'json',
      verbose: false
    };

    it('should return structured JSON when agent provides structured_output', async () => {
      const fixOutput = { security_fix: { fix_applied: true } };
      mockQueryWith([
        {
          type: 'result',
          structured_output: fixOutput,
          total_cost_usd: 0.005
        }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, codeFixerArgs);

      const result = await agentActions.codeFixerWithOptions('Fix code', '/tmp/src');

      expect(query).toHaveBeenCalled();
      expect(JSON.parse(result)).toEqual(fixOutput);
      const costLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Cost')
      );
      expect(costLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should return empty string when no structured_output is present', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0 }
      ]);

      const agentActions = new AgentActions(mockConfDict, environment, codeFixerArgs);
      const result = await agentActions.codeFixerWithOptions('Fix code');
      expect(result).toBe('');
    });

    it('should print assistant text when verbose is true', async () => {
      mockQueryWith([
        {
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Working on fix...' }] }
        },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...codeFixerArgs,
        verbose: true
      });

      await agentActions.codeFixerWithOptions('Fix code');

      const verboseLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Working on fix')
      );
      expect(verboseLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should handle stream_event messages without crashing', async () => {
      mockQueryWith([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'x' } } },
        { type: 'result' }
      ]);

      const agentActions = new AgentActions(mockConfDict, environment, codeFixerArgs);
      const result = await agentActions.codeFixerWithOptions('Fix code');
      expect(result).toBe('');
    });

    it('should propagate errors from ClaudeProvider', async () => {
      const error = new Error('Fix failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw error;
        }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, codeFixerArgs);

      await expect(agentActions.codeFixerWithOptions('Fix code')).rejects.toThrow('Fix failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during code fix generation:', error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('qaVerifierWithOptions', () => {
    const qaArgs: AgentArgs = {
      role: 'qa_verifier',
      environment: 'default',
      output_format: 'json',
      verbose: false
    };

    it('should return structured JSON when agent provides structured_output', async () => {
      const qaOutput = { qa_verdict: { verdict: 'PASS' } };
      mockQueryWith([
        { type: 'result', structured_output: qaOutput, total_cost_usd: 0.002 }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, qaArgs);

      const result = await agentActions.qaVerifierWithOptions('Verify QA', '/tmp/src');
      expect(JSON.parse(result)).toEqual(qaOutput);
      consoleSpy.mockRestore();
    });

    it('should return empty string when no structured_output', async () => {
      mockQueryWith([{ type: 'result' }]);
      const agentActions = new AgentActions(mockConfDict, environment, qaArgs);
      const result = await agentActions.qaVerifierWithOptions('Verify QA');
      expect(result).toBe('');
    });

    it('should print assistant text when verbose', async () => {
      mockQueryWith([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Running tests' }] } },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, { ...qaArgs, verbose: true });
      await agentActions.qaVerifierWithOptions('Verify QA');

      const verboseLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Running tests')
      );
      expect(verboseLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should propagate errors', async () => {
      const error = new Error('QA failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () { throw error; }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, qaArgs);

      await expect(agentActions.qaVerifierWithOptions('Verify QA')).rejects.toThrow('QA failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during QA verification:', error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('contextExtractorWithOptions', () => {
    const ctxArgs: AgentArgs = {
      role: 'context_extractor',
      environment: 'default',
      output_format: 'json',
      verbose: false
    };

    it('should return structured JSON when agent provides structured_output', async () => {
      const ctxOutput = {
        project_summary: 'Test project',
        security_context: 'bcrypt',
        deployment_context: 'GitHub Actions',
        developer_context: '',
        suggested_exclusions: ''
      };
      mockQueryWith([
        { type: 'result', structured_output: ctxOutput, total_cost_usd: 0.003 }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, ctxArgs);

      const result = await agentActions.contextExtractorWithOptions('Extract');
      expect(JSON.parse(result)).toEqual(ctxOutput);
      consoleSpy.mockRestore();
    });

    it('should return empty string when no structured_output', async () => {
      mockQueryWith([{ type: 'result' }]);
      const agentActions = new AgentActions(mockConfDict, environment, ctxArgs);
      const result = await agentActions.contextExtractorWithOptions('Extract');
      expect(result).toBe('');
    });

    it('should print assistant text when verbose', async () => {
      mockQueryWith([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Analyzing repo' }] } },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, { ...ctxArgs, verbose: true });
      await agentActions.contextExtractorWithOptions('Extract');

      const verboseLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Analyzing repo')
      );
      expect(verboseLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should propagate errors', async () => {
      const error = new Error('Extract failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () { throw error; }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, ctxArgs);

      await expect(agentActions.contextExtractorWithOptions('Extract')).rejects.toThrow('Extract failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during context extraction:', error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('findingValidatorWithOptions', () => {
    const fvArgs: AgentArgs = {
      role: 'finding_validator',
      environment: 'default',
      output_format: 'json',
      verbose: false
    };

    it('should return structured JSON when agent provides structured_output', async () => {
      const fvOutput = { finding_validation: { still_present: false } };
      mockQueryWith([
        { type: 'result', structured_output: fvOutput, total_cost_usd: 0.001 }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fvArgs);

      const result = await agentActions.findingValidatorWithOptions('Validate', '/tmp/src');
      expect(JSON.parse(result)).toEqual(fvOutput);
      consoleSpy.mockRestore();
    });

    it('should return empty string when no structured_output', async () => {
      mockQueryWith([{ type: 'result' }]);
      const agentActions = new AgentActions(mockConfDict, environment, fvArgs);
      const result = await agentActions.findingValidatorWithOptions('Validate');
      expect(result).toBe('');
    });

    it('should print assistant text when verbose', async () => {
      mockQueryWith([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Checking finding' }] } },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, { ...fvArgs, verbose: true });
      await agentActions.findingValidatorWithOptions('Validate');

      const verboseLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Checking finding')
      );
      expect(verboseLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should propagate errors', async () => {
      const error = new Error('Validate failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () { throw error; }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fvArgs);

      await expect(agentActions.findingValidatorWithOptions('Validate')).rejects.toThrow('Validate failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during finding validation:', error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('fpAdversaryWithOptions (v2.8.0 / parent app full-repo Phase 2.5)', () => {
    const fpArgs: AgentArgs = {
      role: 'fp_adversary',
      environment: 'default',
      output_format: 'json',
      verbose: false,
    };

    it('should return structured verdict JSON when agent provides structured_output', async () => {
      const verdictOutput = {
        fp_adversary_report: {
          verdicts: [
            {
              fingerprint: 'fp-1',
              verdict: 'dismiss',
              confidence: 0.92,
              rationale: 'Prisma parameterized query mitigates.',
            },
          ],
        },
      };
      mockQueryWith([
        { type: 'result', structured_output: verdictOutput, total_cost_usd: 0.005 },
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);

      const result = await agentActions.fpAdversaryWithOptions('Verify', '/tmp/src');
      const parsed = JSON.parse(result);
      expect(parsed.fp_adversary_report.verdicts).toHaveLength(1);
      expect(parsed.fp_adversary_report.verdicts[0].fingerprint).toBe('fp-1');
      consoleSpy.mockRestore();
    });

    it('threads SDK total_cost_usd onto every verdict as cost_usd_estimate', async () => {
      const verdictOutput = {
        fp_adversary_report: {
          verdicts: [
            { fingerprint: 'fp-1', verdict: 'dismiss', confidence: 0.9, rationale: 'r1' },
            { fingerprint: 'fp-2', verdict: 'confirm', confidence: 0.8, rationale: 'r2' },
          ],
        },
      };
      mockQueryWith([
        { type: 'result', structured_output: verdictOutput, total_cost_usd: 0.02 },
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);
      const result = await agentActions.fpAdversaryWithOptions('Verify');
      const parsed = JSON.parse(result);
      // Each verdict gets total_cost_usd / N (0.02 / 2 = 0.01).
      expect(parsed.fp_adversary_report.verdicts[0].cost_usd_estimate).toBeCloseTo(0.01, 6);
      expect(parsed.fp_adversary_report.verdicts[1].cost_usd_estimate).toBeCloseTo(0.01, 6);
      consoleSpy.mockRestore();
    });

    it('preserves existing per-verdict cost_usd_estimate when the SDK provided it', async () => {
      const verdictOutput = {
        fp_adversary_report: {
          verdicts: [
            {
              fingerprint: 'fp-1',
              verdict: 'dismiss',
              confidence: 0.9,
              rationale: 'r1',
              cost_usd_estimate: 0.003,
            },
          ],
        },
      };
      mockQueryWith([
        { type: 'result', structured_output: verdictOutput, total_cost_usd: 0.02 },
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);
      const result = await agentActions.fpAdversaryWithOptions('Verify');
      const parsed = JSON.parse(result);
      expect(parsed.fp_adversary_report.verdicts[0].cost_usd_estimate).toBe(0.003);
      consoleSpy.mockRestore();
    });

    it('returns the raw JSON when total_cost_usd is zero (cost-threading skipped)', async () => {
      const verdictOutput = {
        fp_adversary_report: {
          verdicts: [
            { fingerprint: 'fp-1', verdict: 'confirm', confidence: 0.7, rationale: 'r' },
          ],
        },
      };
      mockQueryWith([{ type: 'result', structured_output: verdictOutput }]);
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);
      const result = await agentActions.fpAdversaryWithOptions('Verify');
      const parsed = JSON.parse(result);
      expect(parsed.fp_adversary_report.verdicts[0].cost_usd_estimate).toBeUndefined();
    });

    it('returns empty string when no structured_output', async () => {
      mockQueryWith([{ type: 'result' }]);
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);
      const result = await agentActions.fpAdversaryWithOptions('Verify');
      expect(result).toBe('');
    });

    it('prints assistant text when verbose', async () => {
      mockQueryWith([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Analyzing fingerprint fp-1' }] } },
        { type: 'result' },
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...fpArgs,
        verbose: true,
      });
      await agentActions.fpAdversaryWithOptions('Verify');
      const verboseLog = consoleSpy.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('fp-1'),
      );
      expect(verboseLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('propagates errors and stops the cursor', async () => {
      const error = new Error('fp_adversary failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          throw error;
        },
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, fpArgs);
      await expect(agentActions.fpAdversaryWithOptions('Verify')).rejects.toThrow(
        'fp_adversary failed',
      );
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error during fp_adversary pass:',
        error,
      );
      consoleErrorSpy.mockRestore();
    });
  });

  describe('diffReviewerWithOptions', () => {
    const diffArgs: AgentArgs = {
      role: 'code_reviewer',
      environment: 'default',
      output_format: 'json',
      verbose: false
    };

    it('should return structured JSON when agent provides structured_output', async () => {
      const reviewOutput = { security_review_report: { findings: [] } };
      mockQueryWith([
        {
          type: 'result',
          structured_output: reviewOutput,
          total_cost_usd: 0.01,
          num_turns: 3,
          duration_ms: 5000,
          duration_api_ms: 4000
        }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);

      const result = await agentActions.diffReviewerWithOptions('Diff review');
      expect(JSON.parse(result)).toEqual(reviewOutput);
      const statsLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Agent Stats')
      );
      expect(statsLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should invoke onResult callback with cost', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0.05, structured_output: { x: 1 } }
      ]);

      const onResult = jest.fn();
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);

      await agentActions.diffReviewerWithOptions('Diff review', null, onResult);
      expect(onResult).toHaveBeenCalledWith({ total_cost_usd: 0.05 });
    });

    it('should generate fallback report when no structured_output but had successful run', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0.02 }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);

      const result = await agentActions.diffReviewerWithOptions('Diff review');
      const parsed = JSON.parse(result);
      expect(parsed.security_review_report).toBeDefined();
      expect(parsed.security_review_report.metadata.scan_type).toBe('PR Diff Review');
      expect(parsed.security_review_report.executive_summary.risk_rating).toBe('UNKNOWN');
      expect(parsed.security_review_report.findings).toEqual([]);

      const fallbackLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Fallback')
      );
      expect(fallbackLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should NOT generate fallback report for non-json output_format', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0.02 }
      ]);

      const agentActions = new AgentActions(mockConfDict, environment, {
        ...diffArgs,
        output_format: 'markdown'
      });

      const result = await agentActions.diffReviewerWithOptions('Diff review');
      expect(result).toBe('');
    });

    it('should NOT generate fallback report when there was no successful run', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0 }
      ]);

      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);
      const result = await agentActions.diffReviewerWithOptions('Diff review');
      expect(result).toBe('');
    });

    it('should warn when is_error is set but cost was incurred', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0.001, is_error: true, structured_output: { x: 1 } }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);

      await agentActions.diffReviewerWithOptions('Diff review');

      const warningLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Warning') && call[0].includes('is_error=true')
      );
      expect(warningLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should accumulate stream_event text deltas to stdout', async () => {
      mockQueryWith([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'streamed ' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'text' } } },
        { type: 'result', total_cost_usd: 0.001 }
      ]);

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);
      await agentActions.diffReviewerWithOptions('Diff review');

      const writes = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
      expect(writes).toContain('streamed ');
      expect(writes).toContain('text');
      stdoutSpy.mockRestore();
    });

    it('should print turn count when verbose', async () => {
      mockQueryWith([
        { type: 'assistant', message: { content: [{ type: 'text', text: 'Turn 1' }] } },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, { ...diffArgs, verbose: true });
      await agentActions.diffReviewerWithOptions('Diff review');

      const turnLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Turn 1')
      );
      expect(turnLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should log tool_progress messages when verbose', async () => {
      mockQueryWith([
        { type: 'tool_progress', tool_name: 'Read', elapsed_time_seconds: 1.5 },
        { type: 'result' }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, { ...diffArgs, verbose: true });
      await agentActions.diffReviewerWithOptions('Diff review');

      const progressLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Tool Progress') && call[0].includes('Read')
      );
      expect(progressLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should pass noTools flag through to RoleSpec', async () => {
      mockQueryWith([{ type: 'result' }]);
      const spy = jest.spyOn(AgentOptions.prototype, 'getDiffReviewerRoleSpec');

      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);
      await agentActions.diffReviewerWithOptions('Diff review', '/tmp/src', undefined, true);

      expect(spy).toHaveBeenCalledWith(
        'code_reviewer',
        '/tmp/src',
        'json',
        undefined,
        true,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      spy.mockRestore();
    });

    it('should propagate errors and stop cursor', async () => {
      const error = new Error('Diff failed');
      (query as jest.Mock).mockReturnValue({
        [Symbol.asyncIterator]: async function* () { throw error; }
      });

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, diffArgs);

      await expect(agentActions.diffReviewerWithOptions('Diff review')).rejects.toThrow('Diff failed');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during PR diff code review:', error);
      consoleErrorSpy.mockRestore();
    });
  });

  describe('codeReviewerWithOptions - extra coverage', () => {
    it('should generate fallback report when JSON output and no structured_output', async () => {
      mockQueryWith([{ type: 'result', total_cost_usd: 0.01 }]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer',
        output_format: 'json'
      });

      const result = await agentActions.codeReviewerWithOptions('Review');
      const parsed = JSON.parse(result);
      expect(parsed.security_review_report.metadata.scan_type).toBe('Full Code Review');
      expect(parsed.security_review_report.executive_summary.risk_rating).toBe('UNKNOWN');

      const fallbackLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Fallback')
      );
      expect(fallbackLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should warn when is_error is set with successful API cost', async () => {
      mockQueryWith([
        { type: 'result', total_cost_usd: 0.001, is_error: true, structured_output: { x: 1 } }
      ]);

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer',
        output_format: 'json'
      });

      await agentActions.codeReviewerWithOptions('Review');

      const warningLog = consoleSpy.mock.calls.find(call =>
        typeof call[0] === 'string' && call[0].includes('Warning') && call[0].includes('is_error=true')
      );
      expect(warningLog).toBeTruthy();
      consoleSpy.mockRestore();
    });

    it('should accumulate stream_event text deltas', async () => {
      mockQueryWith([
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hello ' } } },
        { type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'world' } } },
        { type: 'result' }
      ]);

      const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
      const agentActions = new AgentActions(mockConfDict, environment, {
        ...mockArgs,
        role: 'code_reviewer'
      });

      await agentActions.codeReviewerWithOptions('Review');

      const writes = stdoutSpy.mock.calls.map(c => String(c[0])).join('');
      expect(writes).toContain('hello world');
      stdoutSpy.mockRestore();
    });
  });
});

