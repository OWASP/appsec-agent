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
});

