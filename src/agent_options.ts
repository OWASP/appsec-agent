/**
 * Agent Options Management for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { Options, AgentDefinition, PermissionResult, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { ConfigDict } from './utils';
import { SECURITY_REPORT_SCHEMA } from './schemas/security_report';

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

  constructor(confDict: ConfigDict, environment: string, model: string = 'sonnet') {
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
    const systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review. List out all the potential security and privacy issues found in the code.';

    const options: Options = {
      agents: {
        'code-reviewer': {
          description: 'Reviews code for best practices and potential security issues only',
          prompt: systemPrompt,
          tools: ['Read', 'Grep', 'Write'],
          model: this.model
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
   */
  getThreatModelerOptions(role: string = 'threat_modeler'): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing risk assessment on the source code repository for SOC2 type 2 compliance audit using the STRIDE methodology.';

    return {
      agents: {
        'threat-modeler': {
          description: 'Performs threat modeling and risk assessment using STRIDE methodology',
          prompt: systemPrompt,
          tools: ['Read', 'Grep', 'Write', 'Graphviz'],
          model: this.model
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };
  }

  /**
   * Get options for PR diff-focused code reviewer
   * This mode analyzes only the changed code from a pull request,
   * with access to Read and Write tools for additional context if needed.
   * @param role - The role configuration key
   * @param srcDir - Optional source directory path
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getDiffReviewerOptions(role: string = 'code_reviewer', srcDir?: string | null, outputFormat?: string): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    
    let systemPrompt = `You are an Application Security (AppSec) expert assistant specializing in Pull Request security reviews.

Your task is to analyze ONLY the changed code provided in the diff context. The changes have already been extracted and formatted for you - you do not need to search for files.

When reviewing PR changes:
1. Focus exclusively on the security implications of the new or modified code
2. Consider how the changes interact with existing code (when imports/context is provided)
3. Identify vulnerabilities introduced by the changes
4. Do NOT report issues in unchanged code
5. Cite specific line numbers from the provided diff

You have access to Read and Write tools if you need to:
- Read a full file for additional context (use sparingly)
- Write the security review report`;

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}`;
    }

    // Allow role config to override the system prompt
    if (roleConfig?.options?.diff_reviewer_system_prompt) {
      systemPrompt = roleConfig.options.diff_reviewer_system_prompt;
    }

    const options: Options = {
      agents: {
        'diff-reviewer': {
          description: 'Reviews PR diff changes for security vulnerabilities',
          prompt: systemPrompt,
          tools: ['Read', 'Write'],
          model: this.model
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
}

