/**
 * Agent Options Management for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import { Options, AgentDefinition, PermissionResult, CanUseTool } from '@anthropic-ai/claude-agent-sdk';
import { ConfigDict } from './utils';
import { SECURITY_REPORT_SCHEMA } from './schemas/security_report';
import { QA_REPORT_SCHEMA } from './schemas/qa_report';
import { THREAT_MODEL_REPORT_SCHEMA } from './schemas/threat_model_report';
import { FIX_OUTPUT_SCHEMA } from './schemas/security_fix';
import { QA_VERDICT_SCHEMA } from './schemas/qa_context';
import { RETEST_VERDICT_SCHEMA } from './schemas/finding_validator';
import { CONTEXT_EXTRACTION_SCHEMA } from './schemas/context_extraction';
import { LEARNED_GUIDANCE_OUTPUT_SCHEMA } from './schemas/learned_guidance';
import { FP_ADVERSARY_REPORT_SCHEMA } from './schemas/fp_adversary_pass';
import type { RoleSpec } from './providers/role_spec';
import { roleSpecToClaudeOptions } from './providers/claude_role_spec';
import {
  DEFAULT_MCP_SERVER_NAME,
  MCP_INTERNAL_SERVER_NAME,
  MCP_INTERNAL_TOOL_NAMES,
  buildMcpInternalToolNames,
  attachMcpToRoleSpec,
} from './mcp_internal';

export {
  DEFAULT_MCP_SERVER_NAME,
  MCP_INTERNAL_SERVER_NAME,
  MCP_INTERNAL_TOOL_NAMES,
  buildMcpInternalToolNames,
};

const FIX_CODE_VS_OPTIONS_GUIDANCE = `

FIXED CODE vs FIX OPTIONS:
- Use "fixed_code" ONLY for executable, compilable code that directly replaces the vulnerable code_snippet.
  Never put comments, recommendations, or "Option 1: ..." text into fixed_code.
- Use "fix_options" when the fix requires architectural decisions, domain-specific knowledge,
  or when multiple valid remediation approaches exist. Each option needs an id, title, and description.
- Provide either fixed_code OR fix_options per finding, not both.`;

export interface ToolUsageLog {
  tool: string;
  input: any;
  suggestions: string;
}

/**
 * System-prompt suffix for `pr_reviewer` / `code_reviewer` when
 * `--mcp-server-url` is set. Steers the model toward all live parent-app
 * MCP tools by exact SDK tool id — `queryFindingsHistory`,
 * `queryImportGraph`, `queryRuntimeEnrichment`, `queryCodebaseGraph`, and
 * `queryCrossRepoGraph` (parent-app plan §8.18 Phase 3: bounded structural
 * graph queries; no raw Cypher).
 *
 * v2.8.0: extended to `code_reviewer` (full-repo, Lane 2). Previously only
 * `pr_reviewer` received the nudge; `code_reviewer` had MCP attached only
 * through `getDiffReviewerOptions` when called with `--diff-context`, never
 * through `getCodeReviewerOptions`. Closing that gap is the B5a deliverable.
 *
 * v2.9.0 (Lane 3 Phase 3): added `queryCrossRepoGraph` — the live
 * counterpart to the front-loaded `--cross-repo-context` JSON, so the
 * reviewer can pull peer-project topology (BFF callers, service callees,
 * shared libraries, deployment siblings) and their enforcement notes on
 * demand instead of relying only on the payload captured at scan-start.
 *
 * @param mcpServerName - Same override as `attachMcpServerToOptions`
 *   (`DEFAULT_MCP_SERVER_NAME` when omitted).
 */
