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
import { loadQaContext, QaContext } from './schemas/qa_context';
import { loadRetestContext, RetestContext } from './schemas/finding_validator';
import { loadExtractionContext, ExtractionContext } from './schemas/context_extraction';

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
 * Build user prompt for the qa_verifier role from QaContext
 */
function buildQaVerifierPrompt(ctx: QaContext): string {
  const parts: string[] = [];

  parts.push('## QA Verification Task\n');
  parts.push(`Verify the security fix applied in PR: ${ctx.pr_url}\n`);

  if (ctx.deployment_context) {
    parts.push('### Deployment & Environment Context');
    parts.push(ctx.deployment_context);
    parts.push('');
  }

  parts.push('### Test Configuration');
  parts.push(`- **Test command:** \`${ctx.test_command}\``);
  if (ctx.test_framework) {
    parts.push(`- **Test framework:** ${ctx.test_framework}`);
  }
  if (ctx.setup_commands) {
    parts.push(`- **Setup commands:** \`${ctx.setup_commands}\``);
  }
  parts.push(`- **Timeout:** ${ctx.timeout_seconds} seconds`);
  parts.push(`- **Block on failure:** ${ctx.block_on_failure ? 'Yes' : 'No'}`);
  parts.push('');

  if (ctx.environment_variables && Object.keys(ctx.environment_variables).length > 0) {
    parts.push('### Environment Variables');
    for (const [key, val] of Object.entries(ctx.environment_variables)) {
      parts.push(`- \`${key}\` = \`${val}\``);
    }
    parts.push('');
  }

  parts.push('### Instructions');
  parts.push('1. If setup commands are provided, run them first to prepare the environment.');
  parts.push('2. Run the test command and capture the output.');
  parts.push('3. If tests fail, analyze the failure output to determine:');
  parts.push('   - Which specific tests failed and why');
  parts.push('   - Whether the failures are related to the security fix or are pre-existing');
  parts.push('   - Actionable suggestions for resolving failures');
  parts.push('4. Return a structured QA verdict JSON with your findings.');

  return parts.join('\n');
}

/**
 * Build user prompt for the code_fixer role from FixContext
 */
function buildCodeFixerPrompt(ctx: FixContext): string {
  const { finding, code_context } = ctx;

  let prompt = `Fix the following security vulnerability. Return your fix as structured JSON (follow the required schema). Do not write any files.
`;

  if (ctx.deployment_context) {
    prompt += `
## Deployment & Environment Context
${ctx.deployment_context}

Please consider this context when generating the fix. Focus on security practices relevant to this deployment environment.
`;
  }

  prompt += `
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

  if (ctx.generate_companion_test) {
    prompt += `

## COMPANION TEST GENERATION
In addition to the fix, generate a companion unit test that verifies:
1. The security vulnerability is properly addressed by the fix
2. The fixed code still produces correct output for normal inputs
3. Known attack vectors for this vulnerability type are properly blocked

Include the test code in the \`test_code\` field, suggest an appropriate file path in \`test_file\`,
and specify the test framework in \`test_framework\` (e.g. jest, pytest, junit).
The test should be self-contained and runnable with minimal setup.`;
  }

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

/**
 * Build user prompt for the finding_validator role from RetestContext
 */
function buildFindingValidatorPrompt(ctx: RetestContext): string {
  const { finding } = ctx;

  return `You are validating whether a previously detected vulnerability still exists in code.

## Original Finding
- **Type**: ${finding.title}
- **Category**: ${finding.category}
- **Severity**: ${finding.severity}
- **CWE**: ${finding.cwe || 'N/A'}
- **Original Location**: ${finding.file}, lines ${finding.line_numbers || 'unknown'}
- **Description**: ${finding.description}

## Code to Analyze (with line numbers)
File: ${finding.file}
\`\`\`
${ctx.code_snippet}
\`\`\`

## Task
Analyze the code above and determine if the vulnerability described in the finding STILL EXISTS in this code.
Return your assessment as structured JSON (follow the required schema).`;
}

/**
 * Build user prompt for the context_extractor role from ExtractionContext
 */
