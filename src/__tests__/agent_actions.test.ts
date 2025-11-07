/**
 * Tests for AgentActions class
 */

import { AgentActions, AgentArgs } from '../agent_actions';
import { AgentOptions } from '../agent_options';
import { ConfigDict } from '../utils';
import { query } from '@anthropic-ai/claude-agent-sdk';

// Mock the Claude SDK
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

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
      
      await expect(agentActions.simpleQueryClaudeWithOptions('Test prompt')).rejects.toThrow('Test error');
      expect(consoleErrorSpy).toHaveBeenCalledWith('Error during query:', error);
      
      consoleErrorSpy.mockRestore();
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
});

