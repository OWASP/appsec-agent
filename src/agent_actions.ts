/**
 * Agent Actions for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { query, SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentOptions } from './agent_options';
import { ConfigDict } from './utils';
import { BlinkingCursor } from './blinking_cursor';

export interface AgentArgs {
  role: string;
  environment: string;
  src_dir?: string;
  output_file?: string;
  output_format?: string;
  verbose?: boolean;
  context?: string;  // User-provided context for code review
  diff_context?: string; // Path to JSON file with diff context for PR-focused review
  model?: string;  // Claude model selection: sonnet, opus, haiku
}

interface ConversationEntry {
  role: 'user' | 'assistant';
  content: string;
}

export class AgentActions {
  private confDict: ConfigDict;
  private environment: string;
  private args: AgentArgs;
  private conversationHistory: ConversationEntry[] = []; // Store conversation history for simple_query_agent
  constructor(confDict: ConfigDict, environment: string, args: AgentArgs) {
    this.confDict = confDict;
    this.environment = environment;
    this.args = args;
  }

  /**
   * Simple query agent with options
   */
  async simpleQueryClaudeWithOptions(yourPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getSimpleQueryAgentOptions(this.args.role, srcDir);
    
    // Build prompt with conversation history and source directory context
    const sourceDirContext = srcDir 
      ? `\n\nContext: There is a source code directory available at ${srcDir}. You can search and read files within this directory to answer questions. The directory is located in the current working directory.\n`
      : '';
    
    let fullPrompt: string;
    if (this.conversationHistory.length > 0) {
      const contextPrompt = this.conversationHistory
        .map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}: ${entry.content}`)
        .join('\n');
      fullPrompt = `Previous conversation:\n${contextPrompt}${sourceDirContext}User: ${yourPrompt}`;
    } else {
      fullPrompt = `${sourceDirContext}${yourPrompt}`;
    }

    const cursor = new BlinkingCursor();
    let cursorStopped = false;
    const stopCursor = () => {
      if (!cursorStopped) {
        cursor.stop();
        cursorStopped = true;
      }
    };

    let accumulatedText = '';
    let hasPrintedHeader = false;
    let hasSeenStreamEvents = false;
    let assistantResponseText = '';
    let finalResult: SDKResultMessage | null = null;

    const printHeader = () => {
      if (!hasPrintedHeader) {
        console.log(`\nClaude:\n`);
        hasPrintedHeader = true;
      }
    };

    try {
      cursor.start();

      for await (const msg of query({ prompt: fullPrompt, options })) {
        if (this.args.verbose) {
          console.error(`[DEBUG] Message type: ${(msg as any).type}`);
        }

        if (msg.type === 'stream_event') {
          hasSeenStreamEvents = true;
          stopCursor();
          const streamMsg = msg as any;
          
          if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
            const deltaText = streamMsg.event.delta.text || '';
            if (deltaText) {
              printHeader();
              accumulatedText += deltaText;
              assistantResponseText += deltaText;
              process.stdout.write(deltaText);
            }
          } else if (streamMsg.event?.type === 'content_block_start') {
            printHeader();
          } else if (this.args.verbose && streamMsg.event?.type !== 'message_stop') {
            console.error(`[DEBUG] Unhandled stream event type: ${streamMsg.event?.type}`);
          }
        } else if (msg.type === 'assistant') {
          stopCursor();
          const assistantMsg = msg as SDKAssistantMessage;
          for (const block of assistantMsg.message.content || []) {
            if (block.type === 'text' && block.text) {
              const currentText = block.text;
              if (!hasSeenStreamEvents) {
                // No streaming - print the complete message
                printHeader();
                console.log(currentText);
                accumulatedText = currentText;
                assistantResponseText = currentText;
              } else if (currentText.length > accumulatedText.length) {
                // Print only new content not yet streamed
                const newText = currentText.startsWith(accumulatedText)
                  ? currentText.slice(accumulatedText.length)
                  : currentText; // Fallback: print entire text if mismatch
                if (newText) {
                  process.stdout.write(newText);
                  accumulatedText = currentText;
                  assistantResponseText = currentText;
                }
              }
            }
          }
        } else if (msg.type === 'result') {
          stopCursor();
          finalResult = msg as SDKResultMessage;
          if (finalResult.is_error) {
            const errorMsg = (finalResult as any).errors?.[0] || (finalResult as any).error_message || 'Unknown error occurred';
            console.error(`\nError: ${errorMsg}`);
            if (finalResult.subtype) {
              console.error(`Error subtype: ${finalResult.subtype}`);
            }
            if (finalResult.subtype === 'error_max_turns') {
              console.error(`\nNote: The conversation stopped because max_turns (${options.maxTurns || 1}) was reached.`);
              console.error(`To allow the agent to use tools and continue, increase max_turns in the configuration or use the code_reviewer role.`);
            }
          }
          if (this.args.verbose) {
            console.error(`[DEBUG] Result: num_turns=${finalResult.num_turns}, is_error=${finalResult.is_error}`);
          }
        } else if (msg.type === 'tool_progress') {
          if (this.args.verbose) {
            const toolMsg = msg as any;
            console.log(`[Tool Progress] ${toolMsg.tool_name}: ${toolMsg.elapsed_time_seconds}s`);
          }
        } else if (this.args.verbose) {
          console.error(`[DEBUG] Unknown message type: ${(msg as any).type}`);
        }
      }
    } finally {
      stopCursor();
    }

    // Flush stdout writes
    await new Promise<void>(resolve => setImmediate(resolve));
    
    // Display final result
    if (finalResult) {
      if (hasPrintedHeader) {
        console.log();
      }
      if (!finalResult.is_error && finalResult.total_cost_usd && finalResult.total_cost_usd > 0) {
        console.log(`\nCost: $${finalResult.total_cost_usd.toFixed(4)}`);
      }
    }

    // Store conversation history
    this.conversationHistory.push({ role: 'user', content: yourPrompt });
    if (assistantResponseText) {
      this.conversationHistory.push({ role: 'assistant', content: assistantResponseText });
    }

    console.log();
    return '';
  }

  /**
   * Secure code reviewer with options
   */
  async codeReviewerWithOptions(userPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getCodeReviewerOptions(this.args.role);

    // Declare cursor outside try block so it's accessible in catch
    let cursor: BlinkingCursor | null = null;

    try {
      // Start blinking cursor to show we're waiting for Claude's response
      cursor = new BlinkingCursor();
      cursor.start();

      try {
        for await (const message of query({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            // Stop cursor when we receive stream events
            if (cursor) cursor.stop();
            const streamMsg = message as any;
            // Handle content block deltas (streaming text)
            if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
              const deltaText = streamMsg.event.delta.text || '';
              if (deltaText) {
                process.stdout.write(deltaText);
              }
            }
          } else if (message.type === 'assistant') {
            // Stop cursor when we receive assistant message
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            // Stop cursor when we receive result (in case no content was received)
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        // Always stop the cursor when done, even if there's an error
        if (cursor) cursor.stop();
      }
    } catch (error) {
      // Ensure cursor is stopped on error
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
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
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getThreatModelerOptions(this.args.role);
    // Declare cursor outside try block so it's accessible in catch
    let cursor: BlinkingCursor | null = null;
    try {
      // Start blinking cursor to show we're waiting for Claude's response
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of query({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            // Stop cursor when we receive stream events
            if (cursor) cursor.stop();
            const streamMsg = message as any;
            // Handle content block deltas (streaming text)
            if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
              const deltaText = streamMsg.event.delta.text || '';
              if (deltaText) {
                process.stdout.write(deltaText);
              }
            }
          } else if (message.type === 'assistant') {
            // Stop cursor when we receive assistant message
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            // Stop cursor when we receive result (in case no content was received)
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        // Always stop the cursor when done, even if there's an error
        if (cursor) cursor.stop();
      }
    } catch (error) {
      // Ensure cursor is stopped on error
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during threat modeling:', error);
      throw error;
    }
    console.log();
    return '';
  }

  /**
   * PR diff-focused code reviewer with options
   * Optimized for reviewing only changed code from a pull request
   */
  async diffReviewerWithOptions(userPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getDiffReviewerOptions(this.args.role, srcDir);

    // Declare cursor outside try block so it's accessible in catch
    let cursor: BlinkingCursor | null = null;

    try {
      // Start blinking cursor to show we're waiting for Claude's response
      cursor = new BlinkingCursor();
      cursor.start();

      try {
        for await (const message of query({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            // Stop cursor when we receive stream events
            if (cursor) cursor.stop();
            const streamMsg = message as any;
            // Handle content block deltas (streaming text)
            if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
              const deltaText = streamMsg.event.delta.text || '';
              if (deltaText) {
                process.stdout.write(deltaText);
              }
            }
          } else if (message.type === 'assistant') {
            // Stop cursor when we receive assistant message
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            // Stop cursor when we receive result (in case no content was received)
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        // Always stop the cursor when done, even if there's an error
        if (cursor) cursor.stop();
      }
    } catch (error) {
      // Ensure cursor is stopped on error
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during PR diff code review:', error);
      throw error;
    }
    console.log();
    return '';
  }
}


