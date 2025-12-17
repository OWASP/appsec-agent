/**
 * Agent Options Management for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { Options, AgentDefinition, PermissionResult, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { ConfigDict } from './utils';

export interface ToolUsageLog {
  tool: string;
  input: any;
  suggestions: string;
}

export class AgentOptions {
  private confDict: ConfigDict;
  private environment: string;
  private toolUsageLog: ToolUsageLog[] = [];

  constructor(confDict: ConfigDict, environment: string) {
    this.confDict = confDict;
    this.environment = environment;
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
   */
  getCodeReviewerOptions(role: string = 'code_reviewer'): Options {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt = roleConfig?.options?.system_prompt || 
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review. List out all the potential security and privacy issues found in the code.';

    return {
      agents: {
        'code-reviewer': {
          description: 'Reviews code for best practices and potential security issues only',
          prompt: systemPrompt,
          tools: ['Read', 'Grep', 'Write'],
          model: 'sonnet'
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };
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
          model: 'sonnet'
        } as AgentDefinition
      },
      permissionMode: 'bypassPermissions'
    };
  }
}

