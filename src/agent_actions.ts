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
    const agentOptions = new AgentOptions(this.confDict, this.environment);
    const options = agentOptions.getSimpleQueryAgentOptions(this.args.role, srcDir);

    // Build prompt with conversation history and source directory context
    let fullPrompt: string;
    let sourceDirContext = '';
    
    // Add source directory context if provided
    if (srcDir) {
      sourceDirContext = `\n\nContext: There is a source code directory available at ${srcDir}. You can search and read files within this directory to answer questions. The directory is located in the current working directory.\n`;
    }
    
    if (this.conversationHistory.length > 0) {
      // Include previous conversation context
      let contextPrompt = 'Previous conversation:\n';
      for (const entry of this.conversationHistory) {
        if (entry.role === 'user') {
          contextPrompt += `User: ${entry.content}\n`;
        } else {
          contextPrompt += `Assistant: ${entry.content}\n`;
        }
      }
      fullPrompt = `${contextPrompt}${sourceDirContext}User: ${yourPrompt}`;
    } else {
      fullPrompt = `${sourceDirContext}${yourPrompt}`;
    }

    try {
      let accumulatedText = '';
      let hasPrintedHeader = false;
      let hasSeenStreamEvents = false;
      let messageCount = 0;
      let assistantResponseText = '';
      let finalResult: SDKResultMessage | null = null;
      
      for await (const msg of query({ prompt: fullPrompt, options })) {
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
              assistantResponseText += deltaText;
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
            // Don't reset accumulatedText here - we want to accumulate ALL text across all blocks
            // Only reset if this is truly a new message (but we can't tell that here)
            // Actually, we should keep accumulating to get the full response
          }
          // Handle message stop (one message/turn is complete, but stream may continue)
          else if (streamMsg.event?.type === 'message_stop') {
            // One message is complete, but the stream may continue with more messages
            // (e.g., after tools execute). Don't treat this as stream end.
            if (hasPrintedHeader && accumulatedText) {
              // This message is done, but more may come
            }
          }
          // Handle other stream event types we might not be handling
          else if (this.args.verbose) {
            console.error(`[DEBUG] Unhandled stream event type: ${streamMsg.event?.type}`);
          }
        }
        // Handle assistant messages (complete messages) - only use if no stream events
        // Note: If we've seen stream events, the content was already printed incrementally
        // BUT: When tools are used, there may be more assistant messages after tools complete
        // So we need to handle both cases
        else if (msg.type === 'assistant') {
          const assistantMsg = msg as SDKAssistantMessage;
          if (assistantMsg.message.content) {
            for (const block of assistantMsg.message.content) {
              if (block.type === 'text') {
                const currentText = block.text || '';
                if (currentText && currentText.length > 0) {
                  // If we haven't seen stream events, print the complete message
                  if (!hasSeenStreamEvents) {
                    if (!hasPrintedHeader) {
                      console.log(`\nClaude:\n`);
                      hasPrintedHeader = true;
                    }
                    console.log(currentText);
                    accumulatedText = currentText;
                    assistantResponseText = currentText;
                  } else {
                    // If we've seen stream events, this might be additional content after tools
                    // Check if this is new content not already accumulated
                    if (!currentText.startsWith(accumulatedText) && currentText !== accumulatedText) {
                      // This is additional content (e.g., after tools complete)
                      const newText = currentText.slice(accumulatedText.length);
                      if (newText) {
                        process.stdout.write(newText);
                        accumulatedText = currentText;
                        assistantResponseText = currentText;
                      }
                    } else if (currentText.length > accumulatedText.length) {
                      // More content than we've accumulated
                      const newText = currentText.slice(accumulatedText.length);
                      if (newText) {
                        process.stdout.write(newText);
                        accumulatedText = currentText;
                        assistantResponseText = currentText;
                      }
                    }
                  }
                }
              }
            }
          }
        }
        // Handle result messages - collect but don't display until stream completes
        // IMPORTANT: The stream may continue after a result message if tools are being used
        // We must continue processing until the stream is truly exhausted
        else if (msg.type === 'result') {
          const resultMsg = msg as SDKResultMessage;
          // Always update finalResult with the latest result message
          // (there may be multiple result messages if tools are used)
          finalResult = resultMsg;
          
          // Check for errors in result messages - display errors immediately
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
          }
          
          // Debug: log turn count and continue processing (stream may not be done yet)
          if (this.args.verbose) {
            console.error(`[DEBUG] Result: num_turns=${resultMsg.num_turns}, is_error=${resultMsg.is_error}`);
            console.error(`[DEBUG] Continuing to process stream (may have more messages after tools)`);
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
        // Log other message types - always log to help debug issues
        else {
          // Unknown message type - log it to help debug
          if (this.args.verbose) {
            console.error(`[DEBUG] Received unknown message type: ${(msg as any).type}`);
            console.error(`[DEBUG] Message content:`, JSON.stringify(msg, null, 2));
          }
        }
      }
      
      // Debug: log total messages processed
      if (this.args.verbose) {
        console.error(`[DEBUG] Total messages processed: ${messageCount}`);
      }
      
      // Now that the stream is complete, ensure all stdout writes are flushed
      // Use multiple setImmediate calls to ensure the event loop processes all pending writes
      // This is critical when using process.stdout.write() for streaming
      await new Promise<void>(resolve => setImmediate(resolve));
      await new Promise<void>(resolve => setImmediate(resolve));
      
      // Now that the stream is complete, display the final result (cost, etc.)
      if (finalResult) {
        // Ensure we flush any partial output and add newline
        if (hasPrintedHeader) {
          console.log(); // New line after final output
        }
        
        // Display cost only after stream is completely done
        if (!finalResult.is_error && finalResult.total_cost_usd && finalResult.total_cost_usd > 0) {
          console.log(`\nCost: $${finalResult.total_cost_usd.toFixed(4)}`);
        }
      }
      
      // One more flush to ensure cost is written before returning
      await new Promise<void>(resolve => setImmediate(resolve));
      
      // Store the current exchange in conversation history
      this.conversationHistory.push({ role: 'user', content: yourPrompt });
      if (assistantResponseText) {
        this.conversationHistory.push({ role: 'assistant', content: assistantResponseText });
      }
    } catch (error) {
      console.error('Error during query:', error);
      throw error;
    }
    // Add newline for spacing after response (matching Python version)
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