function buildContextExtractorPrompt(ctx: ExtractionContext): string {
  const parts: string[] = [];

  parts.push('## Repository Analysis Task\n');
  parts.push(`Analyze the following repository metadata and files to extract structured project intelligence.\n`);

  parts.push('### Repository Metadata');
  parts.push(`- **Owner/Org:** ${ctx.owner}`);
  parts.push(`- **Repository:** ${ctx.repo}`);
  if (ctx.description) {
    parts.push(`- **Description:** ${ctx.description}`);
  }
  if (ctx.language) {
    parts.push(`- **Primary Language:** ${ctx.language}`);
  }
  if (ctx.languages && Object.keys(ctx.languages).length > 0) {
    const sorted = Object.entries(ctx.languages)
      .sort(([, a], [, b]) => b - a)
      .map(([lang, bytes]) => `${lang} (${Math.round(bytes / 1024)}KB)`)
      .join(', ');
    parts.push(`- **Languages:** ${sorted}`);
  }
  parts.push('');

  parts.push('### Repository Files\n');
  for (const file of ctx.files) {
    parts.push(`#### ${file.path}`);
    parts.push('```');
    parts.push(file.content);
    parts.push('```');
    parts.push('');
  }

  parts.push('### Instructions\n');
  parts.push('Analyze ALL the files above and return structured JSON with these fields:');
  parts.push('1. **project_summary**: 1-2 sentences describing what the project does, its tech stack (frameworks, languages), and architecture (monorepo, microservice, etc.). Use the repo description as a starting point if available.');
  parts.push('2. **security_context**: List specific security defenses found in dependencies and config: auth frameworks (passport, next-auth), encryption (bcrypt, argon2), validation (zod, joi), CSRF/XSS protection (helmet, csurf), rate limiting, ORM usage (Prisma, SQLAlchemy — note these use parameterized queries), CI security scanning (CodeQL, Snyk, Trivy). Be concrete with library names.');
  parts.push('3. **deployment_context**: How the project is built and deployed: CI/CD system (GitHub Actions, Codefresh, Jenkins), container runtime (Docker, ECS, Kubernetes), cloud provider, environments, infrastructure (Terraform, Helm). Extract from CI configs, Dockerfiles, and infra files.');
  parts.push('4. **developer_context**: Extract ONLY security-relevant rules from developer guidance files (CLAUDE.md, AGENTS.md, .cursor/rules/). Include: PHI/PII handling rules, SQL injection prevention, auth patterns, input validation requirements, compliance mandates (HIPAA, SOX, GDPR). EXCLUDE: generic coding style, formatting, naming conventions, component patterns, UI guidelines.');
  parts.push('\nReturn empty strings for fields where no relevant information is found. Be concise but specific.');

  return parts.join('\n');
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
    prompt += `## Project Intelligence (use this to reduce false positives)
${additionalContext}

When the project intelligence indicates that specific defenses are in place (e.g., ORM with parameterized queries, security middleware, input validation), DO NOT report findings that those defenses already mitigate unless you can verify the defense is not applied to the specific code path in question.

Developer context reflects the team's stated practices. If you find evidence in the code that contradicts the developer context (e.g., raw SQL despite claiming Prisma-only), trust the code and report the finding.

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
    
    let contextSection = '';
    if (args.context) {
      console.log('Using context:', args.context.substring(0, 50) + (args.context.length > 50 ? '...' : ''));
      contextSection = `

IMPORTANT DEPLOYMENT & ENVIRONMENT CONTEXT:
${args.context}

Please consider this context when performing threat modeling. Focus on:
- Threats specific to this deployment environment
- Attack vectors relevant to the stated architecture and compliance requirements
- Data flow risks that may be mitigated or exacerbated by this context

`;
    }

    const isJson = args.output_format?.toLowerCase() === 'json';
    
    let userPrompt: string;
    if (isJson) {
      userPrompt = `Analyze the source code in ${srcLocation} and produce a comprehensive threat model report as structured JSON (follow the required schema). Do not write any files; the system will save the output.
${contextSection}
Your analysis must include:
1. A Data Flow Diagram (DFD) — identify all system components as nodes (external entities, processes, data stores), map all data flows between them with protocols and data classifications, and define trust boundaries.
2. A STRIDE threat analysis — provide an executive summary, then enumerate each threat with its STRIDE category, severity, likelihood, affected DFD components (by node/flow ID), impact assessment, and mitigation strategy. Include CWE/OWASP references where applicable.
3. A risk registry — summarize the overall risk posture, then enumerate each risk with severity, category, affected components, business impact, remediation plan, effort/cost estimates, and timeline. Cross-reference related threat IDs.

Use sequential IDs: node-001/flow-001/tb-001 for DFD elements, THREAT-001 for threats, RISK-001 for risks.`;
    } else {
      const basePrompt = `Draw the ASCII text based Data Flow Diagram (DFD), with output format as <codebase_data_flow_diagram_text_timestamp>. Then proceeding to use STRIDE methodology to perform threat modeling on the DFD, without output report in the format <codebase_threat_model_timestamp>. Finally, provide a separate risk registry report including proposed remediation plan in the format <codebase_risk_registry_text_timestamp>. We're looking for 3 reports in the current working directory as the deliverable. Please write the threat modeler report under the current working directory in ${args.output_format} format.`;
      userPrompt = `Review the code in ${srcLocation}.${contextSection} ${basePrompt}`;
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

  } else if (args.role === 'qa_verifier') {
    console.log('Running QA Verifier Agent');

    if (!args.qa_context) {
      console.error('Error: --qa-context is required for the qa_verifier role.');
      process.exit(1);
    }

    const qaContext = loadQaContext(args.qa_context, currentWorkingDir);
    const outputFile = validateOutputFile(
      args.output_file || 'qa_verdict.json',
      currentWorkingDir
    );

    const tmpSrcDir = args.src_dir
      ? validateAndCopySrcDir(args.src_dir, currentWorkingDir)
      : null;

    const userPrompt = buildQaVerifierPrompt(qaContext);

    const structuredResult = await agentActions.qaVerifierWithOptions(userPrompt, tmpSrcDir);
    if (structuredResult) {
      fs.writeFileSync(outputFile, structuredResult, 'utf-8');
      console.log(`QA verdict written to ${outputFile}`);
    }
    cleanupTmpDir(tmpSrcDir);

  } else if (args.role === 'finding_validator') {
    console.log('Running Finding Validator Agent');

    if (!args.retest_context) {
      console.error('Error: --retest-context is required for the finding_validator role.');
      process.exit(1);
    }

    const retestContext = loadRetestContext(args.retest_context, currentWorkingDir);
    const outputFile = validateOutputFile(
      args.output_file || 'retest_verdict.json',
      currentWorkingDir
    );

    const tmpSrcDir = args.src_dir
      ? validateAndCopySrcDir(args.src_dir, currentWorkingDir)
      : null;

    const userPrompt = buildFindingValidatorPrompt(retestContext);

    const structuredResult = await agentActions.findingValidatorWithOptions(userPrompt, tmpSrcDir);
    if (structuredResult) {
      fs.writeFileSync(outputFile, structuredResult, 'utf-8');
      console.log(`Retest verdict written to ${outputFile}`);
    }
    cleanupTmpDir(tmpSrcDir);

  } else if (args.role === 'context_extractor') {
    console.log('Running Context Extractor Agent');

    if (!args.extract_context) {
      console.error('Error: --extract-context is required for the context_extractor role.');
      process.exit(1);
    }

    const extractionContext = loadExtractionContext(args.extract_context, currentWorkingDir);
    const outputFile = validateOutputFile(
      args.output_file || 'context_extraction.json',
      currentWorkingDir
    );

    console.log(`Extracting context for ${extractionContext.owner}/${extractionContext.repo} (${extractionContext.files.length} files)`);

    const userPrompt = buildContextExtractorPrompt(extractionContext);
    const structuredResult = await agentActions.contextExtractorWithOptions(userPrompt);
    if (structuredResult) {
      fs.writeFileSync(outputFile, structuredResult, 'utf-8');
      console.log(`Context extraction written to ${outputFile}`);
    }

  } else {
    console.error(`Error: Invalid appsec AI agent role: ${args.role} - refer to 'appsec_agent.yaml' for available roles`);
    process.exit(1);
  }
  
  process.exit(0);
}

