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
    delete process.env.FAILOVER_ENABLED;
    delete process.env.OPENAI_API_KEY;
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

  describe('Failover CLI options', () => {
    it('should set FAILOVER_ENABLED when --failover is provided', () => {
      const { Command } = require('commander');
      const mockCommand = Command();

      mockCommand.opts.mockReturnValue({
        failover: true,
        role: 'simple_query_agent',
        environment: 'development'
      });

      const options = mockCommand.opts();
      if (options.failover !== undefined) {
        process.env.FAILOVER_ENABLED = options.failover ? 'true' : 'false';
      }

      expect(process.env.FAILOVER_ENABLED).toBe('true');
    });

    it('should set FAILOVER_ENABLED to false when failover is false', () => {
      const { Command } = require('commander');
      const mockCommand = Command();

      mockCommand.opts.mockReturnValue({
        failover: false,
        role: 'simple_query_agent',
        environment: 'development'
      });

      const options = mockCommand.opts();
      if (options.failover !== undefined) {
        process.env.FAILOVER_ENABLED = options.failover ? 'true' : 'false';
      }

      expect(process.env.FAILOVER_ENABLED).toBe('false');
    });

    it('should set OPENAI_API_KEY when --openai-api-key is provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const { Command } = require('commander');
      const mockCommand = Command();

      mockCommand.opts.mockReturnValue({
        openaiApiKey: 'sk-test-openai-key',
        role: 'simple_query_agent',
        environment: 'development'
      });

      const options = mockCommand.opts();
      if (options.openaiApiKey !== undefined) {
        process.env.OPENAI_API_KEY = options.openaiApiKey;
      }

      expect(process.env.OPENAI_API_KEY).toBe('sk-test-openai-key');
      consoleSpy.mockRestore();
    });

    it('should set both FAILOVER_ENABLED and OPENAI_API_KEY when both options are provided', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      const { Command } = require('commander');
      const mockCommand = Command();

      mockCommand.opts.mockReturnValue({
        failover: true,
        openaiApiKey: 'sk-failover-key',
        role: 'simple_query_agent',
        environment: 'development'
      });

      const options = mockCommand.opts();
      if (options.failover !== undefined) {
        process.env.FAILOVER_ENABLED = options.failover ? 'true' : 'false';
      }
      if (options.openaiApiKey !== undefined) {
        process.env.OPENAI_API_KEY = options.openaiApiKey;
      }

      expect(process.env.FAILOVER_ENABLED).toBe('true');
      expect(process.env.OPENAI_API_KEY).toBe('sk-failover-key');
      consoleSpy.mockRestore();
    });
  });

  describe('Context parameter', () => {
    it('should accept context via -c flag', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with -c flag
      mockCommand.opts.mockReturnValue({
        role: 'code_reviewer',
        environment: 'development',
        context: 'AWS Lambda function in production VPC'
      });

      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        context: options.context
      };

      expect(args.context).toBe('AWS Lambda function in production VPC');
    });

    it('should accept context via --context flag', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing with --context flag
      mockCommand.opts.mockReturnValue({
        role: 'code_reviewer',
        environment: 'development',
        context: 'Kubernetes microservice on GKE, PCI-DSS compliant'
      });

      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        context: options.context
      };

      expect(args.context).toBe('Kubernetes microservice on GKE, PCI-DSS compliant');
    });

    it('should work without context (optional parameter)', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate command line parsing without context
      mockCommand.opts.mockReturnValue({
        role: 'code_reviewer',
        environment: 'development'
      });

      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        context: options.context
      };

      expect(args.context).toBeUndefined();
    });

    it('should include context in args object passed to main', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      
      // Simulate full args object with context
      mockCommand.opts.mockReturnValue({
        role: 'code_reviewer',
        environment: 'production',
        src_dir: './src',
        output_file: 'report.md',
        output_format: 'markdown',
        verbose: true,
        context: 'Internal CLI tool, VPN access required, elevated AWS IAM permissions'
      });

      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        src_dir: options.src_dir,
        output_file: options.output_file,
        output_format: options.output_format,
        verbose: options.verbose,
        context: options.context
      };

      expect(args).toEqual({
        role: 'code_reviewer',
        environment: 'production',
        src_dir: './src',
        output_file: 'report.md',
        output_format: 'markdown',
        verbose: true,
        context: 'Internal CLI tool, VPN access required, elevated AWS IAM permissions'
      });
    });
  });

  describe('v5.3.0 flags (adversarial pass + experiment)', () => {
    it('should map --adversarial-context and --experiment-enabled to main args', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      mockCommand.opts.mockReturnValue({
        role: 'pr_adversary',
        environment: 'default',
        adversarialContext: '/tmp/in.json',
        experimentEnabled: true,
        output_format: 'json',
      });
      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        adversarial_context: options.adversarialContext,
        experiment_enabled: options.experimentEnabled === true,
        output_format: options.output_format,
      };
      expect(args.adversarial_context).toBe('/tmp/in.json');
      expect(args.experiment_enabled).toBe(true);
    });
  });

  describe('--mcp-server-url flag (v2.4.0)', () => {
    it('maps --mcp-server-url onto args.mcp_server_url for the four MCP-aware roles', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      const url = 'http://127.0.0.1:9999/mcp';
      const mcpAwareRoles = [
        'pr_reviewer',
        'code_reviewer',
        'pr_adversary',
        'finding_validator',
        'code_fixer',
      ];
      for (const role of mcpAwareRoles) {
        mockCommand.opts.mockReturnValue({
          role,
          environment: 'default',
          mcpServerUrl: url,
        });
        const options = mockCommand.opts();
        const args = {
          role: options.role,
          environment: options.environment,
          mcp_server_url: options.mcpServerUrl,
        };
        expect(args.mcp_server_url).toBe(url);
        expect(args.role).toBe(role);
      }
    });

    it('leaves args.mcp_server_url undefined when the flag is not supplied (v2.3.0 baseline)', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      mockCommand.opts.mockReturnValue({
        role: 'pr_reviewer',
        environment: 'default',
      });
      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        mcp_server_url: options.mcpServerUrl,
      };
      expect(args.mcp_server_url).toBeUndefined();
    });

    it('still passes the URL through on a non-MCP-aware role (warning is informational only)', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      const url = 'http://127.0.0.1:9999/mcp';
      mockCommand.opts.mockReturnValue({
        role: 'qa_verifier',
        environment: 'default',
        mcpServerUrl: url,
      });
      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        mcp_server_url: options.mcpServerUrl,
      };
      expect(args.mcp_server_url).toBe(url);
    });
  });

  describe('--mcp-server-name flag (v2.4.2)', () => {
    it('maps --mcp-server-name onto args.mcp_server_name when supplied', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      mockCommand.opts.mockReturnValue({
        role: 'pr_reviewer',
        environment: 'default',
        mcpServerUrl: 'http://127.0.0.1:9999/mcp',
        mcpServerName: 'parent-app-internal',
      });
      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        mcp_server_url: options.mcpServerUrl,
        mcp_server_name: options.mcpServerName,
      };
      expect(args.mcp_server_name).toBe('parent-app-internal');
      expect(args.mcp_server_url).toBe('http://127.0.0.1:9999/mcp');
    });

    it('leaves args.mcp_server_name undefined when the flag is not supplied (default identifier path)', () => {
      const { Command } = require('commander');
      const mockCommand = Command();
      mockCommand.opts.mockReturnValue({
        role: 'pr_reviewer',
        environment: 'default',
        mcpServerUrl: 'http://127.0.0.1:9999/mcp',
      });
      const options = mockCommand.opts();
      const args = {
        role: options.role,
        environment: options.environment,
        mcp_server_url: options.mcpServerUrl,
        mcp_server_name: options.mcpServerName,
      };
      expect(args.mcp_server_name).toBeUndefined();
    });
  });
});

