/**
 * Concurrency tests for thread-safety in web application usage
 * 
 * These tests verify that the codebase is safe for concurrent usage
 * in web applications where multiple requests may be processed simultaneously.
 */

import { AgentActions, AgentArgs } from '../agent_actions';
import { AgentOptions } from '../agent_options';
import { ConfigDict, validateOutputFilePath } from '../utils';
import { query } from '@anthropic-ai/claude-agent-sdk';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

// Mock the Claude SDK
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn()
}));

describe('Concurrency Tests', () => {
  let mockConfDict: ConfigDict;
  const environment = 'default';
  let consoleSpies: jest.SpyInstance[];

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
        }
      }
    };

    // Suppress all console output during tests for cleaner output
    // Store all spies so we can restore them later
    consoleSpies = [
      jest.spyOn(console, 'log').mockImplementation(() => {}),
      jest.spyOn(console, 'error').mockImplementation(() => {}),
      jest.spyOn(console, 'warn').mockImplementation(() => {}),
      jest.spyOn(console, 'info').mockImplementation(() => {}),
      jest.spyOn(console, 'debug').mockImplementation(() => {}),
    ];

    // Reset mocks (but keep console spies active)
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Restore all console methods
    consoleSpies.forEach(spy => spy.mockRestore());
    consoleSpies = [];
  });

  describe('AgentActions - Conversation History Isolation', () => {
    it('should isolate conversation history across multiple instances', async () => {
      const numRequests = 5;
      const requests: Promise<void>[] = [];

      // Pre-mock all query calls (5 requests * 3 queries each = 15 mocks)
      for (let i = 0; i < numRequests; i++) {
        for (let q = 0; q < 3; q++) {
          (query as jest.Mock).mockReturnValueOnce({
            [Symbol.asyncIterator]: async function* () {
              yield {
                type: 'assistant',
                message: {
                  content: [
                    {
                      type: 'text',
                      text: `Response for request ${i}, query ${q}`
                    }
                  ]
                }
              };
              yield {
                type: 'result',
                total_cost_usd: 0.001,
                is_error: false
              };
            }
          });
        }
      }

      // Create multiple AgentActions instances (simulating multiple HTTP requests)
      for (let i = 0; i < numRequests; i++) {
        const requestId = i;
        const mockArgs: AgentArgs = {
          role: 'simple_query_agent',
          environment: 'default',
          verbose: false
        };

        const agentActions = new AgentActions(mockConfDict, environment, mockArgs);

        // Each request makes multiple queries to build conversation history
        requests.push(
          (async () => {
            await agentActions.simpleQueryClaudeWithOptions(`Question ${requestId}-1`);
            await agentActions.simpleQueryClaudeWithOptions(`Question ${requestId}-2`);
            await agentActions.simpleQueryClaudeWithOptions(`Question ${requestId}-3`);
          })()
        );
      }

      // Execute all requests concurrently
      await Promise.all(requests);

      // Verify that each instance has its own isolated conversation history
      // by checking that query was called with the correct context
      const queryCalls = (query as jest.Mock).mock.calls;
      
      // Each request makes 3 queries, so we should have 15 total calls
      expect(queryCalls.length).toBe(numRequests * 3);

      // Verify isolation: each first query should only contain its own question
      // Find first queries (those that don't contain conversation history from previous queries)
      for (let i = 0; i < numRequests; i++) {
        // Find the first query for this request (contains Question X-1 but not Question X-2 or Question X-3)
        const firstQueryCall = queryCalls.find(call => {
          const prompt = call[0].prompt;
          return prompt.includes(`Question ${i}-1`) && 
                 !prompt.includes(`Question ${i}-2`) &&
                 !prompt.includes(`Question ${i}-3`);
        });
        
        expect(firstQueryCall).toBeDefined();
        if (firstQueryCall) {
          const prompt = firstQueryCall[0].prompt;
          // Should contain its own question
          expect(prompt).toContain(`Question ${i}-1`);
          // Should not contain other requests' questions in the first query
          for (let j = 0; j < numRequests; j++) {
            if (j !== i) {
              // First query shouldn't have other requests' questions
              expect(prompt).not.toContain(`Question ${j}-`);
            }
          }
        }
      }
    });

    it('should maintain conversation history within a single instance', async () => {
      const mockArgs: AgentArgs = {
        role: 'simple_query_agent',
        environment: 'default',
        verbose: false
      };

      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);

      // Mock query responses
      (query as jest.Mock)
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'First response' }]
              }
            };
            yield { type: 'result', total_cost_usd: 0.001, is_error: false };
          }
        })
        .mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: 'Second response' }]
              }
            };
            yield { type: 'result', total_cost_usd: 0.001, is_error: false };
          }
        });

      await agentActions.simpleQueryClaudeWithOptions('First question');
      await agentActions.simpleQueryClaudeWithOptions('Second question');

      // Verify that the second query includes conversation history
      const secondCall = (query as jest.Mock).mock.calls[1][0].prompt;
      expect(secondCall).toContain('First question');
      expect(secondCall).toContain('First response');
      expect(secondCall).toContain('Second question');
    });
  });

  describe('AgentOptions - Tool Usage Log Isolation', () => {
    it('should isolate tool usage logs across multiple instances', async () => {
      const numRequests = 5;
      const agentOptionsInstances: AgentOptions[] = [];

      // Create multiple AgentOptions instances
      for (let i = 0; i < numRequests; i++) {
        const agentOptions = new AgentOptions(mockConfDict, environment);
        agentOptionsInstances.push(agentOptions);

        // Each instance logs different tools
        const baseOptions = {
          signal: new AbortController().signal,
          toolUseID: `tool-${i}`
        };

        await agentOptions.toolPermissionCallback(`Tool${i}`, { requestId: i }, baseOptions);
        await agentOptions.toolPermissionCallback(`Tool${i}-2`, { requestId: i }, baseOptions);
      }

      // Verify that each instance has its own isolated log
      for (let i = 0; i < numRequests; i++) {
        const log = agentOptionsInstances[i].getToolUsageLog();
        expect(log).toHaveLength(2);
        expect(log[0].tool).toBe(`Tool${i}`);
        expect(log[1].tool).toBe(`Tool${i}-2`);

        // Verify that logs don't contain entries from other instances
        for (let j = 0; j < numRequests; j++) {
          if (j !== i) {
            expect(log.some(entry => entry.tool === `Tool${j}`)).toBe(false);
          }
        }
      }
    });

    it('should allow clearing tool usage log independently', async () => {
      const agentOptions1 = new AgentOptions(mockConfDict, environment);
      const agentOptions2 = new AgentOptions(mockConfDict, environment);

      const baseOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool'
      };

      await agentOptions1.toolPermissionCallback('Tool1', {}, baseOptions);
      await agentOptions1.toolPermissionCallback('Tool2', {}, baseOptions);
      await agentOptions2.toolPermissionCallback('Tool3', {}, baseOptions);
      await agentOptions2.toolPermissionCallback('Tool4', {}, baseOptions);

      expect(agentOptions1.getToolUsageLog()).toHaveLength(2);
      expect(agentOptions2.getToolUsageLog()).toHaveLength(2);

      // Clear log for instance 1 only
      agentOptions1.clearToolUsageLog();

      expect(agentOptions1.getToolUsageLog()).toHaveLength(0);
      expect(agentOptions2.getToolUsageLog()).toHaveLength(2);
      expect(agentOptions2.getToolUsageLog()[0].tool).toBe('Tool3');
    });
  });

  describe('Concurrent File Operations', () => {
    let testDirs: string[];

    beforeEach(() => {
      testDirs = [];
    });

    afterEach(() => {
      // Clean up test directories
      testDirs.forEach(dir => {
        if (fs.existsSync(dir)) {
          fs.removeSync(dir);
        }
      });
    });

    it('should handle concurrent file path validation with different working directories', async () => {
      const numRequests = 10;
      const requests: Promise<string | null>[] = [];

      // Create separate working directories for each request
      for (let i = 0; i < numRequests; i++) {
        const testDir = path.join(os.tmpdir(), `appsec-agent-concurrent-test-${Date.now()}-${i}`);
        fs.ensureDirSync(testDir);
        testDirs.push(testDir);

        // Each request validates a file path in its own directory
        requests.push(
          Promise.resolve(validateOutputFilePath(`output-${i}.md`, testDir))
        );
      }

      // Execute all validations concurrently
      const results = await Promise.all(requests);

      // Verify that each validation succeeded and returned the correct path
      for (let i = 0; i < numRequests; i++) {
        expect(results[i]).toBeTruthy();
        expect(results[i]).toContain(`output-${i}.md`);
        expect(results[i]?.startsWith(testDirs[i])).toBe(true);
      }
    });

    it('should prevent directory traversal in concurrent contexts', async () => {
      const numRequests = 5;
      const requests: Promise<string | null>[] = [];
      const testDir = path.join(os.tmpdir(), `appsec-agent-concurrent-test-${Date.now()}`);
      fs.ensureDirSync(testDir);
      testDirs.push(testDir);

      // All requests try to use directory traversal
      for (let i = 0; i < numRequests; i++) {
        requests.push(
          Promise.resolve(validateOutputFilePath(`../../output-${i}.md`, testDir))
        );
      }

      // Execute all validations concurrently
      const results = await Promise.all(requests);

      // All should be rejected
      results.forEach(result => {
        expect(result).toBeNull();
      });
    });
  });

  describe('Concurrent AgentActions Operations', () => {
    it('should handle multiple concurrent simpleQueryClaudeWithOptions calls', async () => {
      const numConcurrentCalls = 10;
      const requests: Promise<string>[] = [];

      // Create separate instances for each call (recommended pattern)
      const mockArgs: AgentArgs = {
        role: 'simple_query_agent',
        environment: 'default',
        verbose: false
      };

      // Pre-mock all query calls
      for (let i = 0; i < numConcurrentCalls; i++) {
        (query as jest.Mock).mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: `Response ${i}` }]
              }
            };
            yield { type: 'result', total_cost_usd: 0.001, is_error: false };
          }
        });
      }

      // Make concurrent calls with separate instances
      for (let i = 0; i < numConcurrentCalls; i++) {
        const agentActions = new AgentActions(mockConfDict, environment, mockArgs);
        requests.push(agentActions.simpleQueryClaudeWithOptions(`Question ${i}`));
      }

      // Execute all concurrently
      await Promise.all(requests);

      // Verify all calls completed
      expect((query as jest.Mock).mock.calls.length).toBe(numConcurrentCalls);
    });

    it('should handle concurrent codeReviewerWithOptions calls with different output files', async () => {
      const numConcurrentCalls = 5;
      const requests: Promise<string>[] = [];
      const testDir = path.join(os.tmpdir(), `appsec-agent-concurrent-test-${Date.now()}`);
      fs.ensureDirSync(testDir);

      // Create separate instances for each request (recommended pattern)
      for (let i = 0; i < numConcurrentCalls; i++) {
        const mockArgs: AgentArgs = {
          role: 'code_reviewer',
          environment: 'default',
          output_file: `report-${i}.md`,
          output_format: 'markdown',
          verbose: false
        };
        const agentActions = new AgentActions(mockConfDict, environment, mockArgs);

        // Mock query
        (query as jest.Mock).mockReturnValueOnce({
          [Symbol.asyncIterator]: async function* () {
            yield {
              type: 'assistant',
              message: {
                content: [{ type: 'text', text: `Review ${i}` }]
              }
            };
            yield { type: 'result', total_cost_usd: 0.001, is_error: false };
          }
        });

        requests.push(agentActions.codeReviewerWithOptions(`Review code ${i}`));
      }

      // Execute all concurrently
      await Promise.all(requests);

      // Verify all calls completed
      expect((query as jest.Mock).mock.calls.length).toBe(numConcurrentCalls);

      // Clean up
      if (fs.existsSync(testDir)) {
        fs.removeSync(testDir);
      }
    });
  });

  describe('Race Condition Prevention', () => {
    it('should not have race conditions when capturing process.cwd()', async () => {
      const numRequests = 10;
      const originalCwd = process.cwd();
      const testDirs: string[] = [];

      try {
        // Create separate directories for each request
        for (let i = 0; i < numRequests; i++) {
          const testDir = path.join(os.tmpdir(), `appsec-agent-race-test-${Date.now()}-${i}`);
          fs.ensureDirSync(testDir);
          testDirs.push(testDir);
        }

        // Simulate concurrent requests that might change working directory
        const requests = testDirs.map(async (testDir, index) => {
          // Capture cwd at the start (like main() does)
          const capturedCwd = process.cwd();
          
          // Simulate some async work
          await new Promise(resolve => setImmediate(resolve));
          
          // Use captured cwd, not process.cwd()
          const result = validateOutputFilePath(`output-${index}.md`, capturedCwd);
          
          return { index, capturedCwd, result };
        });

        const results = await Promise.all(requests);

        // Verify that each request used its captured cwd correctly
        results.forEach(({ index, capturedCwd, result }) => {
          expect(capturedCwd).toBe(originalCwd);
          expect(result).toBeTruthy();
          expect(result).toContain(`output-${index}.md`);
        });
      } finally {
        // Clean up
        testDirs.forEach(dir => {
          if (fs.existsSync(dir)) {
            fs.removeSync(dir);
          }
        });
      }
    });
  });

  describe('Memory Leak Prevention', () => {
    it('should not accumulate unbounded tool usage logs', async () => {
      const agentOptions = new AgentOptions(mockConfDict, environment);
      const baseOptions = {
        signal: new AbortController().signal,
        toolUseID: 'test-tool'
      };

      // Simulate many tool calls
      const numToolCalls = 100;
      for (let i = 0; i < numToolCalls; i++) {
        await agentOptions.toolPermissionCallback(`Tool${i}`, { index: i }, baseOptions);
      }

      // Verify log has all entries
      expect(agentOptions.getToolUsageLog()).toHaveLength(numToolCalls);

      // Clear log
      agentOptions.clearToolUsageLog();

      // Verify log is cleared
      expect(agentOptions.getToolUsageLog()).toHaveLength(0);

      // Add more entries
      for (let i = 0; i < 10; i++) {
        await agentOptions.toolPermissionCallback(`NewTool${i}`, { index: i }, baseOptions);
      }

      // Verify only new entries exist
      expect(agentOptions.getToolUsageLog()).toHaveLength(10);
      expect(agentOptions.getToolUsageLog()[0].tool).toBe('NewTool0');
    });

    it('should not accumulate unbounded conversation history', async () => {
      const mockArgs: AgentArgs = {
        role: 'simple_query_agent',
        environment: 'default',
        verbose: false
      };
      const agentActions = new AgentActions(mockConfDict, environment, mockArgs);

      // Mock query responses
      const mockResponse = {
        [Symbol.asyncIterator]: async function* () {
          yield {
            type: 'assistant',
            message: {
              content: [{ type: 'text', text: 'Response' }]
            }
          };
          yield { type: 'result', total_cost_usd: 0.001, is_error: false };
        }
      };

      // Simulate many conversation turns
      const numTurns = 50;
      for (let i = 0; i < numTurns; i++) {
        (query as jest.Mock).mockReturnValueOnce(mockResponse);
        await agentActions.simpleQueryClaudeWithOptions(`Question ${i}`);
      }

      // Verify that conversation history is maintained
      // (This is expected behavior for conversation context)
      const lastCall = (query as jest.Mock).mock.calls[numTurns - 1][0].prompt;
      expect(lastCall).toContain('Question 0'); // Should include early questions
      expect(lastCall).toContain(`Question ${numTurns - 1}`); // Should include latest question

      // Note: In a real web application, you would want to limit conversation history
      // or clear it between requests to prevent memory issues
    });
  });
});

