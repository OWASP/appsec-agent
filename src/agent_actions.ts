/**
 * Agent Actions for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { query, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentOptions } from './agent_options';
import { ConfigDict } from './utils';

export interface AgentArgs {
  role: string;
  environment: string;
  src_dir?: string;
  output_file?: string;
  output_format?: string;
  verbose?: boolean;
}

export class AgentActions {
  private confDict: ConfigDict;
  private environment: string;
  private args: AgentArgs;

  constructor(confDict: ConfigDict, environment: string, args: AgentArgs) {
    this.confDict = confDict;
    this.environment = environment;
    this.args = args;
  }

  /**
   * Simple query agent with options
   */
  async simpleQueryClaudeWithOptions(yourPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment);
    const options = agentOptions.getSimpleQueryAgentOptions(this.args.role);

    try {
      let accumulatedText = '';
      let hasPrintedHeader = false;
      let hasSeenStreamEvents = false;
      let messageCount = 0;
      
      for await (const msg of query({ prompt: yourPrompt, options })) {
        messageCount++;
        
        // Debug logging (remove in production)
        if (this.args.verbose) {
          console.error(`[DEBUG] Message #${messageCount}: type=${(msg as any).type}`);
        }
        // Handle stream events (streaming deltas) - these come first
        if (msg.type === 'stream_event') {
          hasSeenStreamEvents = true;
          const streamMsg = msg as any;
          
          // Handle content block deltas (streaming text)
          if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
            const deltaText = streamMsg.event.delta.text || '';
            if (deltaText) {
              if (!hasPrintedHeader) {
                console.log(`\nClaude:\n`);
                hasPrintedHeader = true;
              }
              // Accumulate and write streaming deltas directly
              accumulatedText += deltaText;
              process.stdout.write(deltaText);
            }
          }
          // Handle content block start (beginning of new content block)
          else if (streamMsg.event?.type === 'content_block_start') {
            // Content block is starting - ensure header is printed
            if (!hasPrintedHeader) {
              console.log(`\nClaude:\n`);
              hasPrintedHeader = true;
            }
            // Reset accumulated text for new content block
            accumulatedText = '';
          }
          // Handle message stop (streaming is complete)
          else if (streamMsg.event?.type === 'message_stop') {
            // Message is complete - ensure we have a newline
            if (hasPrintedHeader && accumulatedText) {
              // Stream is done, newline will be added by result handler
            }
          }
        }
        // Handle assistant messages (complete messages) - only use if no stream events
        // Note: If we've seen stream events, the content was already printed incrementally
        else if (msg.type === 'assistant' && !hasSeenStreamEvents) {
          const assistantMsg = msg as SDKAssistantMessage;
          if (assistantMsg.message.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                const currentText = block.text || '';
                if (currentText.length > 0 && currentText !== accumulatedText) {
                  if (!hasPrintedHeader) {
                    console.log(`\nClaude:\n`);
                    hasPrintedHeader = true;
                  }
                  // Print the complete text only if it's different from what we've accumulated
                  console.log(currentText);
                  accumulatedText = currentText;
                }
              }
            }
          }
        }
        // If we see assistant message after stream events, ignore it (already printed)
        else if (msg.type === 'assistant' && hasSeenStreamEvents) {
          // Already printed via stream events, skip
          if (this.args.verbose) {
            console.error(`[DEBUG] Skipping assistant message (already printed via stream events)`);
          }
        }
        // Handle result messages
        else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;
          // Ensure we flush any partial output and add newline
          if (hasPrintedHeader) {
            console.log(); // New line after final output
          }
          
          // Check for errors in result messages
          if (resultMsg.is_error) {
            const errorMsg = (resultMsg as any).errors?.[0] || (resultMsg as any).error_message || 'Unknown error occurred';
            console.error(`\nError: ${errorMsg}`);
            if (resultMsg.subtype) {
              console.error(`Error subtype: ${resultMsg.subtype}`);
            }
            // Log max_turns error specifically
            if (resultMsg.subtype === 'error_max_turns') {
              console.error(`\nNote: The conversation stopped because max_turns (${options.maxTurns || 1}) was reached.`);
              console.error(`To allow the agent to use tools and continue, increase max_turns in the configuration or use the code_reviewer role.`);
            }
          } else if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
            console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
          }
          
          // Debug: log turn count
          if (this.args.verbose) {
            console.error(`[DEBUG] Result: num_turns=${resultMsg.num_turns}, is_error=${resultMsg.is_error}`);
          }
        }
        // Handle tool progress messages (agent might be using tools)
        else if (msg.type === 'tool_progress') {
          // Tool is being executed - this is normal, just continue
          if (this.args.verbose) {
            const toolMsg = msg as any;
            console.log(`[Tool Progress] ${toolMsg.tool_name}: ${toolMsg.elapsed_time_seconds}s`);
          }
        }
        // Log other message types for debugging
        else if (this.args.verbose) {
          console.log(`[DEBUG] Received message type: ${(msg as any).type}`);
        }
      }
      
      // Debug: log total messages processed
      if (this.args.verbose) {
        console.error(`[DEBUG] Total messages processed: ${messageCount}`);
      }
    } catch (error) {
      console.error('Error during query:', error);
      throw error;
    }
    console.log();
    return '';
  }

  /**
   * Secure code reviewer with options
   */
  async codeReviewerWithOptions(userPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment);
    const options = agentOptions.getCodeReviewerOptions(this.args.role);

    try {
      for await (const message of query({ prompt: userPrompt, options })) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SDKAssistantMessage;
          if (assistantMsg.message.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                console.log(`Claude: ${block.text}`);
              }
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
            console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
          }
        }
      }
    } catch (error) {
      console.error('Error during code review:', error);
      throw error;
    }
    console.log();
    return '';
  }

  /**
   * Threat modeler agent with options
   */
  async threatModelerAgentWithOptions(userPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment);
    const options = agentOptions.getThreatModelerOptions(this.args.role);

    try {
      for await (const message of query({ prompt: userPrompt, options })) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SDKAssistantMessage;
          if (assistantMsg.message.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                console.log(`Claude: ${block.text}`);
              }
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
            console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
          }
        }
      }
    } catch (error) {
      console.error('Error during threat modeling:', error);
      throw error;
    }
    console.log();
    return '';
  }
}


