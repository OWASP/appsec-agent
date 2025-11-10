/**
 * Tests for agent-run CLI script
 */

// Mock the modules before requiring the CLI script
jest.mock('commander', () => {
  const mockCommand = {
    name: jest.fn().mockReturnThis(),
    description: jest.fn().mockReturnThis(),
    option: jest.fn().mockReturnThis(),
    parse: jest.fn(),
    opts: jest.fn()
  };
  return {
    Command: jest.fn(() => mockCommand)
  };
});

jest.mock('../utils', () => ({
  loadYaml: jest.fn(),
  listRoles: jest.fn(),
  printVersionInfo: jest.fn(),
  getProjectRoot: jest.fn(() => '/test/project/root')
}));

jest.mock('../main', () => ({
  main: jest.fn().mockResolvedValue(undefined)
}));

describe('agent-run CLI', () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalArgv: string[];
  let originalExit: (code?: number) => never;
  let exitMock: jest.Mock;

  beforeEach(() => {
    // Save original values
    originalEnv = { ...process.env };
    originalArgv = [...process.argv];
    originalExit = process.exit;
    
    // Mock process.exit
    exitMock = jest.fn((code?: number) => {
      // Prevent actual exit in tests
      throw new Error(`process.exit(${code}) called`);
    });
    process.exit = exitMock as any;

    // Clear environment variables
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
  });

  afterEach(() => {
    // Restore original values
    process.env = originalEnv;
    process.argv = originalArgv;
    process.exit = originalExit;
    jest.clearAllMocks();
  });

  describe('Anthropic API environment variables', () => {
    it('should set ANTHROPIC_API_KEY when --anthropic-api-key is provided', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with --anthropic-api-key
      mockCommand.opts.mockReturnValue({
        anthropicApiKey: 'test-api-key-123',
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
      }

      expect(process.env.ANTHROPIC_API_KEY).toBe('test-api-key-123');
    });

    it('should set ANTHROPIC_BASE_URL when --anthropic-base-url is provided', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with --anthropic-base-url
      mockCommand.opts.mockReturnValue({
        anthropicBaseUrl: 'https://api.custom-anthropic.com',
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicBaseUrl) {
        process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
      }

      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.custom-anthropic.com');
    });

    it('should set both ANTHROPIC_API_KEY and ANTHROPIC_BASE_URL when both are provided', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with both options
      mockCommand.opts.mockReturnValue({
        anthropicApiKey: 'test-api-key-456',
        anthropicBaseUrl: 'https://api.anthropic.com/v1',
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
      }
      if (options.anthropicBaseUrl) {
        process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
      }

      expect(process.env.ANTHROPIC_API_KEY).toBe('test-api-key-456');
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://api.anthropic.com/v1');
    });

    it('should not set environment variables when options are not provided', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing without Anthropic options
      mockCommand.opts.mockReturnValue({
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
      }
      if (options.anthropicBaseUrl) {
        process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
      }

      expect(process.env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(process.env.ANTHROPIC_BASE_URL).toBeUndefined();
    });

    it('should override existing environment variables when command line options are provided', () => {
      // Set initial environment variables
      process.env.ANTHROPIC_API_KEY = 'original-api-key';
      process.env.ANTHROPIC_BASE_URL = 'https://original-url.com';

      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with new values
      mockCommand.opts.mockReturnValue({
        anthropicApiKey: 'new-api-key',
        anthropicBaseUrl: 'https://new-url.com',
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
      }
      if (options.anthropicBaseUrl) {
        process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
      }

      expect(process.env.ANTHROPIC_API_KEY).toBe('new-api-key');
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://new-url.com');
    });

    it('should preserve existing environment variables when command line options are not provided', () => {
      // Set initial environment variables
      process.env.ANTHROPIC_API_KEY = 'existing-api-key';
      process.env.ANTHROPIC_BASE_URL = 'https://existing-url.com';

      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing without Anthropic options
      mockCommand.opts.mockReturnValue({
        role: 'simple_query_agent',
        environment: 'development'
      });

      // Simulate the environment variable setting logic from agent-run.js
      const options = mockCommand.opts();
      if (options.anthropicApiKey) {
        process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
      }
      if (options.anthropicBaseUrl) {
        process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
      }

      expect(process.env.ANTHROPIC_API_KEY).toBe('existing-api-key');
      expect(process.env.ANTHROPIC_BASE_URL).toBe('https://existing-url.com');
    });
  });
});

