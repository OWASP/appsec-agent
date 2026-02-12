/**
 * Main entry point for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { AgentActions, AgentArgs } from './agent_actions';
import { copyProjectSrcDir, validateOutputFilePath, validateDirectoryPath, validateInputFilePath, sanitizePathForError, getExtensionForFormat } from './utils';
import { DiffContext, formatDiffContextForPrompt, validateDiffContext } from './diff_context';

/**
 * Validate and copy source directory, exiting on validation failure
 */
function validateAndCopySrcDir(srcDir: string, cwd: string): string {
  if (!validateDirectoryPath(srcDir, true)) {
    const safePath = sanitizePathForError(srcDir);
    console.error(`Error: Invalid source directory path: ${safePath}`);
    console.error('Source directory path must be valid and cannot contain directory traversal sequences.');
    process.exit(1);
  }
  return copyProjectSrcDir(cwd, srcDir);
}

/**
 * Validate output file path, exiting on validation failure
 */
function validateOutputFile(outputFile: string, cwd: string): string {
  const validated = validateOutputFilePath(outputFile, cwd);
  if (!validated) {
    const safePath = sanitizePathForError(outputFile);
    console.error(`Error: Invalid output file path: ${safePath}`);
    console.error('Output file path must be relative to the current working directory and cannot contain directory traversal sequences.');
    process.exit(1);
  }
  return validated;
}

/**
 * Clean up temporary directory if it exists
 */
function cleanupTmpDir(tmpDir: string | null, verbose: boolean = false): void {
  if (!tmpDir || !fs.existsSync(tmpDir)) return;
  
  try {
    fs.removeSync(tmpDir);
    if (verbose) {
      const safePath = sanitizePathForError(tmpDir);
      console.log(`Cleaned up temporary directory: ${safePath}`);
    }
  } catch (error: any) {
    const safePath = sanitizePathForError(tmpDir);
    const errorMessage = error?.message || 'Unknown error';
    console.warn(`Warning: Could not clean up temporary directory ${safePath}: ${errorMessage}`);
  }
}

/**
 * Load and validate diff context from JSON file
 */
function loadDiffContext(diffContextPath: string, cwd: string): DiffContext {
  // Validate and resolve the path
  const resolvedPath = validateInputFilePath(diffContextPath, cwd);
  
  if (!resolvedPath) {
    const safePath = sanitizePathForError(diffContextPath);
    console.error(`Error: Invalid diff context file path: ${safePath}`);
    console.error('The path must be valid and relative paths cannot contain directory traversal sequences.');
    process.exit(1);
  }
  
  const safePath = sanitizePathForError(resolvedPath);
  
  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Diff context file not found: ${safePath}`);
    process.exit(1);
  }
  
  // Read and parse the file
  let data: unknown;
  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    data = JSON.parse(content);
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error: Failed to read diff context file ${safePath}: ${errorMessage}`);
    process.exit(1);
  }
  
  // Validate the parsed data (outside try-catch to avoid catching process.exit mock errors in tests)
  if (!validateDiffContext(data)) {
    console.error(`Error: Invalid diff context format in: ${safePath}`);
    console.error('The diff context file must contain valid DiffContext JSON structure.');
    process.exit(1);
  }
  
  return data;
}

/**
 * Build user prompt for PR diff-focused code review
 */
function buildDiffReviewPrompt(
  diffContext: DiffContext, 
  outputFile: string, 
  outputFormat: string,
  additionalContext?: string
): string {
  const formattedDiff = formatDiffContextForPrompt(diffContext);
  
  let prompt = `You are reviewing a Pull Request for security vulnerabilities.

${formattedDiff}

## Review Instructions

Analyze ONLY the changed code shown above for security issues. Focus on:
1. **Injection vulnerabilities** (SQL, XSS, command injection, etc.)
2. **Authentication and authorization flaws**
3. **Sensitive data exposure**
4. **Security misconfigurations**
5. **Cryptographic issues**
6. **Input validation problems**

For each issue found:
- Cite the specific file and line numbers from the changes
- Explain the vulnerability and its potential impact
- Provide a remediation recommendation

`;

  if (additionalContext) {
    prompt += `## Additional Context
${additionalContext}

`;
  }

  prompt += `Write a comprehensive security review report to ${outputFile} in ${outputFormat} format.
Focus only on the changed code - do not report issues in unchanged code.`;

  return prompt;
}