export function buildPrReviewerMcpNudgeSystemPromptSuffix(
  mcpServerName: string = DEFAULT_MCP_SERVER_NAME,
): string {
  const name = mcpServerName || DEFAULT_MCP_SERVER_NAME;
  const findingsTool = `mcp__${name}__queryFindingsHistory`;
  const importGraphTool = `mcp__${name}__queryImportGraph`;
  const runtimeTool = `mcp__${name}__queryRuntimeEnrichment`;
  const codebaseGraphTool = `mcp__${name}__queryCodebaseGraph`;
  const crossRepoGraphTool = `mcp__${name}__queryCrossRepoGraph`;
  return `

**Backend-backed MCP tools:** Call \`${findingsTool}\` when prior findings, dismissals, or fingerprint history for the changed files or CWE would affect severity or confidence. Call \`${importGraphTool}\` with the PR file paths when you need authoritative import-graph reachability (callers, entry points) instead of inferring from the diff alone. Call \`${runtimeTool}\` with the changed file paths when you need runtime-incident or hot-files signal for operational risk instead of guessing from the diff alone. Call \`${codebaseGraphTool}\` with \`kind\` + \`target\` when you need symbol-level call-graph signal (callers, callees, reachability, or structural symbol search) from the parent-indexed default-branch graph instead of guessing from the diff alone. Call \`${crossRepoGraphTool}\` (optionally with \`peer_name_filter\`) when a finding's true impact depends on a peer repo you can't see in this diff — e.g. a BFF's fail-open middleware, a shared library's default, or which services call this endpoint — instead of assuming this repo is the whole picture. Prefer these tools over guessing.
`;
}

/**
 * Mutate an already-built `Options` object to attach the MCP server config
 * @deprecated Use attachMcpToRoleSpec + roleSpecToClaudeOptions instead.
 */
function attachMcpServerToOptions(
  options: Options,
  mcpServerUrl: string | undefined,
  agentKey: string,
  mcpServerName: string = DEFAULT_MCP_SERVER_NAME,
  mcpServerBearer?: string,
): void {
  if (!mcpServerUrl) {
    return;
  }
  const serverName = mcpServerName || DEFAULT_MCP_SERVER_NAME;
  const httpEntry: { type: 'http'; url: string; headers?: Record<string, string> } = {
    type: 'http',
    url: mcpServerUrl,
  };
  if (mcpServerBearer) {
    httpEntry.headers = { Authorization: `Bearer ${mcpServerBearer}` };
  }
  options.mcpServers = {
    ...(options.mcpServers ?? {}),
    [serverName]: httpEntry,
  };
  const agent = options.agents?.[agentKey] as AgentDefinition | undefined;
  if (agent) {
    const existingTools = agent.tools ?? [];
    agent.tools = [...existingTools, ...buildMcpInternalToolNames(serverName)];
  }
}

export class AgentOptions {
  private confDict: ConfigDict;
  private environment: string;
  private model: string;
  private toolUsageLog: ToolUsageLog[] = [];

  constructor(confDict: ConfigDict, environment: string, model: string = 'opus') {
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
  getSimpleQueryAgentRoleSpec(role: string = 'simple_query_agent', srcDir?: string | null): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are an Application Security (AppSec) expert assistant. You are responsible for providing security advice and guidance to the user.';

    if (srcDir) {
      systemPrompt += ` You have access to a source code directory at ${srcDir} that you can search and read files from to answer questions.`;
    }

    return {
      roleId: 'simple_query_agent',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns || 1,
      capabilities: {},
      noTools: true,
      model: this.model,
      workingDirectory: srcDir ?? undefined,
    };
  }

  getSimpleQueryAgentOptions(role: string = 'simple_query_agent', srcDir?: string | null): Options {
    return roleSpecToClaudeOptions(this.getSimpleQueryAgentRoleSpec(role, srcDir));
  }

