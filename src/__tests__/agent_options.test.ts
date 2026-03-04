/**
 * Tests for AgentOptions class
 */

import { AgentOptions, ToolUsageLog } from '../agent_options';
import { ConfigDict } from '../utils';

describe('AgentOptions', () => {
  let mockConfDict: ConfigDict;
  const environment = 'default';

  beforeEach(() => {
    mockConfDict = {
      default: {
        simple_query_agent: {
          options: {
            system_prompt: 'Test system prompt',
            max_turns: 2
          }
        },
        code_reviewer: {
          options: {
            system_prompt: 'Code review system prompt'
          }
        },
        threat_modeler: {
          options: {
            system_prompt: 'Threat modeler system prompt'
          }
        }
      }
    };
  });

  describe('constructor', () => {
    it('should initialize with config dict and environment', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      expect(agentOptions).toBeInstanceOf(AgentOptions);
      expect(agentOptions.getToolUsageLog()).toEqual([]);
    });
  });

  describe('toolPermissionCallback', () => {
    it('should log tool usage and return allow permission', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const toolName = 'Read';
      const inputData = { path: '/test/path' };
      const options = { 
        suggestions: undefined,
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id'
      };

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      const result = await agentOptions.toolPermissionCallback(toolName, inputData, options);

      expect(result).toEqual({
        behavior: 'allow',
        updatedInput: inputData
      });
      expect(agentOptions.getToolUsageLog()).toHaveLength(1);
      expect(agentOptions.getToolUsageLog()[0].tool).toBe(toolName);
      expect(agentOptions.getToolUsageLog()[0].input).toEqual(inputData);
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });

    it('should handle tool requests without suggestions', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const toolName = 'Write';
      const inputData = { file: 'test.txt', content: 'test' };
      const options = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id'
      };

      const result = await agentOptions.toolPermissionCallback(toolName, inputData, options);

      expect(result.behavior).toBe('allow');
      expect(agentOptions.getToolUsageLog()[0].suggestions).toBe('');
    });

    it('should accumulate multiple tool usage logs', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const baseOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id'
      };
      
      await agentOptions.toolPermissionCallback('Read', { path: '1' }, baseOptions);
      await agentOptions.toolPermissionCallback('Write', { path: '2' }, baseOptions);
      await agentOptions.toolPermissionCallback('Grep', { path: '3' }, baseOptions);

      expect(agentOptions.getToolUsageLog()).toHaveLength(3);
      expect(agentOptions.getToolUsageLog().map(log => log.tool)).toEqual(['Read', 'Write', 'Grep']);
    });
  });

  describe('getToolUsageLog', () => {
    it('should return a copy of the tool usage log', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const baseOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id'
      };
      
      await agentOptions.toolPermissionCallback('Read', { path: '1' }, baseOptions);
      
      const log1 = agentOptions.getToolUsageLog();
      const log2 = agentOptions.getToolUsageLog();
      
      // Should return copies, not the same reference
      expect(log1).not.toBe(log2);
      expect(log1).toEqual(log2);
    });
  });

  describe('clearToolUsageLog', () => {
    it('should clear the tool usage log', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const baseOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool-use-id'
      };
      
      await agentOptions.toolPermissionCallback('Read', { path: '1' }, baseOptions);
      await agentOptions.toolPermissionCallback('Write', { path: '2' }, baseOptions);
      
      expect(agentOptions.getToolUsageLog()).toHaveLength(2);
      
      agentOptions.clearToolUsageLog();
      
      expect(agentOptions.getToolUsageLog()).toHaveLength(0);
      expect(agentOptions.getToolUsageLog()).toEqual([]);
    });
  });

  describe('getSimpleQueryAgentOptions', () => {
    it('should return options with config values', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getSimpleQueryAgentOptions('simple_query_agent');

      expect(options.systemPrompt).toBe('Test system prompt');
      expect(options.maxTurns).toBe(2);
    });

    it('should use default values when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getSimpleQueryAgentOptions('simple_query_agent');

      expect(options.systemPrompt).toBe('You are an Application Security (AppSec) expert assistant. You are responsible for providing security advice and guidance to the user.');
      expect(options.maxTurns).toBe(1);
    });

    it('should use default role name when not provided', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getSimpleQueryAgentOptions();

      expect(options.systemPrompt).toBe('Test system prompt');
    });
  });

  describe('getCodeReviewerOptions', () => {
    it('should return options with agent configuration', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions('code_reviewer');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['code-reviewer']).toBeDefined();
      expect(options.agents?.['code-reviewer'].prompt).toBe('Code review system prompt');
      expect(options.agents?.['code-reviewer'].tools).toEqual(['Read', 'Grep', 'Write']);
      expect(options.agents?.['code-reviewer'].model).toBe('sonnet');
      expect(options.permissionMode).toBe('bypassPermissions');
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions('code_reviewer');

      expect(options.agents?.['code-reviewer'].prompt).toBe(
        'You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review. List out all the potential security and privacy issues found in the code.'
      );
    });

    it('should use default role name when not provided', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions();

      expect(options.agents?.['code-reviewer'].prompt).toBe('Code review system prompt');
    });
  });

  describe('getThreatModelerOptions', () => {
    it('should return options with agent configuration', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getThreatModelerOptions('threat_modeler');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['threat-modeler']).toBeDefined();
      expect(options.agents?.['threat-modeler'].prompt).toBe('Threat modeler system prompt');
      expect(options.agents?.['threat-modeler'].description).toBe('Performs threat modeling and risk assessment using STRIDE methodology');
      expect(options.agents?.['threat-modeler'].tools).toEqual(['Read', 'Grep', 'Write', 'Graphviz']);
      expect(options.agents?.['threat-modeler'].model).toBe('sonnet');
      expect(options.permissionMode).toBe('bypassPermissions');
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getThreatModelerOptions('threat_modeler');

      expect(options.agents?.['threat-modeler'].prompt).toBe(
        'You are an Application Security (AppSec) expert assistant. You are responsible for performing risk assessment on the source code repository for SOC2 type 2 compliance audit using the STRIDE methodology.'
      );
    });

    it('should use default role name when not provided', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getThreatModelerOptions();

      expect(options.agents?.['threat-modeler'].prompt).toBe('Threat modeler system prompt');
    });
  });

  describe('getDiffReviewerOptions', () => {
    it('should return options with agent configuration', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['diff-reviewer']).toBeDefined();
      expect(options.agents?.['diff-reviewer'].prompt).toContain('Pull Request security reviews');
      expect(options.agents?.['diff-reviewer'].tools).toEqual(['Read', 'Write']);
      expect(options.agents?.['diff-reviewer'].model).toBe('sonnet');
      expect(options.permissionMode).toBe('bypassPermissions');
    });

    it('should append source directory to system prompt when provided', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', '/tmp/src');

      expect(options.agents?.['diff-reviewer'].prompt).toContain('/tmp/src');
      expect(options.agents?.['diff-reviewer'].prompt).toContain('Source directory available');
    });

    it('should not include source directory when srcDir is null', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null);

      expect(options.agents?.['diff-reviewer'].prompt).not.toContain('Source directory available');
    });

    it('should add JSON schema when output format is json', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'json');

      expect(options.outputFormat).toBeDefined();
      expect((options.outputFormat as any).type).toBe('json_schema');
    });

    it('should not add JSON schema for non-json output format', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'markdown');

      expect(options.outputFormat).toBeUndefined();
    });

    it('should use diff_reviewer_system_prompt override from config when available', () => {
      const confWithOverride: ConfigDict = {
        default: {
          ...mockConfDict.default,
          code_reviewer: {
            options: {
              diff_reviewer_system_prompt: 'Custom diff review prompt'
            }
          }
        }
      };
      const agentOptions = new AgentOptions(confWithOverride, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer');

      expect(options.agents?.['diff-reviewer'].prompt).toBe('Custom diff review prompt');
    });

    it('should use default role name when not provided', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions();

      expect(options.agents?.['diff-reviewer']).toBeDefined();
      expect(options.agents?.['diff-reviewer'].prompt).toContain('Pull Request');
    });
  });

  describe('getCodeFixerOptions', () => {
    it('should return options with agent configuration and structured output', () => {
      const confWithFixer: ConfigDict = {
        default: {
          ...mockConfDict.default,
          code_fixer: {
            options: {
              system_prompt: 'Code fixer system prompt'
            }
          }
        }
      };
      const agentOptions = new AgentOptions(confWithFixer, environment);
      const options = agentOptions.getCodeFixerOptions('code_fixer');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['code-fixer']).toBeDefined();
      expect(options.agents?.['code-fixer'].prompt).toBe('Code fixer system prompt');
      expect(options.agents?.['code-fixer'].tools).toEqual(['Read', 'Grep']);
      expect(options.agents?.['code-fixer'].model).toBe('sonnet');
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.outputFormat).toEqual({
        type: 'json_schema',
        schema: expect.objectContaining({
          type: 'object',
          required: expect.arrayContaining(['fixed_code', 'start_line', 'end_line'])
        })
      });
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getCodeFixerOptions('code_fixer');

      expect(options.agents?.['code-fixer'].prompt).toContain('expert security engineer');
    });

    it('should append source directory to system prompt when provided', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getCodeFixerOptions('code_fixer', '/tmp/src');

      expect(options.agents?.['code-fixer'].prompt).toContain('/tmp/src');
      expect(options.agents?.['code-fixer'].prompt).toContain('Source directory available');
    });

    it('should always enforce JSON schema output format', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getCodeFixerOptions();

      expect(options.outputFormat).toBeDefined();
      expect((options.outputFormat as any).type).toBe('json_schema');
    });
  });

  describe('getQaVerifierOptions', () => {
    it('should return options with agent configuration and structured output', () => {
      const confWithQa: ConfigDict = {
        default: {
          ...mockConfDict.default,
          qa_verifier: {
            options: {
              system_prompt: 'QA verifier system prompt'
            }
          }
        }
      };
      const agentOptions = new AgentOptions(confWithQa, environment);
      const options = agentOptions.getQaVerifierOptions('qa_verifier');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['qa-verifier']).toBeDefined();
      expect(options.agents?.['qa-verifier'].prompt).toBe('QA verifier system prompt');
      expect(options.agents?.['qa-verifier'].tools).toEqual(['Read', 'Grep', 'Bash']);
      expect(options.agents?.['qa-verifier'].model).toBe('sonnet');
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.outputFormat).toEqual({
        type: 'json_schema',
        schema: expect.objectContaining({
          name: 'qa_verdict',
          strict: true
        })
      });
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getQaVerifierOptions('qa_verifier');

      expect(options.agents?.['qa-verifier'].prompt).toContain('QA verification engineer');
    });

    it('should append source directory to system prompt when provided', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getQaVerifierOptions('qa_verifier', '/tmp/project');

      expect(options.agents?.['qa-verifier'].prompt).toContain('/tmp/project');
      expect(options.agents?.['qa-verifier'].prompt).toContain('Project source code is available');
    });

    it('should not include source directory when srcDir is null', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getQaVerifierOptions('qa_verifier', null);

      expect(options.agents?.['qa-verifier'].prompt).not.toContain('Project source code is available');
    });

    it('should always enforce JSON schema output format', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getQaVerifierOptions();

      expect(options.outputFormat).toBeDefined();
      expect((options.outputFormat as any).type).toBe('json_schema');
    });

    it('should use specified model', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment, 'opus');
      const options = agentOptions.getQaVerifierOptions();

      expect(options.agents?.['qa-verifier'].model).toBe('opus');
    });
  });
});

