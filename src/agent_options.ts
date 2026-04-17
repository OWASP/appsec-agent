/**
 * Agent Options Management for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { Options, AgentDefinition, PermissionResult, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { ConfigDict } from './utils';
import { SECURITY_REPORT_SCHEMA } from './schemas/security_report';
import { THREAT_MODEL_REPORT_SCHEMA } from './schemas/threat_model_report';
import { FIX_OUTPUT_SCHEMA } from './schemas/security_fix';
import { QA_VERDICT_SCHEMA } from './schemas/qa_context';
import { RETEST_VERDICT_SCHEMA } from './schemas/finding_validator';
import { CONTEXT_EXTRACTION_SCHEMA } from './schemas/context_extraction';

const FIX_CODE_VS_OPTIONS_GUIDANCE = `

FIXED CODE vs FIX OPTIONS:
- Use "fixed_code" ONLY for executable, compilable code that directly replaces the vulnerable code_snippet.
  Never put comments, recommendations, or "Option 1: ..." text into fixed_code.
- Use "fix_options" when the fix requires architectural decisions, domain-specific knowledge,
  or when multiple valid remediation approaches exist. Each option needs an id, title, and description.
- Provide either fixed_code OR fix_options per finding, not both.`;

export interface ToolUsageLog {
  tool: string;
  input: any;
  suggestions: string;
}

export class AgentOptions {
  private confDict: ConfigDict;
  private environment: string;
  private model: string;
  private toolUsageLog: ToolUsageLog[] = [];

  constructor(confDict: ConfigDict, environment: string, model: string = 'opus') {
    this.confDict = confDict;
    this.environment = environment;
    this.model = model;
  }

  /**
   * Get a copy of the tool usage log
   * @returns A copy of the tool usage log array
   */
  getToolUsageLog(): ToolUsageLog[] {
    return [...this.toolUsageLog];
  }

  /**
   * Clear the tool usage log
   */
  clearToolUsageLog(): void {
    this.toolUsageLog = [];
  }

  /**
   * Tool permission callback to control tool access
   */
  toolPermissionCallback: CanUseTool = async (
    toolName: string,
    inputData: Record<string, unknown>,
    options
  ): Promise<PermissionResult> => {
    // Log the tool request
    this.toolUsageLog.push({
      tool: toolName,
      input: inputData,
      suggestions: options.suggestions ? JSON.stringify(options.suggestions) : ''
    });

    console.log(`\n🔧 Tool Permission Request: ${toolName}`);
    console.log(`   Input: ${JSON.stringify(inputData, null, 2)}`);
    if (options.suggestions) {
      console.log(`   Suggestions: ${JSON.stringify(options.suggestions)}`);
    }
    console.log();

    // Auto-approve all tools
    return { behavior: 'allow', updatedInput: inputData };
  }

  /**
   * Get options for simple query agent
   */
  getSimpleQueryAgentOptions(role: string = 'simple_query_agent', srcDir?: string | null): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for providing security advice and guidance to the user.';
    
    // Add source directory context to system prompt if provided
    if (srcDir) {
      systemPrompt += ` You have access to a source code directory at ${srcDir} that you can search and read files from to answer questions.`;
    }
    
    return {
      systemPrompt: systemPrompt,
      maxTurns: roleConfig?.options?.max_turns || 1
    };
  }

  /**
   * Get options for security code reviewer
   * @param role - The role configuration key
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getCodeReviewerOptions(role: string = 'code_reviewer', outputFormat?: string): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review. List out all the potential security and privacy issues found in the code.';

    if (outputFormat?.toLowerCase() === 'json') {
      systemPrompt += FIX_CODE_VS_OPTIONS_GUIDANCE;
    }

    const resolvedMaxTurns = roleConfig?.options?.max_turns ?? 30;

    const options: Options = {
      agents: {
        'code-reviewer': {
          description: 'Reviews code for best practices and potential security issues only',
          prompt: systemPrompt,
          tools: ['Read', 'Grep', 'Write'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };

    // Add JSON schema enforcement when output format is JSON
    if (outputFormat?.toLowerCase() === 'json') {
      options.outputFormat = {
        type: 'json_schema',
        schema: SECURITY_REPORT_SCHEMA
      };
    }

    return options;
  }

  /**
   * Get options for threat modeler
   * @param role - The role configuration key
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getThreatModelerOptions(role: string = 'threat_modeler', outputFormat?: string): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing risk assessment on the source code repository for SOC2 type 2 compliance audit using the STRIDE methodology.';

    const isJson = outputFormat?.toLowerCase() === 'json';

    const resolvedMaxTurns = roleConfig?.options?.max_turns ?? 20;

    const options: Options = {
      agents: {
        'threat-modeler': {
          description: 'Performs threat modeling and risk assessment using STRIDE methodology',
          prompt: systemPrompt,
          tools: isJson ? ['Read', 'Grep'] : ['Read', 'Grep', 'Write', 'Graphviz'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };

    if (isJson) {
      options.outputFormat = {
        type: 'json_schema',
        schema: THREAT_MODEL_REPORT_SCHEMA
      };
    }

    return options;
  }

  /**
   * Get options for PR diff-focused code reviewer
   * This mode analyzes only the changed code from a pull request,
   * with access to Read and Write tools for additional context if needed.
   * @param role - The role configuration key
   * @param srcDir - Optional source directory path
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getDiffReviewerOptions(role: string = 'code_reviewer', srcDir?: string | null, outputFormat?: string, maxTurns?: number, noTools?: boolean): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    
    let systemPrompt: string;

    if (noTools) {
      systemPrompt = `You are an Application Security (AppSec) expert assistant specializing in Pull Request security reviews.

Your task is to analyze the changed code provided in the diff context for security vulnerabilities.

The diff context already includes relevant imports, function signatures, and surrounding code for each changed file. Produce your complete security review report directly from this provided context.

Context that should reduce or eliminate false positives:
- TypeScript strict mode and strong typing (e.g., numeric params can't be SQL-injected)
- ORM usage with parameterized queries (Prisma, TypeORM, Sequelize, Knex, Drizzle)
- Security middleware (helmet, csurf, express-rate-limit, cors)
- Input validation libraries (zod, joi, class-validator)
- Framework-provided protections (React auto-escapes JSX, Next.js built-in CSRF)

When reviewing PR changes:
1. Focus on security implications of the new or modified code
2. Consider whether the surrounding context (imports, function signatures) suggests mitigations
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Rate your confidence (high/medium/low) for each finding`;
    } else {
      systemPrompt = `You are an Application Security (AppSec) expert assistant specializing in Pull Request security reviews.

Your task is to analyze the changed code provided in the diff context for security vulnerabilities.

IMPORTANT: Before reporting a finding, verify it by gathering additional context:
- Use Grep to search for sanitization functions, middleware, validation logic, or security configurations that may mitigate the issue
- Use Read to inspect imported modules, utility functions, or configuration files referenced in the diff
- Check if the project uses an ORM (parameterized queries), security headers (helmet), input validation (zod/joi), or auth middleware

Context that should reduce or eliminate false positives:
- TypeScript strict mode and strong typing (e.g., numeric params can't be SQL-injected)
- ORM usage with parameterized queries (Prisma, TypeORM, Sequelize, Knex, Drizzle)
- Security middleware (helmet, csurf, express-rate-limit, cors)
- Input validation libraries (zod, joi, class-validator)
- Framework-provided protections (React auto-escapes JSX, Next.js built-in CSRF)

When reviewing PR changes:
1. Focus on security implications of the new or modified code
2. VERIFY findings by reading referenced files before reporting them
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Rate your confidence (high/medium/low) for each finding

You have access to Read, Grep, and Write tools:
- Grep: Search the codebase for patterns (e.g., function definitions, middleware, configs)
- Read: Read full file contents for additional context
- Write: Write the security review report`;
    }

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}`;
    }

    // Allow role config to override the system prompt
    if (roleConfig?.options?.diff_reviewer_system_prompt) {
      systemPrompt = roleConfig.options.diff_reviewer_system_prompt;
    }

    if (outputFormat?.toLowerCase() === 'json') {
      systemPrompt += FIX_CODE_VS_OPTIONS_GUIDANCE;
    }

    const resolvedMaxTurns = maxTurns
      ?? roleConfig?.options?.max_turns
      ?? 10;

    const options: Options = {
      agents: {
        'diff-reviewer': {
          description: 'Reviews PR diff changes for security vulnerabilities',
          prompt: systemPrompt,
          tools: noTools ? ['Write'] : ['Read', 'Grep', 'Write'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };

    // Add JSON schema enforcement when output format is JSON
    if (outputFormat?.toLowerCase() === 'json') {
      options.outputFormat = {
        type: 'json_schema',
        schema: SECURITY_REPORT_SCHEMA
      };
    }

    return options;
  }

  /**
   * Get options for code fixer agent
   * Uses structured JSON output to guarantee a well-formed fix response.
   * Has Read and Grep tools to explore the source directory for additional context.
   * @param role - The role configuration key
   * @param srcDir - Optional source directory path for additional context
   */
  getCodeFixerOptions(role: string = 'code_fixer', srcDir?: string | null): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt = roleConfig?.options?.system_prompt ||
      'You are an expert security engineer specializing in fixing vulnerabilities in code. ' +
      'You receive a finding with code context and must produce a precise, minimal fix that resolves ' +
      'the security issue while preserving the original code\'s functionality and indentation. ' +
      'Only modify the affected lines. Always use the recommended secure alternatives when applicable.';

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}. You may read files for additional context if needed.`;
    }

    const resolvedMaxTurns = roleConfig?.options?.max_turns ?? 10;

    const options: Options = {
      agents: {
        'code-fixer': {
          description: 'Generates precise security fixes for code vulnerabilities',
          prompt: systemPrompt,
          tools: ['Read', 'Grep'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: FIX_OUTPUT_SCHEMA
      }
    };

    return options;
  }

  /**
   * Get options for the QA verifier agent
   * Uses Read, Grep, and Bash tools for test execution and analysis
   */
  getQaVerifierOptions(role: string = 'qa_verifier', srcDir?: string | null): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt = roleConfig?.options?.system_prompt ||
      'You are a QA verification engineer. Your task is to verify security fixes by running the project\'s test suite ' +
      'and analyzing the results. You have access to the project source code and can execute shell commands to run tests. ' +
      'First, set up the environment (install dependencies if needed), then run the test suite. ' +
      'If tests fail, analyze the failures to determine if they are caused by the security fix or are pre-existing issues. ' +
      'Provide a structured verdict with pass/fail status, failure details, and actionable suggestions.';

    if (srcDir) {
      systemPrompt += `\n\nProject source code is available at: ${srcDir}. Use Read and Grep to inspect files, and Bash to execute commands.`;
    }

    const resolvedMaxTurns = roleConfig?.options?.max_turns ?? 15;

    const options: Options = {
      agents: {
        'qa-verifier': {
          description: 'Verifies security fixes by running project tests and analyzing results',
          prompt: systemPrompt,
          tools: ['Read', 'Grep', 'Bash'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: QA_VERDICT_SCHEMA
      }
    };

    return options;
  }

  /**
   * Get options for the finding validator agent
   * Uses Read and Grep tools (read-only) to analyze code for vulnerability presence.
   */
  getContextExtractorOptions(role: string = 'context_extractor'): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt = roleConfig?.options?.system_prompt ||
      'You are a security-aware software analyst. Your task is to analyze repository files and metadata ' +
      'to extract structured intelligence about a project. Focus on accuracy and specificity. ' +
      'For security_context, list concrete library names and mechanisms (e.g., "bcrypt for password hashing", ' +
      '"Django ORM with parameterized queries"). For developer_context, include ONLY security-relevant guidance ' +
      '(PHI handling, SQL injection rules, auth patterns, compliance requirements) — exclude generic coding style, ' +
      'formatting, naming conventions, and UI/component patterns. For suggested_exclusions, carefully study the ' +
      'repository tree structure at ALL nesting depths to identify directories containing non-production code: ' +
      'generated/compiled output, vendored copies, migrations, seed data, visual assets, log/temp/runtime dirs ' +
      '(logs, uploads, work-dir, data), IDE config (.cursor, .vscode), utility scripts, and documentation. Use ' +
      'specific paths from the tree (e.g., "backend/scripts/**" not just "scripts/**"). Only suggest patterns NOT ' +
      'already in the standard preset. If a field has no relevant information, return an empty string.';

    const options: Options = {
      agents: {
        'context-extractor': {
          description: 'Extracts structured project intelligence from repository files',
          prompt: systemPrompt,
          tools: [],
          model: this.model,
          maxTurns: 1,
        } as AgentDefinition,
      },
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: CONTEXT_EXTRACTION_SCHEMA,
      },
    };

    return options;
  }

  getFindingValidatorOptions(role: string = 'finding_validator', srcDir?: string | null): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt = roleConfig?.options?.system_prompt ||
      'You are a security expert specializing in vulnerability validation. ' +
      'Your task is to analyze code and determine whether a previously detected security vulnerability ' +
      'is still present. Examine the provided code carefully, considering the original finding details, ' +
      'and return a structured verdict with your assessment.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to inspect files for additional context if needed.`;
    }

    const resolvedMaxTurns = roleConfig?.options?.max_turns ?? 5;

    const options: Options = {
      agents: {
        'finding-validator': {
          description: 'Validates whether a previously detected security vulnerability is still present in code',
          prompt: systemPrompt,
          tools: ['Read', 'Grep'],
          model: this.model,
          maxTurns: resolvedMaxTurns
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions',
      outputFormat: {
        type: 'json_schema',
        schema: RETEST_VERDICT_SCHEMA
      }
    };

    return options;
  }
}

