/**
 * Agent Actions for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { SDKAssistantMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { AgentOptions } from './agent_options';
import { llmQuery } from './llm_query';
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
  fix_context?: string;  // Path to JSON file with fix context for code_fixer role
  qa_context?: string;   // Path to JSON file with QA context for qa_verifier role
  retest_context?: string; // Path to JSON file with retest context for finding_validator role
  extract_context?: string; // Path to JSON file with extraction context for context_extractor role
  /** v5.3.0: candidate findings JSON for pr_adversary second pass (sast-ai `adversarialPassService`) */
  adversarial_context?: string;
  /** v5.4.0 / plan §3.1 Stage B: import-graph reachability summary JSON (pr_reviewer only). */
  import_graph_context?: string;
  /** A/B: treatment arm for pr_reviewer (stricter false-positive instructions). */
  experiment_enabled?: boolean;
  model?: string;  // Claude model selection: sonnet, opus, haiku
  // PR diff chunking (optional; 0 or omit = no chunking)
  diff_max_tokens_per_batch?: number;
  diff_max_batches?: number;
  diff_max_files?: number;
  diff_exclude?: string[];  // Path patterns to exclude from diff review
  max_turns?: number;  // Override per-role maxTurns (adaptive tool budget)
  no_tools?: boolean;  // Disable Read/Grep tools for single-turn focused-context analysis
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

      for await (const msg of llmQuery({ prompt: fullPrompt, options })) {
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
    const options = agentOptions.getCodeReviewerOptions(this.args.role, this.args.output_format);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';
    let hadSuccessfulRun = false;
    let apiCostUsd = 0;

    try {
      // Start blinking cursor to show we're waiting for Claude's response
      cursor = new BlinkingCursor();
      cursor.start();

      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
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
            
            // Track API cost for potential fallback report
            // Consider it a successful run if we got cost, even if is_error is set
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              apiCostUsd = resultMsg.total_cost_usd;
              hadSuccessfulRun = true;
            }
            
            // Log if is_error is set despite having output
            if (resultMsg.is_error && apiCostUsd > 0) {
              console.log(`[Warning] SDK reported is_error=true despite successful API usage ($${apiCostUsd.toFixed(4)})`);
            }
            
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
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
    
    // Fallback: If agent completed successfully but didn't return structured output,
    // generate an empty report to avoid "No report generated" errors
    if (!structuredJson && hadSuccessfulRun && this.args.output_format?.toLowerCase() === 'json') {
      console.log('[Fallback] Agent completed but no structured output received, generating empty report');
      const fallbackReport = {
        security_review_report: {
          metadata: {
            scan_date: new Date().toISOString(),
            scan_type: 'Full Code Review',
            total_files_reviewed: 0,
            total_issues_found: 0
          },
          executive_summary: {
            overview: 'Security review completed. The AI agent analyzed the code but did not return structured findings. This may indicate no security issues were found, or the review requires manual follow-up.',
            risk_rating: 'UNKNOWN',
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          },
          findings: [],
          recommendations: [],
          conclusion: `Review completed with $${apiCostUsd.toFixed(4)} API cost but no structured output was returned. Consider re-running the scan or performing manual review.`
        }
      };
      structuredJson = JSON.stringify(fallbackReport, null, 2);
    }
    
    console.log();
    return structuredJson;
  }

  /**
   * Threat modeler agent with options
   */
  async threatModelerAgentWithOptions(userPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getThreatModelerOptions(this.args.role, this.args.output_format);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
            const streamMsg = message as any;
            if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
              const deltaText = streamMsg.event.delta.text || '';
              if (deltaText) {
                process.stdout.write(deltaText);
              }
            }
          } else if (message.type === 'assistant') {
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
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
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
    return structuredJson;
  }

  /**
   * Code fixer agent with structured JSON output.
   * Returns the structured fix JSON and prints cost to stdout.
   */
  async codeFixerWithOptions(userPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getCodeFixerOptions(this.args.role, srcDir);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (this.args.verbose && assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during code fix generation:', error);
      throw error;
    }
    console.log();
    return structuredJson;
  }

  /**
   * QA verifier agent with structured JSON output.
   * Runs project tests, analyzes results, and returns a QaVerdict.
   */
  async qaVerifierWithOptions(userPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getQaVerifierOptions(this.args.role, srcDir);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (this.args.verbose && assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during QA verification:', error);
      throw error;
    }
    console.log();
    return structuredJson;
  }

  /**
   * Context extractor agent with structured JSON output.
   * Analyzes repository files to extract project intelligence for SAST accuracy.
   */
  async contextExtractorWithOptions(userPrompt: string): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getContextExtractorOptions(this.args.role);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (this.args.verbose && assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during context extraction:', error);
      throw error;
    }
    console.log();
    return structuredJson;
  }

  /**
   * Finding validator agent with structured JSON output.
   * Analyzes code to determine if a previously detected vulnerability is still present.
   */
  async findingValidatorWithOptions(userPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getFindingValidatorOptions(this.args.role, srcDir);

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (this.args.verbose && assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // Ignore if cursor cleanup fails
        }
      }
      console.error('Error during finding validation:', error);
      throw error;
    }
    console.log();
    return structuredJson;
  }

  /**
   * pr_adversary: batch adversarial pass over candidate findings (structured security report out).
   */
  async prAdversaryWithOptions(userPrompt: string, srcDir?: string | null): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getPrAdversaryOptions(
      this.args.role,
      srcDir,
      this.args.max_turns,
      this.args.experiment_enabled,
    );

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';

    try {
      cursor = new BlinkingCursor();
      cursor.start();
      try {
        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            const assistantMsg = message as SDKAssistantMessage;
            if (this.args.verbose && assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            if ((resultMsg as any).structured_output) {
              structuredJson = JSON.stringify((resultMsg as any).structured_output, null, 2);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
          }
        }
      } finally {
        if (cursor) cursor.stop();
      }
    } catch (error) {
      if (cursor) {
        try {
          cursor.stop();
        } catch {
          // ignore
        }
      }
      console.error('Error during adversarial pass:', error);
      throw error;
    }
    console.log();
    return structuredJson;
  }

  /**
   * PR diff-focused code reviewer with options
   * Optimized for reviewing only changed code from a pull request
   * @param onResult - Optional callback to collect cost for chunked runs (e.g. aggregate total_cost_usd across batches)
   */
  async diffReviewerWithOptions(
    userPrompt: string,
    srcDir?: string | null,
    onResult?: (result: { total_cost_usd?: number }) => void,
    noTools?: boolean,
  ): Promise<string> {
    const agentOptions = new AgentOptions(this.confDict, this.environment, this.args.model);
    const options = agentOptions.getDiffReviewerOptions(
      this.args.role,
      srcDir,
      this.args.output_format,
      this.args.max_turns,
      noTools,
      this.args.experiment_enabled,
    );

    let cursor: BlinkingCursor | null = null;
    let structuredJson = '';
    let hadSuccessfulRun = false;
    let apiCostUsd = 0;

    try {
      cursor = new BlinkingCursor();
      cursor.start();

      try {
        let turnCount = 0;

        for await (const message of llmQuery({ prompt: userPrompt, options })) {
          if (message.type === 'stream_event') {
            if (cursor) cursor.stop();
            const streamMsg = message as any;
            if (streamMsg.event?.type === 'content_block_delta' && streamMsg.event.delta?.type === 'text_delta') {
              const deltaText = streamMsg.event.delta.text || '';
              if (deltaText) {
                process.stdout.write(deltaText);
              }
            }
          } else if (message.type === 'assistant') {
            if (cursor) cursor.stop();
            turnCount++;
            if (this.args.verbose) {
              console.log(`[Turn ${turnCount}] Assistant response received`);
            }
            const assistantMsg = message as SDKAssistantMessage;
            if (assistantMsg.message.content) {
              for (const block of assistantMsg.message.content) {
                if (block.type === 'text') {
                  console.log(`Claude: ${block.text}`);
                }
              }
            }
          } else if (message.type === 'result') {
            if (cursor) cursor.stop();
            const resultMsg = message as SDKResultMessage;
            const resultAny = resultMsg as any;
            
            // Track API cost for potential fallback report
            // Consider it a successful run if we got cost, even if is_error is set
            // (SDK may set is_error when max_turns is reached but agent still produced output)
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              apiCostUsd = resultMsg.total_cost_usd;
              hadSuccessfulRun = true;
            }
            
            // Log if is_error is set despite having output
            if (resultMsg.is_error && apiCostUsd > 0) {
              console.log(`[Warning] SDK reported is_error=true despite successful API usage ($${apiCostUsd.toFixed(4)})`);
            }
            
            if (resultAny.structured_output) {
              structuredJson = JSON.stringify(resultAny.structured_output, null, 2);
            }
            if (resultAny.num_turns !== undefined || resultAny.duration_ms !== undefined) {
              console.log(`[Agent Stats] turns=${resultAny.num_turns ?? turnCount}, duration=${resultAny.duration_ms ? Math.round(resultAny.duration_ms / 1000) + 's' : 'N/A'}, api_time=${resultAny.duration_api_ms ? Math.round(resultAny.duration_api_ms / 1000) + 's' : 'N/A'}`);
            }
            if (resultMsg.total_cost_usd && resultMsg.total_cost_usd > 0) {
              console.log(`\nCost: $${resultMsg.total_cost_usd.toFixed(4)}`);
            }
            onResult?.({ total_cost_usd: resultMsg.total_cost_usd });
          } else if (message.type === 'tool_progress') {
            if (this.args.verbose) {
              const toolMsg = message as any;
              console.log(`[Tool Progress] ${toolMsg.tool_name}: ${toolMsg.elapsed_time_seconds}s`);
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
    
    // Fallback: If agent completed successfully but didn't return structured output,
    // generate an empty report to avoid "No report generated" errors
    if (!structuredJson && hadSuccessfulRun && this.args.output_format?.toLowerCase() === 'json') {
      console.log('[Fallback] Agent completed but no structured output received, generating empty report');
      const fallbackReport = {
        security_review_report: {
          metadata: {
            scan_date: new Date().toISOString(),
            scan_type: 'PR Diff Review',
            total_files_reviewed: 0,
            total_issues_found: 0
          },
          executive_summary: {
            overview: 'Security review completed. The AI agent analyzed the code but did not return structured findings. This may indicate no security issues were found, or the review requires manual follow-up.',
            risk_rating: 'UNKNOWN',
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0
          },
          findings: [],
          recommendations: [],
          conclusion: `Review completed with $${apiCostUsd.toFixed(4)} API cost but no structured output was returned. Consider re-running the scan or performing manual review.`
        }
      };
      structuredJson = JSON.stringify(fallbackReport, null, 2);
    }
    
    console.log();
    return structuredJson;
  }
}


