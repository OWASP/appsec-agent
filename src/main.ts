/**
 * Main entry point for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs-extra';
import { AgentActions, AgentArgs } from './agent_actions';
import { copyProjectSrcDir, validateOutputFilePath, validateDirectoryPath } from './utils';

export async function main(confDict: any, args: AgentArgs): Promise<void> {
  // Capture working directory once at the start to avoid race conditions
  // in concurrent contexts (e.g., web applications)
  const currentWorkingDir = process.cwd();
  const agentActions = new AgentActions(confDict, args.environment, args);

  if (args.role === 'simple_query_agent') {
    console.log('Running Simple Query Agent');
    console.log("(Type '/end' to exit the conversation)\n");
    
    let tmpSrcDir: string | null = null;
    
    if (args.src_dir) {
      // Validate source directory path
      if (!validateDirectoryPath(args.src_dir, true)) {
        console.error(`Error: Invalid source directory path: ${args.src_dir}`);
        console.error('Source directory path must be valid and cannot contain directory traversal sequences.');
        process.exit(1);
      }
      
      tmpSrcDir = copyProjectSrcDir(currentWorkingDir, args.src_dir);
      console.log(`Source code directory copied to: ${tmpSrcDir}`);
      console.log('The agent can search files within this directory to answer your questions.\n');
    }
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Continuous conversation loop
    while (true) {
      // Wait for Claude's response to complete before showing next prompt
      const yourPrompt = await new Promise<string>((resolve) => {
        rl.question("Your turn (enter '/end' to exit the conversation): ", (answer: string) => {
          resolve(answer);
        });
      });

      // Check for exit command
      if (yourPrompt.trim().toLowerCase() === '/end') {
        console.log('\nExiting Simple Query Agent. Goodbye!');
        rl.close();
        break;
      }

      // Skip empty prompts
      if (!yourPrompt.trim()) {
        continue;
      }

      // Process the query and wait for complete response
      // The method will add proper spacing after the response completes
      await agentActions.simpleQueryClaudeWithOptions(yourPrompt, tmpSrcDir);
      
      // Ensure stdout is fully flushed and event loop processes all writes
      // before showing next prompt. This prevents the prompt from appearing
      // before streaming output completes.
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    
    // Clean up temporary source code directory if it was created
    if (tmpSrcDir && fs.existsSync(tmpSrcDir)) {
      try {
        fs.removeSync(tmpSrcDir);
        console.log(`Cleaned up temporary directory: ${tmpSrcDir}`);
      } catch (error) {
        console.warn(`Warning: Could not clean up temporary directory ${tmpSrcDir}:`, error);
      }
    }
  } else if (args.role === 'code_reviewer') {
    console.log('Running Code Review Agent');
    
    // Validate output file path
    const validatedOutputFile = validateOutputFilePath(args.output_file || 'code_review_report.md', currentWorkingDir);
    if (!validatedOutputFile) {
      console.error(`Error: Invalid output file path: ${args.output_file}`);
      console.error('Output file path must be relative to the current working directory and cannot contain directory traversal sequences.');
      process.exit(1);
    }
    
    let userPrompt: string;
    let tmpSrcDir: string | null = null;
    
    if (args.src_dir) {
      // Validate source directory path
      if (!validateDirectoryPath(args.src_dir, true)) {
        console.error(`Error: Invalid source directory path: ${args.src_dir}`);
        console.error('Source directory path must be valid and cannot contain directory traversal sequences.');
        process.exit(1);
      }
      
      tmpSrcDir = copyProjectSrcDir(currentWorkingDir, args.src_dir);
      userPrompt = `Review the code in the current working directory ${tmpSrcDir}, then provide a report of the potential security and privacy issues found in the code. Please write the review report in the ${validatedOutputFile} file under current working directory in ${args.output_format} format.`;
    } else {
      userPrompt = `Review the code in the current working directory, then provide a report of the potential security and privacy issues found in the code. Please write the review report in the ${validatedOutputFile} file under current working directory in ${args.output_format} format.`;
    }
    
    await agentActions.codeReviewerWithOptions(userPrompt);
    
    // Clean up temporary source code directory if it was created
    if (tmpSrcDir && fs.existsSync(tmpSrcDir)) {
      try {
        fs.removeSync(tmpSrcDir);
      } catch (error) {
        console.warn(`Warning: Could not clean up temporary directory ${tmpSrcDir}:`, error);
      }
    }
  } else if (args.role === 'threat_modeler') {
    console.log('Running Threat Modeler');
    
    // Validate output file path
    const validatedOutputFile = validateOutputFilePath(args.output_file || 'threat_model_report.md', currentWorkingDir);
    if (!validatedOutputFile) {
      console.error(`Error: Invalid output file path: ${args.output_file}`);
      console.error('Output file path must be relative to the current working directory and cannot contain directory traversal sequences.');
      process.exit(1);
    }
    
    const userPrompt0 = `Draw the ASCII text based Data Flow Diagram (DFD), with output format as <codebase_data_flow_diagram_text_timestamp>. Then proceeding to use STRIDE methodology to perform threat modeling on the DFD, without output report in the format <codebase_threat_model_timestamp>. Finally, provide a separate risk registry report including proposed remediation plan in the format <codebase_risk_registry_text_timestamp>. We're looking for 3 reports in the current working directory as the deliverable. Please write the threat modeler report in the ${validatedOutputFile} file under current working directory in ${args.output_format} format.`;
    
    let tmpSrcDir: string | null = null;
    let userPrompt: string;
    
    if (args.src_dir) {
      // Validate source directory path
      if (!validateDirectoryPath(args.src_dir, true)) {
        console.error(`Error: Invalid source directory path: ${args.src_dir}`);
        console.error('Source directory path must be valid and cannot contain directory traversal sequences.');
        process.exit(1);
      }
      
      tmpSrcDir = copyProjectSrcDir(currentWorkingDir, args.src_dir);
      userPrompt = `Review the code in the ${tmpSrcDir} directory. ${userPrompt0}`;
    } else {
      userPrompt = `Review the code in the current working directory. ${userPrompt0}`;
    }
    
    await agentActions.threatModelerAgentWithOptions(userPrompt);
    
    // Clean up temporary source code directory
    if (tmpSrcDir && fs.existsSync(tmpSrcDir)) {
      try {
        fs.removeSync(tmpSrcDir);
      } catch (error) {
        console.warn(`Warning: Could not clean up temporary directory ${tmpSrcDir}:`, error);
      }
    }
  } else {
    console.error(`Error: Invalid appsec AI agent role: ${args.role} - refer to 'appsec_agent.yaml' for available roles`);
    process.exit(1);
  }
  
  process.exit(0);
}

