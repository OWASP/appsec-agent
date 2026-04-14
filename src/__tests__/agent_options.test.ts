/**
 * Tests for AgentOptions class
 */

import { AgentOptions, ToolUsageLog } from '../agent_options';
import { ConfigDict } from '../utils';
import { SECURITY_REPORT_SCHEMA } from '../schemas/security_report';

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
      expect(options.agents?.['code-reviewer'].model).toBe('opus');
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

    it('should append fix_code vs fix_options guidance when output format is json', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions('code_reviewer', 'json');
      const prompt = options.agents?.['code-reviewer'].prompt as string;

      expect(prompt).toContain('FIXED CODE vs FIX OPTIONS');
      expect(prompt).toContain('fixed_code');
      expect(prompt).toContain('fix_options');
    });

    it('should not append fix guidance when output format is markdown', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions('code_reviewer', 'markdown');
      const prompt = options.agents?.['code-reviewer'].prompt as string;

      expect(prompt).not.toContain('FIXED CODE vs FIX OPTIONS');
    });

    it('should not append fix guidance when output format is undefined', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getCodeReviewerOptions('code_reviewer');
      const prompt = options.agents?.['code-reviewer'].prompt as string;

      expect(prompt).not.toContain('FIXED CODE vs FIX OPTIONS');
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
      expect(options.agents?.['threat-modeler'].model).toBe('opus');
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
    it('should return options with agent configuration including Grep tool and maxTurns', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['diff-reviewer']).toBeDefined();
      expect(options.agents?.['diff-reviewer'].prompt).toContain('Pull Request security reviews');
      expect(options.agents?.['diff-reviewer'].tools).toEqual(['Read', 'Grep', 'Write']);
      expect(options.agents?.['diff-reviewer'].model).toBe('opus');
      expect((options.agents?.['diff-reviewer'] as any).maxTurns).toBe(10);
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

    it('should append fix_code vs fix_options guidance when output format is json', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'json');
      const prompt = options.agents?.['diff-reviewer'].prompt as string;

      expect(prompt).toContain('FIXED CODE vs FIX OPTIONS');
      expect(prompt).toContain('fixed_code');
      expect(prompt).toContain('fix_options');
    });

    it('should not append fix guidance when output format is markdown', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'markdown');
      const prompt = options.agents?.['diff-reviewer'].prompt as string;

      expect(prompt).not.toContain('FIXED CODE vs FIX OPTIONS');
    });

    it('should not append fix guidance when output format is undefined', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getDiffReviewerOptions('code_reviewer');
      const prompt = options.agents?.['diff-reviewer'].prompt as string;

      expect(prompt).not.toContain('FIXED CODE vs FIX OPTIONS');
    });

    it('should append fix guidance even with config override prompt when json', () => {
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
      const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'json');
      const prompt = options.agents?.['diff-reviewer'].prompt as string;

      expect(prompt).toContain('Custom diff review prompt');
      expect(prompt).toContain('FIXED CODE vs FIX OPTIONS');
    });

    describe('noTools mode', () => {
      it('should restrict tools to Write-only when noTools is true', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, undefined, true);

        expect(options.agents?.['diff-reviewer'].tools).toEqual(['Write']);
      });

      it('should keep Read, Grep, Write tools when noTools is false', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, undefined, false);

        expect(options.agents?.['diff-reviewer'].tools).toEqual(['Read', 'Grep', 'Write']);
      });

      it('should keep Read, Grep, Write tools when noTools is undefined', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer');

        expect(options.agents?.['diff-reviewer'].tools).toEqual(['Read', 'Grep', 'Write']);
      });

      it('should use focused-context prompt without tool verification when noTools is true', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, undefined, true);
        const prompt = options.agents?.['diff-reviewer'].prompt as string;

        expect(prompt).toContain('Pull Request security reviews');
        expect(prompt).toContain('diff context already includes relevant imports');
        expect(prompt).not.toContain('Use Grep to search');
        expect(prompt).not.toContain('Use Read to inspect');
        expect(prompt).not.toContain('VERIFY findings by reading referenced files');
      });

      it('should use full tool-verification prompt when noTools is false', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, undefined, false);
        const prompt = options.agents?.['diff-reviewer'].prompt as string;

        expect(prompt).toContain('Use Grep to search');
        expect(prompt).toContain('Use Read to inspect');
        expect(prompt).toContain('VERIFY findings by reading referenced files');
      });

      it('should still append srcDir to prompt in noTools mode', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', '/tmp/src', undefined, undefined, true);

        expect(options.agents?.['diff-reviewer'].prompt).toContain('/tmp/src');
        expect(options.agents?.['diff-reviewer'].prompt).toContain('Source directory available');
      });

      it('should still apply maxTurns in noTools mode', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, 2, true);

        expect((options.agents?.['diff-reviewer'] as any).maxTurns).toBe(2);
      });

      it('should still add JSON schema in noTools mode with json output', () => {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, 'json', undefined, true);

        expect(options.outputFormat).toBeDefined();
        expect((options.outputFormat as any).type).toBe('json_schema');
      });

      it('should allow config override to replace noTools prompt', () => {
        const confWithOverride: ConfigDict = {
          default: {
            ...mockConfDict.default,
            code_reviewer: {
              options: {
                diff_reviewer_system_prompt: 'Custom override prompt'
              }
            }
          }
        };
        const agentOptions = new AgentOptions(confWithOverride, environment);
        const options = agentOptions.getDiffReviewerOptions('code_reviewer', null, undefined, undefined, true);

        expect(options.agents?.['diff-reviewer'].prompt).toBe('Custom override prompt');
        expect(options.agents?.['diff-reviewer'].tools).toEqual(['Write']);
      });
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
      expect(options.agents?.['code-fixer'].model).toBe('opus');
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
      expect(options.agents?.['qa-verifier'].model).toBe('opus');
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

  describe('getContextExtractorOptions', () => {
    it('should return options with no tools and maxTurns 1', () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const options = agentOptions.getContextExtractorOptions('context_extractor');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['context-extractor']).toBeDefined();
      expect(options.agents?.['context-extractor'].tools).toEqual([]);
      expect((options.agents?.['context-extractor'] as any).maxTurns).toBe(1);
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.outputFormat).toEqual({
        type: 'json_schema',
        schema: expect.objectContaining({
          type: 'object',
          required: expect.arrayContaining(['project_summary', 'security_context', 'deployment_context', 'developer_context']),
          additionalProperties: false,
        }),
      });
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getContextExtractorOptions('context_extractor');

      expect(options.agents?.['context-extractor'].prompt).toContain('security-aware software analyst');
    });

    it('should use custom system prompt from config when available', () => {
      const confWithExtractor: ConfigDict = {
        default: {
          ...mockConfDict.default,
          context_extractor: {
            options: {
              system_prompt: 'Custom extraction prompt',
            },
          },
        },
      };
      const agentOptions = new AgentOptions(confWithExtractor, environment);
      const options = agentOptions.getContextExtractorOptions('context_extractor');

      expect(options.agents?.['context-extractor'].prompt).toBe('Custom extraction prompt');
    });

    it('should always enforce JSON schema output format', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getContextExtractorOptions();

      expect(options.outputFormat).toBeDefined();
      expect((options.outputFormat as any).type).toBe('json_schema');
    });
  });

  describe('getFindingValidatorOptions', () => {
    it('should return options with agent configuration and structured output', () => {
      const confWithValidator: ConfigDict = {
        default: {
          ...mockConfDict.default,
          finding_validator: {
            options: {
              system_prompt: 'Finding validator system prompt'
            }
          }
        }
      };
      const agentOptions = new AgentOptions(confWithValidator, environment);
      const options = agentOptions.getFindingValidatorOptions('finding_validator');

      expect(options.agents).toBeDefined();
      expect(options.agents?.['finding-validator']).toBeDefined();
      expect(options.agents?.['finding-validator'].prompt).toBe('Finding validator system prompt');
      expect(options.agents?.['finding-validator'].tools).toEqual(['Read', 'Grep']);
      expect(options.agents?.['finding-validator'].model).toBe('opus');
      expect(options.permissionMode).toBe('bypassPermissions');
      expect(options.outputFormat).toEqual({
        type: 'json_schema',
        schema: expect.objectContaining({
          type: 'object',
          required: expect.arrayContaining(['still_present', 'confidence', 'reasoning', 'current_line']),
          additionalProperties: false
        })
      });
    });

    it('should use default system prompt when config is missing', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getFindingValidatorOptions('finding_validator');

      expect(options.agents?.['finding-validator'].prompt).toContain('vulnerability validation');
    });

    it('should append source directory to system prompt when provided', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getFindingValidatorOptions('finding_validator', '/tmp/src');

      expect(options.agents?.['finding-validator'].prompt).toContain('/tmp/src');
      expect(options.agents?.['finding-validator'].prompt).toContain('Source code is available');
    });

    it('should not include source directory when srcDir is null', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getFindingValidatorOptions('finding_validator', null);

      expect(options.agents?.['finding-validator'].prompt).not.toContain('Source code is available');
    });

    it('should always enforce JSON schema output format', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment);
      const options = agentOptions.getFindingValidatorOptions();

      expect(options.outputFormat).toBeDefined();
      expect((options.outputFormat as any).type).toBe('json_schema');
    });

    it('should use specified model', () => {
      const emptyConfDict: ConfigDict = { default: {} };
      const agentOptions = new AgentOptions(emptyConfDict, environment, 'haiku');
      const options = agentOptions.getFindingValidatorOptions();

      expect(options.agents?.['finding-validator'].model).toBe('haiku');
    });
  });
});

describe('SECURITY_REPORT_SCHEMA', () => {
  const findingsSchema = (SECURITY_REPORT_SCHEMA as any).properties.security_review_report.properties.findings;
  const findingProps = findingsSchema.items.properties;

  it('should include fix_options in finding properties', () => {
    expect(findingProps.fix_options).toBeDefined();
    expect(findingProps.fix_options.type).toBe('array');
  });

  it('should require id, title, description on fix_options items', () => {
    const itemSchema = findingProps.fix_options.items;

    expect(itemSchema.type).toBe('object');
    expect(itemSchema.required).toEqual(['id', 'title', 'description']);
  });

  it('should define correct types for fix_options item properties', () => {
    const itemProps = findingProps.fix_options.items.properties;

    expect(itemProps.id.type).toBe('integer');
    expect(itemProps.title.type).toBe('string');
    expect(itemProps.description.type).toBe('string');
  });

  it('should have updated fixed_code description mentioning fix_options', () => {
    expect(findingProps.fixed_code.description).toContain('compilable/runnable code');
    expect(findingProps.fixed_code.description).toContain('fix_options');
  });
});