export async function main(confDict: any, args: AgentArgs): Promise<void> {
  const currentWorkingDir = process.cwd();
  const agentActions = new AgentActions(confDict, args.environment, args);

  if (args.role === 'simple_query_agent') {
    console.log('Running Simple Query Agent');
    console.log("(Type '/end' to exit the conversation)\n");
    
    let tmpSrcDir: string | null = null;
    if (args.src_dir) {
      tmpSrcDir = validateAndCopySrcDir(args.src_dir, currentWorkingDir);
      console.log(`Source code directory copied to: ${sanitizePathForError(tmpSrcDir)}`);
      console.log('The agent can search files within this directory to answer your questions.\n');
    }
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    while (true) {
      const yourPrompt = await new Promise<string>((resolve) => {
        rl.question("Your turn (enter '/end' to exit the conversation): ", resolve);
      });

      if (yourPrompt.trim().toLowerCase() === '/end') {
        console.log('\nExiting Simple Query Agent. Goodbye!');
        rl.close();
        break;
      }

      if (!yourPrompt.trim()) continue;

      await agentActions.simpleQueryClaudeWithOptions(yourPrompt, tmpSrcDir);
      await new Promise<void>(resolve => setImmediate(resolve));
    }
    
    cleanupTmpDir(tmpSrcDir, true);

  } else if (args.role === 'code_reviewer' || args.role === 'pr_reviewer') {
    const extension = getExtensionForFormat(args.output_format);
    const outputFile = validateOutputFile(args.output_file || `code_review_report.${extension}`, currentWorkingDir);
    
    // Check if running in diff-context mode (PR-focused review)
    if (args.diff_context) {
      console.log('Running PR Diff Code Review Agent (focused context mode)');
      
      // Load diff context
      const diffContext = loadDiffContext(args.diff_context, currentWorkingDir);
      console.log(`Reviewing PR #${diffContext.prNumber}: ${diffContext.totalFilesChanged} files (+${diffContext.totalLinesAdded}/-${diffContext.totalLinesRemoved})`);
      
      // Copy source directory if provided (for full file access when needed)
      const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
      
      // Build focused prompt
      const userPrompt = buildDiffReviewPrompt(
        diffContext, 
        outputFile, 
        args.output_format || 'json',
        args.context
      );
      
      // Use diff-focused reviewer options
      await agentActions.diffReviewerWithOptions(userPrompt, tmpSrcDir);
      cleanupTmpDir(tmpSrcDir);
      
    } else {
      // Standard full-repository code review
      console.log('Running Code Review Agent');
      
      const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
      const srcLocation = tmpSrcDir ? `current working directory ${tmpSrcDir}` : 'current working directory';
      
      // Build context section if provided
      let contextSection = '';
      if (args.context) {
        console.log('Using context:', args.context?.substring(0, 50) + (args.context.length > 50 ? '...' : ''));
        contextSection = `

IMPORTANT DEPLOYMENT & ENVIRONMENT CONTEXT:
${args.context}

Please consider this context when analyzing the code. Focus on:
- Security issues specific to this deployment environment
- Vulnerabilities that may be mitigated or exacerbated by this context
- Best practices relevant to the stated architecture and compliance requirements
- Environment-specific attack vectors and threat models

`;
      }
      
      const userPrompt = `Review the code in the ${srcLocation}.${contextSection}.
Provide a comprehensive security review report identifying potential security issues found in the code. Please write the review report in the ${outputFile} file under current working directory in ${args.output_format} format.`;
      
      await agentActions.codeReviewerWithOptions(userPrompt);
      cleanupTmpDir(tmpSrcDir);
    }

  } else if (args.role === 'threat_modeler') {
    console.log('Running Threat Modeler');
    
    const extension = getExtensionForFormat(args.output_format);
    const outputFile = validateOutputFile(args.output_file || `threat_model_report.${extension}`, currentWorkingDir);
    const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
    const srcLocation = tmpSrcDir ? `the ${tmpSrcDir} directory` : 'the current working directory';
    
    const basePrompt = `Draw the ASCII text based Data Flow Diagram (DFD), with output format as <codebase_data_flow_diagram_text_timestamp>. Then proceeding to use STRIDE methodology to perform threat modeling on the DFD, without output report in the format <codebase_threat_model_timestamp>. Finally, provide a separate risk registry report including proposed remediation plan in the format <codebase_risk_registry_text_timestamp>. We're looking for 3 reports in the current working directory as the deliverable. Please write the threat modeler reportg under the current working directory in ${args.output_format} format.`;
    
    const userPrompt = `Review the code in ${srcLocation}. ${basePrompt}`;
    
    await agentActions.threatModelerAgentWithOptions(userPrompt);
    cleanupTmpDir(tmpSrcDir);

  } else {
    console.error(`Error: Invalid appsec AI agent role: ${args.role} - refer to 'appsec_agent.yaml' for available roles`);
    process.exit(1);
  }
  
  process.exit(0);
}