  /**
   * Get options for security code reviewer
   *
   * v2.8.0 (B5a fix): now accepts MCP server params and calls
   * `attachMcpServerToOptions` to wire the parent-app per-scan MCP server.
   * Previously the backend pushed `--mcp-server-name` to the spawn but the
   * SDK was never told MCP tools existed — the full-repo code_reviewer ran
   * without `queryFindingsHistory` / `queryImportGraph` /
   * `queryCodebaseGraph` / `queryRuntimeEnrichment` access despite the
   * parent app starting the server. Mirror's `getDiffReviewerOptions`
   * pattern and includes the same system-prompt nudge as `pr_reviewer` so
   * the agent discovers the tools.
   *
   * @param role - The role configuration key
   * @param outputFormat - Output format (json, markdown, etc.)
   * @param mcpServerUrl - Parent-app per-scan MCP server URL
   * @param mcpServerName - Override for the MCP server identifier
   * @param mcpServerBearer - Bearer token for MCP HTTP requests
   */
  getCodeReviewerRoleSpec(
    role: string = 'code_reviewer',
    outputFormat?: string,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
    workingDirectory?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review. List out all the potential security and privacy issues found in the code.';

    if (outputFormat?.toLowerCase() === 'json') {
      systemPrompt += FIX_CODE_VS_OPTIONS_GUIDANCE;
    }
    if (mcpServerUrl) {
      systemPrompt += buildPrReviewerMcpNudgeSystemPromptSuffix(mcpServerName);
    }

    const spec: RoleSpec = {
      roleId: 'code_reviewer',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns ?? 30,
      agentName: 'code-reviewer',
      agentDescription: 'Reviews code for best practices and potential security issues only',
      capabilities: { read: true, grep: true, write: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      workingDirectory,
    };

    if (outputFormat?.toLowerCase() === 'json') {
      spec.outputSchema = SECURITY_REPORT_SCHEMA;
    }

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getCodeReviewerOptions(
    role: string = 'code_reviewer',
    outputFormat?: string,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getCodeReviewerRoleSpec(
      role,
      outputFormat,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  /**
   * Provider-neutral spec for threat modeler (Phase 3 RoleSpec spike).
   */
  getThreatModelerRoleSpec(
    role: string = 'threat_modeler',
    outputFormat?: string,
    workingDirectory?: string,
    maxTurnsOverride?: number,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are an Application Security (AppSec) expert assistant. You are responsible for performing risk assessment on the source code repository for SOC2 type 2 compliance audit using the STRIDE methodology.';

    const isJson = outputFormat?.toLowerCase() === 'json';
    const resolvedMaxTurns = maxTurnsOverride ?? roleConfig?.options?.max_turns ?? 100;

    const spec: RoleSpec = {
      roleId: 'threat_modeler',
      systemPrompt,
      maxTurns: resolvedMaxTurns,
      agentName: 'threat-modeler',
      agentDescription: 'Performs threat modeling and risk assessment using STRIDE methodology',
      capabilities: isJson
        ? { read: true, grep: true }
        : { read: true, grep: true, write: true, graphviz: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      workingDirectory,
    };

    if (isJson) {
      spec.outputSchema = THREAT_MODEL_REPORT_SCHEMA;
    }

    return spec;
  }

  /**
   * Get options for threat modeler
   * @param role - The role configuration key
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getThreatModelerOptions(
    role: string = 'threat_modeler',
    outputFormat?: string,
    maxTurnsOverride?: number,
  ): Options {
    return roleSpecToClaudeOptions(
      this.getThreatModelerRoleSpec(role, outputFormat, undefined, maxTurnsOverride),
    );
  }

  getThreatAdversaryRoleSpec(
    role: string = 'threat_adversary',
    srcDir?: string | null,
    maxTurns?: number,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a senior application security engineer performing an adversarial second pass on a STRIDE threat model. ' +
        'Skeptically verify each threat against the real codebase using Read and Grep. ' +
        'Keep only threats with a concrete, demonstrable attack path and confirmed source_locations. ' +
        'Drop generic, mitigated, or ungrounded threats. Reconcile risks and metadata counts.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to verify code paths before keeping a threat.`;
    }

    const spec: RoleSpec = {
      roleId: 'threat_adversary',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 100,
      agentName: 'threat-adversary',
      agentDescription: 'Adversarial second pass: filters STRIDE threats by concrete code-grounded attack paths',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: THREAT_MODEL_REPORT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    return spec;
  }

  getThreatAdversaryOptions(
    role: string = 'threat_adversary',
    srcDir?: string | null,
    maxTurns?: number,
  ): Options {
    return roleSpecToClaudeOptions(this.getThreatAdversaryRoleSpec(role, srcDir, maxTurns));
  }

  /**
   * Get options for PR diff-focused code reviewer
   * This mode analyzes only the changed code from a pull request,
   * with access to Read and Write tools for additional context if needed.
   * @param role - The role configuration key
   * @param srcDir - Optional source directory path
   * @param outputFormat - Output format (json, markdown, etc.)
   */
  getDiffReviewerRoleSpec(
    role: string = 'code_reviewer',
    srcDir?: string | null,
    outputFormat?: string,
    maxTurns?: number,
    noTools?: boolean,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];

    let systemPrompt: string;

    if (noTools) {
      systemPrompt = `You are an Application Security (AppSec) expert assistant specializing in Pull Request security reviews.

Your task is to analyze the changed code provided in the diff context for security vulnerabilities.

The diff context already includes relevant imports, function signatures, and surrounding code for each changed file. Produce your complete security review report directly from this provided context.

Context that should reduce or eliminate false positives:
- TypeScript strict mode and strong typing (e.g., numeric params can't be SQL-injected)
- ORM usage with parameterized queries (Prisma, TypeORM, Sequelize, Knex, Drizzle)
- Security middleware (helmet, csurf, express-rate-limit, cors)
- Input validation libraries (zod, joi, class-validator)
- Framework-provided protections (React auto-escapes JSX, Next.js built-in CSRF)

When reviewing PR changes:
1. Focus on security implications of the new or modified code
2. Consider whether the surrounding context (imports, function signatures) suggests mitigations
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Rate your confidence (high/medium/low) for each finding`;
    } else {
      systemPrompt = `You are an Application Security (AppSec) expert assistant specializing in Pull Request security reviews.

Your task is to analyze the changed code provided in the diff context for security vulnerabilities.

IMPORTANT: Before reporting a finding, verify it by gathering additional context:
- Use Grep to search for sanitization functions, middleware, validation logic, or security configurations that may mitigate the issue
- Use Read to inspect imported modules, utility functions, or configuration files referenced in the diff
- Check if the project uses an ORM (parameterized queries), security headers (helmet), input validation (zod/joi), or auth middleware

Context that should reduce or eliminate false positives:
- TypeScript strict mode and strong typing (e.g., numeric params can't be SQL-injected)
- ORM usage with parameterized queries (Prisma, TypeORM, Sequelize, Knex, Drizzle)
- Security middleware (helmet, csurf, express-rate-limit, cors)
- Input validation libraries (zod, joi, class-validator)
- Framework-provided protections (React auto-escapes JSX, Next.js built-in CSRF)

When reviewing PR changes:
1. Focus on security implications of the new or modified code
2. VERIFY findings by reading referenced files before reporting them
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Rate your confidence (high/medium/low) for each finding

You have access to Read, Grep, and Write tools:
- Grep: Search the codebase for patterns (e.g., function definitions, middleware, configs)
- Read: Read full file contents for additional context
- Write: Write the security review report`;
    }

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}`;
    }

    if (roleConfig?.options?.diff_reviewer_system_prompt) {
      systemPrompt = roleConfig.options.diff_reviewer_system_prompt;
    }

    if (outputFormat?.toLowerCase() === 'json') {
      systemPrompt += FIX_CODE_VS_OPTIONS_GUIDANCE;
    }

    if (experimentEnabled) {
      systemPrompt += `

**Experiment (treatment arm):** Apply stricter false-positive controls. Before reporting a finding, require a concrete failure or exploit path visible from the diff or verified in-repo (Grep/Read). Prefer MEDIUM over HIGH when evidence is mostly circumstantial.`;
    }

    if (mcpServerUrl && role === 'pr_reviewer') {
      systemPrompt += buildPrReviewerMcpNudgeSystemPromptSuffix(mcpServerName);
    }

    const spec: RoleSpec = {
      roleId: role === 'pr_reviewer' ? 'pr_reviewer' : 'code_reviewer',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 10,
      agentName: 'diff-reviewer',
      agentDescription: 'Reviews PR diff changes for security vulnerabilities',
      capabilities: noTools ? {} : { read: true, grep: true, write: true },
      allowedTools: noTools ? ['Write'] : undefined,
      permissionMode: 'bypassPermissions',
      model: this.model,
      workingDirectory: srcDir ?? undefined,
    };

    if (outputFormat?.toLowerCase() === 'json') {
      spec.outputSchema = SECURITY_REPORT_SCHEMA;
    }

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getDiffReviewerOptions(
    role: string = 'code_reviewer',
    srcDir?: string | null,
    outputFormat?: string,
    maxTurns?: number,
    noTools?: boolean,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getDiffReviewerRoleSpec(
      role,
      srcDir,
      outputFormat,
      maxTurns,
      noTools,
      experimentEnabled,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  getCodeFixerRoleSpec(
    role: string = 'code_fixer',
    srcDir?: string | null,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are an expert security engineer specializing in fixing vulnerabilities in code. ' +
        'You receive a finding with code context and must produce a precise, minimal fix that resolves ' +
        "the security issue while preserving the original code's functionality and indentation. " +
        'Only modify the affected lines. Always use the recommended secure alternatives when applicable.';

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}. You may read files for additional context if needed.`;
    }

    const spec: RoleSpec = {
      roleId: 'code_fixer',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns ?? 10,
      agentName: 'code-fixer',
      agentDescription: 'Generates precise security fixes for code vulnerabilities',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: FIX_OUTPUT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getCodeFixerOptions(
    role: string = 'code_fixer',
    srcDir?: string | null,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getCodeFixerRoleSpec(
      role,
      srcDir,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  getQaVerifierRoleSpec(role: string = 'qa_verifier', srcDir?: string | null): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      "You are a QA verification engineer. Your task is to verify security fixes by running the project's test suite " +
        'and analyzing the results. You have access to the project source code and can execute shell commands to run tests. ' +
        'First, set up the environment (install dependencies if needed), then run the test suite. ' +
        'If tests fail, analyze the failures to determine if they are caused by the security fix or are pre-existing issues. ' +
        'Provide a structured verdict with pass/fail status, failure details, and actionable suggestions.';

    if (srcDir) {
      systemPrompt += `\n\nProject source code is available at: ${srcDir}. Use Read and Grep to inspect files, and Bash to execute commands.`;
    }

    return {
      roleId: 'qa_verifier',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns ?? 15,
      agentName: 'qa-verifier',
      agentDescription: 'Verifies security fixes by running project tests and analyzing results',
      capabilities: { read: true, grep: true, shell: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: QA_VERDICT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };
  }

  getQaVerifierOptions(role: string = 'qa_verifier', srcDir?: string | null): Options {
    return roleSpecToClaudeOptions(this.getQaVerifierRoleSpec(role, srcDir));
  }

  getContextExtractorRoleSpec(role: string = 'context_extractor'): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a security-aware software analyst. Your task is to analyze repository files and metadata ' +
        'to extract structured intelligence about a project. Focus on accuracy and specificity. ' +
        'For security_context, list concrete library names and mechanisms (e.g., "bcrypt for password hashing", ' +
        '"Django ORM with parameterized queries"). For developer_context, include ONLY security-relevant guidance ' +
        '(PHI handling, SQL injection rules, auth patterns, compliance requirements) — exclude generic coding style, ' +
        'formatting, naming conventions, and UI/component patterns. For suggested_exclusions, carefully study the ' +
        'repository tree structure at ALL nesting depths to identify directories containing non-production code: ' +
        'generated/compiled output, vendored copies, migrations, seed data, visual assets, log/temp/runtime dirs ' +
        '(logs, uploads, work-dir, data), IDE config (.cursor, .vscode), utility scripts, and documentation. Use ' +
        'specific paths from the tree (e.g., "backend/scripts/**" not just "scripts/**"). Only suggest patterns NOT ' +
        'already in the standard preset. If a field has no relevant information, return an empty string.';

    return {
      roleId: 'context_extractor',
      systemPrompt,
      maxTurns: 1,
      agentName: 'context-extractor',
      agentDescription: 'Extracts structured project intelligence from repository files',
      capabilities: {},
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: CONTEXT_EXTRACTION_SCHEMA,
    };
  }

  getContextExtractorOptions(role: string = 'context_extractor'): Options {
    return roleSpecToClaudeOptions(this.getContextExtractorRoleSpec(role));
  }

  getFindingValidatorRoleSpec(
    role: string = 'finding_validator',
    srcDir?: string | null,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a security expert specializing in vulnerability validation. ' +
        'Your task is to analyze code and determine whether a previously detected security vulnerability ' +
        'is still present. Examine the provided code carefully, considering the original finding details, ' +
        'and return a structured verdict with your assessment.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to inspect files for additional context if needed.`;
    }

    const spec: RoleSpec = {
      roleId: 'finding_validator',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns ?? 5,
      agentName: 'finding-validator',
      agentDescription:
        'Validates whether a previously detected security vulnerability is still present in code',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: RETEST_VERDICT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getFindingValidatorOptions(
    role: string = 'finding_validator',
    srcDir?: string | null,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getFindingValidatorRoleSpec(
      role,
      srcDir,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  getLearnedGuidanceSynthesizerRoleSpec(role: string = 'learned_guidance_synthesizer'): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    const systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a senior application security engineer summarizing patterns from past PR-scan ' +
        'dismissals into class-level policy bullets that a future code reviewer can apply to AVOID ' +
        'raising the same false-positive class again. You operate ONLY on the buckets provided in ' +
        'the user prompt — you have no Read/Grep tools, no source-tree access, and no MCP server. ' +
        'Emit one bullet per CWE bucket where the example reasons converge on a specific, citable ' +
        'pattern (file path, library, framework feature). When the reasons disagree or are too ' +
        'vague to ground a specific rule, OMIT that bucket entirely — it is better to return zero ' +
        'bullets than a bullet the reviewer cannot act on. Output is constrained to the required ' +
        'JSON schema; emit nothing else.';

    return {
      roleId: 'learned_guidance_synthesizer',
      systemPrompt,
      maxTurns: roleConfig?.options?.max_turns ?? 1,
      agentName: 'learned-guidance-synthesizer',
      agentDescription:
        'Synthesizes class-level learned-guidance bullets from per-CWE dismissal-signal buckets',
      capabilities: {},
      allowedTools: [],
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: LEARNED_GUIDANCE_OUTPUT_SCHEMA,
    };
  }

  getLearnedGuidanceSynthesizerOptions(role: string = 'learned_guidance_synthesizer'): Options {
    return roleSpecToClaudeOptions(this.getLearnedGuidanceSynthesizerRoleSpec(role));
  }

  getPrAdversaryRoleSpec(
    role: string = 'pr_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a senior application security engineer performing an adversarial second pass on security findings. ' +
        'You skeptically test whether each reported issue has a *concrete* failure or exploit path in the real code. ' +
        'You have Read and Grep to verify mitigations, reachability, and false positives. ' +
        'Your output is only the filtered security report JSON: drop findings you cannot ground in a specific exploit or failure path.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to verify code paths before keeping a finding.`;
    }
    if (experimentEnabled) {
      systemPrompt +=
        '\n\n**Experiment (treatment):** Bias toward dropping borderline issues unless the diff plus quick repo checks show a real attack surface.';
    }

    const spec: RoleSpec = {
      roleId: 'pr_adversary',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 15,
      agentName: 'pr-adversary',
      agentDescription: 'Adversarial second pass: filters PR scan findings by concrete failure paths',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: SECURITY_REPORT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getPrAdversaryOptions(
    role: string = 'pr_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getPrAdversaryRoleSpec(
      role,
      srcDir,
      maxTurns,
      experimentEnabled,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  /**
   * Lane 5 — PR QA / correctness reviewer (sibling of `pr_reviewer`).
   * Distinct from remediation `qa_verifier` (Lane 3b).
   */
  getPrQaReviewerRoleSpec(
    role: string = 'pr_qa_reviewer',
    srcDir?: string | null,
    outputFormat?: string,
    maxTurns?: number,
    noTools?: boolean,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];

    let systemPrompt: string;

    if (noTools) {
      systemPrompt = `You are a senior software QA engineer specializing in Pull Request correctness reviews.

Your task is to analyze the changed code provided in the diff context for logic and correctness bugs — not security vulnerabilities (those are handled by a separate security reviewer).

The diff context already includes relevant imports, function signatures, and surrounding code for each changed file. Produce your complete QA review report directly from this provided context.

Correctness checklist (flag only bugs you can ground in the diff):
- Null / undefined dereferences and missing optional chaining
- Unhandled errors, rejected promises, or swallowed exceptions
- Resource leaks (unclosed handles, listeners, streams, timers)
- Off-by-one and boundary / empty-collection edge cases
- Incorrect conditionals, inverted logic, wrong operators
- Race conditions, await-in-loop hazards, missing await
- Type coercion surprises and unsafe casts
- Dead or unreachable branches introduced by the change
- API contract misuse (wrong args, ignored return values, broken invariants)

When reviewing PR changes:
1. Focus on correctness of the new or modified code
2. Consider whether surrounding context suggests the bug is unreachable or already guarded
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Do NOT report style, naming, or pure refactor suggestions
6. For each finding provide reproduction_steps and a short causal_chain
7. Rate your confidence (high/medium/low) for each finding`;
    } else {
      systemPrompt = `You are a senior software QA engineer specializing in Pull Request correctness reviews.

Your task is to analyze the changed code provided in the diff context for logic and correctness bugs — not security vulnerabilities (those are handled by a separate security reviewer).

IMPORTANT: Before reporting a finding, verify it by gathering additional context:
- Use Grep to search for guards, error handlers, null checks, or callers that may mitigate the issue
- Use Read to inspect imported modules, utility functions, or configuration files referenced in the diff
- Confirm the buggy path is reachable from the changed lines

Correctness checklist (flag only bugs you can ground in the diff):
- Null / undefined dereferences and missing optional chaining
- Unhandled errors, rejected promises, or swallowed exceptions
- Resource leaks (unclosed handles, listeners, streams, timers)
- Off-by-one and boundary / empty-collection edge cases
- Incorrect conditionals, inverted logic, wrong operators
- Race conditions, await-in-loop hazards, missing await
- Type coercion surprises and unsafe casts
- Dead or unreachable branches introduced by the change
- API contract misuse (wrong args, ignored return values, broken invariants)

When reviewing PR changes:
1. Focus on correctness of the new or modified code
2. VERIFY findings by reading referenced files before reporting them
3. Cite specific line numbers from the provided diff
4. Do NOT report issues in unchanged code
5. Do NOT report style, naming, or pure refactor suggestions
6. For each finding provide reproduction_steps and a short causal_chain (x -> y -> z)
7. Rate your confidence (high/medium/low) for each finding

You have access to Read, Grep, and Write tools:
- Grep: Search the codebase for patterns (e.g., callers, guards, error handlers)
- Read: Read full file contents for additional context
- Write: Write the QA review report`;
    }

    if (srcDir) {
      systemPrompt += `\n\nSource directory available at: ${srcDir}`;
    }

    if (roleConfig?.options?.diff_reviewer_system_prompt) {
      systemPrompt = roleConfig.options.diff_reviewer_system_prompt;
    }

    if (experimentEnabled) {
      systemPrompt += `

**Experiment (treatment arm):** Apply stricter false-positive controls. Before reporting a finding, require concrete reproduction_steps and a causal_chain visible from the diff or verified in-repo (Grep/Read). Prefer MEDIUM over HIGH when evidence is mostly circumstantial. Drop stylistic or "could theoretically" issues.`;
    }

    if (mcpServerUrl) {
      systemPrompt += buildPrReviewerMcpNudgeSystemPromptSuffix(mcpServerName);
    }

    const spec: RoleSpec = {
      roleId: 'pr_qa_reviewer',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 10,
      agentName: 'pr-qa-reviewer',
      agentDescription: 'Reviews PR diff changes for correctness / QA bugs',
      capabilities: noTools ? {} : { read: true, grep: true, write: true },
      allowedTools: noTools ? ['Write'] : undefined,
      permissionMode: 'bypassPermissions',
      model: this.model,
      workingDirectory: srcDir ?? undefined,
    };

    if (outputFormat?.toLowerCase() === 'json') {
      spec.outputSchema = QA_REPORT_SCHEMA;
    }

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getPrQaReviewerOptions(
    role: string = 'pr_qa_reviewer',
    srcDir?: string | null,
    outputFormat?: string,
    maxTurns?: number,
    noTools?: boolean,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getPrQaReviewerRoleSpec(
      role,
      srcDir,
      outputFormat,
      maxTurns,
      noTools,
      experimentEnabled,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  /**
   * Lane 5 — adversarial second pass over QA findings (concrete-repro bar).
   */
  getPrQaAdversaryRoleSpec(
    role: string = 'pr_qa_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a senior QA engineer performing an adversarial second pass on correctness findings. ' +
        'You skeptically test whether each reported issue has concrete reproduction_steps and a causal_chain ' +
        '(specific input/state, concrete incorrect outcome, reachability on a changed line). ' +
        'You have Read and Grep to verify guards, reachability, and false positives. ' +
        'Your output is only the filtered qa_review_report JSON: drop findings that are vague, stylistic, or "could theoretically" fail.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to verify code paths before keeping a finding.`;
    }
    if (experimentEnabled) {
      systemPrompt +=
        '\n\n**Experiment (treatment):** Bias toward dropping borderline issues unless the diff plus quick repo checks show a real, reproducible correctness failure.';
    }

    const spec: RoleSpec = {
      roleId: 'pr_qa_adversary',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 15,
      agentName: 'pr-qa-adversary',
      agentDescription:
        'Adversarial second pass: filters PR QA findings by concrete reproduction_steps + causal_chain',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: QA_REPORT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getPrQaAdversaryOptions(
    role: string = 'pr_qa_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    experimentEnabled?: boolean,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getPrQaAdversaryRoleSpec(
      role,
      srcDir,
      maxTurns,
      experimentEnabled,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }

  getFpAdversaryRoleSpec(
    role: string = 'fp_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): RoleSpec {
    const roleConfig = this.confDict[this.environment]?.[role];
    let systemPrompt =
      roleConfig?.options?.system_prompt ||
      'You are a senior application security engineer performing an adversarial false-positive review on a full-repository security scan. ' +
        'For each candidate finding, return a verdict (confirm or dismiss) with a numeric 0.0-1.0 confidence and a concrete rationale. ' +
        'Weight the supplied project posture (security context, deployment context, developer guidance) when assessing each finding. ' +
        'Use Read/Grep and any available MCP tools to verify reachability before confirming. ' +
        'Dismiss only when you can name the specific mitigation, the reachability gap, or the test-only nature of the code.';

    if (srcDir) {
      systemPrompt += `\n\nSource code is available at: ${srcDir}. Use Read and Grep to verify call paths and mitigations before issuing a verdict.`;
    }

    systemPrompt +=
      '\n\nReturn one JSON object matching the `fp_adversary_report` schema. Each verdict must echo the input `fingerprint` so the parent app can route the verdict to the right finding. Missing verdicts are treated as `confirm` (no silent drops).';

    if (mcpServerUrl) {
      systemPrompt += buildPrReviewerMcpNudgeSystemPromptSuffix(mcpServerName);
    }

    const spec: RoleSpec = {
      roleId: 'fp_adversary',
      systemPrompt,
      maxTurns: maxTurns ?? roleConfig?.options?.max_turns ?? 15,
      agentName: 'fp-adversary',
      agentDescription:
        'Adversarial false-positive filter for full-repo scans: emits per-finding (verdict, confidence, rationale) verdicts',
      capabilities: { read: true, grep: true },
      permissionMode: 'bypassPermissions',
      model: this.model,
      outputSchema: FP_ADVERSARY_REPORT_SCHEMA,
      workingDirectory: srcDir ?? undefined,
    };

    attachMcpToRoleSpec(spec, mcpServerUrl, mcpServerName, mcpServerBearer);
    return spec;
  }

  getFpAdversaryOptions(
    role: string = 'fp_adversary',
    srcDir?: string | null,
    maxTurns?: number,
    mcpServerUrl?: string,
    mcpServerName?: string,
    mcpServerBearer?: string,
  ): Options {
    return roleSpecToClaudeOptions(this.getFpAdversaryRoleSpec(
      role,
      srcDir,
      maxTurns,
      mcpServerUrl,
      mcpServerName,
      mcpServerBearer,
    ));
  }
}

