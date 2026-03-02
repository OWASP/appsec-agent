/**
 * Main entry point for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { AgentActions, AgentArgs } from './agent_actions';
import { copyProjectSrcDir, validateOutputFilePath, validateDirectoryPath, validateInputFilePath, sanitizePathForError, getExtensionForFormat, sampleDirectoryForPrompt } from './utils';
import { DiffContext, formatDiffContextForPrompt, validateDiffContext } from './diff_context';
import { splitIntoBatches, ChunkingOptions } from './diff_chunking';
import { mergeBatchReports } from './diff_report_merge';
import { FixContext } from './schemas/security_fix';

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
 * Load and validate fix context from JSON file
 */
function loadFixContext(fixContextPath: string, cwd: string): FixContext {
  const resolvedPath = validateInputFilePath(fixContextPath, cwd);

  if (!resolvedPath) {
    const safePath = sanitizePathForError(fixContextPath);
    console.error(`Error: Invalid fix context file path: ${safePath}`);
    console.error('The path must be valid and relative paths cannot contain directory traversal sequences.');
    process.exit(1);
  }

  const safePath = sanitizePathForError(resolvedPath);

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Error: Fix context file not found: ${safePath}`);
    process.exit(1);
  }

  try {
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const data = JSON.parse(content) as FixContext;
    if (!data.finding || !data.code_context) {
      console.error(`Error: Fix context missing required fields (finding, code_context) in: ${safePath}`);
      process.exit(1);
    }
    return data;
  } catch (error: any) {
    const errorMessage = error?.message || 'Unknown error';
    console.error(`Error: Failed to read fix context file ${safePath}: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Build user prompt for the code_fixer role from FixContext
 */
function buildCodeFixerPrompt(ctx: FixContext): string {
  const { finding, code_context } = ctx;

  let prompt = `Fix the following security vulnerability. Return your fix as structured JSON (follow the required schema). Do not write any files.

## Finding
- **Severity**: ${finding.severity}
- **Type**: ${finding.title}
- **CWE**: ${finding.cwe}
- **OWASP**: ${finding.owasp}
- **File**: ${finding.file}
- **Line**: ${finding.line}

## Description
${finding.description}

## Recommendation
${finding.recommendation}
`;

  if (ctx.security_guidance) {
    prompt += `\n${ctx.security_guidance}\n`;
  }

  if (ctx.chain_of_thought) {
    prompt += `\n## Chain of Thought
Think step-by-step about the vulnerability and the fix before producing the output.\n`;
  }

  prompt += `
## Code Context

### File Imports
\`\`\`${code_context.language}
${code_context.imports}
\`\`\`

### Vulnerable Code Section (Lines ${code_context.vulnerable_section_start}-${code_context.vulnerable_section_end})
\`\`\`${code_context.language}
${code_context.vulnerable_section}
\`\`\`

### Full File Context
\`\`\`${code_context.language}
${code_context.full_file_with_line_numbers}
\`\`\`
`;

  if (ctx.learned_examples) {
    prompt += `\n${ctx.learned_examples}\n`;
  }

  if (ctx.negative_examples) {
    prompt += `\n${ctx.negative_examples}\n`;
  }

  if (ctx.custom_instructions) {
    prompt += `\n${ctx.custom_instructions}\n`;
  }

  prompt += `
## Indentation Requirements
${code_context.indentation_guidance}

## Instructions
1. If a "Recommendation" section is provided above, follow those specific recommendations
2. Follow the security guidance above for this specific vulnerability type
3. Generate a fix that fully addresses the security issue - partial fixes are NOT acceptable
4. Use the recommended secure alternatives when applicable
5. Preserve the original code's functionality where possible, but security takes precedence
6. Only modify the affected lines - return ONLY the fixed portion, not the entire file
7. CRITICAL - PRESERVE INDENTATION: Your fixed_code MUST start with the exact same whitespace as shown above

## CRITICAL - LINE NUMBER RULES
1. The "Vulnerable Code Section" header above says "Lines ${code_context.vulnerable_section_start}-${code_context.vulnerable_section_end}"
2. Your start_line MUST be >= ${code_context.vulnerable_section_start}
3. Your end_line MUST be <= ${code_context.vulnerable_section_end}
4. The finding is reported at line ${finding.line} - your fix MUST include or be adjacent to this line
5. NEVER return start_line: 1 unless the vulnerability is literally at line 1 of the file
6. Your fixed_code should contain ONLY the code for lines start_line through end_line`;

  if (ctx.previous_fix_code && ctx.validation_errors?.length) {
    prompt += `

## RETRY: Previous Fix Failed Validation

Your previous fix attempt had validation errors. Please correct the fix.

### Previous Attempt
\`\`\`${code_context.language}
${ctx.previous_fix_code}
\`\`\`

### Validation Errors
${ctx.validation_errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Fix the code to resolve these validation errors while still addressing the original security issue.`;
  }

  return prompt;
}

/** Defaults for PR chunking when not set (0 = no chunking). */
const DEFAULT_MAX_TOKENS_PER_BATCH = 0;
const DEFAULT_MAX_BATCHES = 3;

/**
 * Get chunking options from config and args (args override config).
 */
function getChunkingOptions(confDict: any, environment: string, args: AgentArgs): ChunkingOptions {
  const role = args.role === 'pr_reviewer' || args.role === 'code_reviewer' ? args.role : 'code_reviewer';
  const roleOpts = confDict?.[environment]?.[role]?.options ?? confDict?.default?.[role]?.options;
  const fromConfig = {
    maxTokensPerBatch: roleOpts?.diff_review_max_tokens_per_batch ?? DEFAULT_MAX_TOKENS_PER_BATCH,
    maxBatches: roleOpts?.diff_review_max_batches ?? DEFAULT_MAX_BATCHES,
    maxFiles: roleOpts?.diff_review_max_files,
    excludePaths: Array.isArray(roleOpts?.diff_review_exclude_paths) ? roleOpts.diff_review_exclude_paths : undefined
  };
  return {
    maxTokensPerBatch: args.diff_max_tokens_per_batch !== undefined ? args.diff_max_tokens_per_batch : fromConfig.maxTokensPerBatch,
    maxBatches: args.diff_max_batches !== undefined ? args.diff_max_batches : fromConfig.maxBatches,
    maxFiles: args.diff_max_files !== undefined ? args.diff_max_files : fromConfig.maxFiles,
    excludePaths: args.diff_exclude && args.diff_exclude.length > 0 ? args.diff_exclude : fromConfig.excludePaths
  };
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

  if (outputFormat?.toLowerCase() === 'json') {
    prompt += `Provide the security review report as your structured JSON response (follow the required schema). Do not write the report to a file; the system will save it to ${outputFile}.
Focus only on the changed code - do not report issues in unchanged code.`;
  } else {
    prompt += `Write a comprehensive security review report to ${outputFile} in ${outputFormat} format.
Focus only on the changed code - do not report issues in unchanged code.`;
  }

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
      
      const diffContext = loadDiffContext(args.diff_context, currentWorkingDir);
      console.log(`Reviewing PR #${diffContext.prNumber}: ${diffContext.totalFilesChanged} files (+${diffContext.totalLinesAdded}/-${diffContext.totalLinesRemoved})`);
      
      const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
      const chunkingOpts = getChunkingOptions(confDict, args.environment, args);
      const { batches, skippedFiles, skippedDueToBatches } = splitIntoBatches(diffContext, chunkingOpts);

      const singleBatchNoSkipped = batches.length === 1 && skippedFiles.length === 0 && !skippedDueToBatches;

      if (singleBatchNoSkipped) {
        const userPrompt = buildDiffReviewPrompt(
          batches[0],
          outputFile,
          args.output_format || 'json',
          args.context
        );
        const structuredResult = await agentActions.diffReviewerWithOptions(userPrompt, tmpSrcDir);
        if (structuredResult) {
          fs.writeFileSync(outputFile, structuredResult, 'utf-8');
          console.log(`Report written to ${outputFile}`);
        }
        cleanupTmpDir(tmpSrcDir);
      } else if (batches.length > 0) {
        const extension = getExtensionForFormat(args.output_format);
        const tempDir = path.join(currentWorkingDir, `.pr_review_batches_${Date.now()}`);
        fs.ensureDirSync(tempDir);
        const batchPaths: string[] = [];
        const batchCosts: number[] = [];

        try {
          for (let i = 0; i < batches.length; i++) {
            const batchOutputPath = path.join(tempDir, `code_review_batch_${i + 1}.${extension}`);
            const userPrompt = buildDiffReviewPrompt(
              batches[i],
              batchOutputPath,
              args.output_format || 'json',
              args.context
            );
            const batchResult = await agentActions.diffReviewerWithOptions(userPrompt, tmpSrcDir, (result) => {
              if (result.total_cost_usd !== undefined && result.total_cost_usd > 0) {
                batchCosts.push(result.total_cost_usd);
              }
            });
            if (batchResult) {
              fs.writeFileSync(batchOutputPath, batchResult, 'utf-8');
              console.log(`Batch ${i + 1} report written to ${batchOutputPath}`);
            }
            if (fs.existsSync(batchOutputPath)) {
              batchPaths.push(batchOutputPath);
            }
          }

          const totalCostUsd = batchCosts.length > 0 ? batchCosts.reduce((a, b) => a + b, 0) : undefined;
          const skippedPaths = skippedFiles.map(f => f.filePath);
          let skippedMessage: string | undefined;
          if (skippedDueToBatches) {
            skippedMessage = `PR exceeded batch limit (max ${chunkingOpts.maxBatches} batches). Only the first ${batchPaths.length} batch(es) were reviewed. Consider splitting the PR or using a full repository review.`;
          } else if (skippedPaths.length > 0) {
            skippedMessage = `${skippedPaths.length} file(s) excluded by config (max_files or exclude_paths).`;
          }

          mergeBatchReports({
            batchPaths,
            outputPath: outputFile,
            format: args.output_format || 'json',
            totalCostUsd,
            batchCosts: batchCosts.length > 0 ? batchCosts : undefined,
            skippedFilePaths: skippedPaths.length > 0 ? skippedPaths : undefined,
            skippedMessage
          });

          if (batchCosts.length > 0) {
            batchCosts.forEach((c, i) => console.log(`Batch ${i + 1}: $${c.toFixed(4)}`));
            const total = batchCosts.reduce((a, b) => a + b, 0);
            console.log(`Total API cost: $${total.toFixed(4)}`);
          }
        } finally {
          cleanupTmpDir(tempDir, args.verbose ?? false);
          cleanupTmpDir(tmpSrcDir);
        }
      } else {
        console.warn('No files to review after filtering.');
        cleanupTmpDir(tmpSrcDir);
      }
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
      
      const isJson = args.output_format?.toLowerCase() === 'json';
      const outputInstruction = isJson
        ? `Provide the security review report as your structured JSON response (follow the required schema). Do not write the report to a file; the system will save it to ${outputFile}.`
        : `Please write the review report in the ${outputFile} file under current working directory in ${args.output_format} format.`;
      let userPrompt = `Review the code in the ${srcLocation}.${contextSection}

Provide a comprehensive security review report identifying potential security issues found in the code. ${outputInstruction}`;
      if (process.env.FAILOVER_ENABLED === 'true' && tmpSrcDir) {
        const codeSample = sampleDirectoryForPrompt(tmpSrcDir);
        if (codeSample) {
          userPrompt += `\n\n## Code to review (included for fallback mode)\n\nThe following is a sampling of the source code. Analyze it for security issues and produce your report.\n\n${codeSample}`;
        }
      }
      const structuredResult = await agentActions.codeReviewerWithOptions(userPrompt);
      if (structuredResult) {
        fs.writeFileSync(outputFile, structuredResult, 'utf-8');
        console.log(`Report written to ${outputFile}`);
      }
      cleanupTmpDir(tmpSrcDir);
    }

  } else if (args.role === 'threat_modeler') {
    console.log('Running Threat Modeler');
    
    const extension = getExtensionForFormat(args.output_format);
    const outputFile = validateOutputFile(args.output_file || `threat_model_report.${extension}`, currentWorkingDir);
    const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
    const srcLocation = tmpSrcDir ? `the ${tmpSrcDir} directory` : 'the current working directory';
    
    const isJson = args.output_format?.toLowerCase() === 'json';
    
    let userPrompt: string;
    if (isJson) {
      userPrompt = `Analyze the source code in ${srcLocation} and produce a comprehensive threat model report as structured JSON (follow the required schema). Do not write any files; the system will save the output.

Your analysis must include:
1. A Data Flow Diagram (DFD) — identify all system components as nodes (external entities, processes, data stores), map all data flows between them with protocols and data classifications, and define trust boundaries.
2. A STRIDE threat analysis — provide an executive summary, then enumerate each threat with its STRIDE category, severity, likelihood, affected DFD components (by node/flow ID), impact assessment, and mitigation strategy. Include CWE/OWASP references where applicable.
3. A risk registry — summarize the overall risk posture, then enumerate each risk with severity, category, affected components, business impact, remediation plan, effort/cost estimates, and timeline. Cross-reference related threat IDs.

Use sequential IDs: node-001/flow-001/tb-001 for DFD elements, THREAT-001 for threats, RISK-001 for risks.`;
    } else {
      const basePrompt = `Draw the ASCII text based Data Flow Diagram (DFD), with output format as <codebase_data_flow_diagram_text_timestamp>. Then proceeding to use STRIDE methodology to perform threat modeling on the DFD, without output report in the format <codebase_threat_model_timestamp>. Finally, provide a separate risk registry report including proposed remediation plan in the format <codebase_risk_registry_text_timestamp>. We're looking for 3 reports in the current working directory as the deliverable. Please write the threat modeler report under the current working directory in ${args.output_format} format.`;
      userPrompt = `Review the code in ${srcLocation}. ${basePrompt}`;
    }
    
    const structuredResult = await agentActions.threatModelerAgentWithOptions(userPrompt);
    if (structuredResult) {
      fs.writeFileSync(outputFile, structuredResult, 'utf-8');
      console.log(`Report written to ${outputFile}`);
    }
    cleanupTmpDir(tmpSrcDir);

  } else if (args.role === 'code_fixer') {
    console.log('Running Code Fixer Agent');

    if (!args.fix_context) {
      console.error('Error: --fix-context is required for the code_fixer role.');
      process.exit(1);
    }

    const fixContext = loadFixContext(args.fix_context, currentWorkingDir);
    const outputFile = validateOutputFile(
      args.output_file || 'fix_output.json',
      currentWorkingDir
    );

    const tmpSrcDir = args.src_dir
      ? validateAndCopySrcDir(args.src_dir, currentWorkingDir)
      : null;

    const userPrompt = buildCodeFixerPrompt(fixContext);

    const structuredResult = await agentActions.codeFixerWithOptions(userPrompt, tmpSrcDir);
    if (structuredResult) {
      fs.writeFileSync(outputFile, structuredResult, 'utf-8');
      console.log(`Fix written to ${outputFile}`);
    }
    cleanupTmpDir(tmpSrcDir);

  } else {
    console.error(`Error: Invalid appsec AI agent role: ${args.role} - refer to 'appsec_agent.yaml' for available roles`);
    process.exit(1);
  }
  
  process.exit(0);
}

