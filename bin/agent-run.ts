#!/usr/bin/env node
/**
 * CLI script for AppSec AI Agent
 * 
 * Author: Sam Li
 */

import * as path from 'path';
import { Command } from 'commander';

// Use require for CommonJS compatibility
// Both compiled (dist/bin/ → dist/src/) and source (bin/ → src/) use ../src relative path
const { loadYaml, listRoles, printVersionInfo, getProjectRoot } = require(path.join(__dirname, '../src/utils'));
const { main } = require(path.join(__dirname, '../src/main'));

const program = new Command();

program
  .name('agent-run')
  .description('Automate the AppSec AI Agent dispatch')
  .option('-y, --yaml <file>', 'Yaml configuration file - default to "appsec_agent.yaml" in the conf directory')
  .option('-e, --environment <env>', 'Program running environment - default to "development"', 'development')
  .option('-r, --role <role>', 'AppSec AI Agent role, refer to "appsec_agent.yaml" for available roles - default to "simple_query_agent"', 'simple_query_agent')
  .option('-s, --src_dir <dir>', 'Project source code directory for code review agent - default to "src"')
  .option('-o, --output_file <file>', 'Output file - default based on role and format (e.g., code_review_report.json)')
  .option('-f, --output_format <format>', 'Output format: markdown, json, xml, csv, xlsx - default to "markdown"', 'markdown')
  .option('-k, --anthropic-api-key <key>', 'Anthropic API key (overrides ANTHROPIC_API_KEY environment variable)')
  .option('-u, --anthropic-base-url <url>', 'Anthropic API base URL (overrides ANTHROPIC_BASE_URL environment variable)')
  .option('-c, --context <context>', 'Additional context for the code review (e.g., deployment environment, architecture, compliance requirements)')
  .option('--diff-context <file>', 'JSON file with diff context for PR-focused code review (optimizes token usage)')
  .option('--fix-context <file>', 'JSON file with fix context for code_fixer role (finding + code context)')
  .option('--qa-context <file>', 'JSON file with QA context for qa_verifier role (PR URL + test configuration)')
  .option('--retest-context <file>', 'JSON file with retest context for finding_validator role (finding + code snippet)')
  .option(
    '--adversarial-context <file>',
    'JSON file with candidate findings for pr_adversary second pass (v5.3.0; use with -r pr_adversary)',
  )
  .option(
    '--import-graph-context <file>',
    'JSON file with per-file import-graph reachability summary (v5.4.0, plan §3.1 Stage B; use with -r pr_reviewer)',
  )
  .option(
    '--runtime-enrichment-context <file>',
    'JSON file with per-file production-incident summary for hot files (v2.3.0 / sast-ai-app plan §4 + §8.14; use with -r pr_reviewer)',
  )
  .option(
    '--experiment-enabled',
    'A/B treatment arm: stricter FP controls for pr_reviewer diff mode; optional variant for pr_adversary',
  )
  .option('--extract-context <file>', 'JSON file with extraction context for context_extractor role (repo metadata + files)')
  .option('--diff-max-tokens <n>', 'Max tokens per batch for PR chunking (0 = disabled). Overrides config.')
  .option('--diff-max-batches <n>', 'Max batches per PR run (e.g. 3). Overrides config.')
  .option('--diff-max-files <n>', 'Max files to include in PR review; rest skipped. Overrides config.')
  .option('--diff-exclude <pattern>', 'Exclude path pattern (repeatable). Overrides config.', (v: string, acc: string[]) => { acc.push(v); return acc; }, [])
  .option('-m, --model <model>', 'Claude model: family alias (sonnet, opus, haiku), SDK model ID (claude-sonnet-4-6), or version prefix (sonnet-4-6) - default to "opus"', 'opus')
  .option('-F, --failover', 'Enable failover to OpenAI when Anthropic fails (optional feature, off by default). Overrides FAILOVER_ENABLED env.')
  .option('-K, --openai-api-key <key>', 'OpenAI API key for failover (overrides OPENAI_API_KEY env). Only used when failover is enabled.')
  .option('-U, --openai-base-url <url>', 'OpenAI API base URL for failover (overrides OPENAI_BASE_URL env). Only used when failover is enabled.')
  .option('--max-turns <n>', 'Max agent turns (tool-use iterations). Overrides per-role default.')
  .option('--no-tools', 'Disable Read/Grep tools for single-turn analysis (use with --diff-context for fastest mode)')
  .option('-l, --list_roles', 'List all available roles')
  .option('-v, --version', 'Program version')
  .option('-V, --verbose', 'Verbose mode');

program.parse();

const options = program.opts();

// Handle version flag
if (options.version) {
  printVersionInfo();
  process.exit(0);
}

// Set default yaml configuration file
const yamlFile = options.yaml || path.join(getProjectRoot(), 'conf', 'appsec_agent.yaml');

console.log('Reading AppSec AI agent configuration file:', yamlFile);
const confDict = loadYaml(yamlFile, options.verbose);

if (!confDict) {
  console.error('Failed to load configuration file');
  process.exit(1);
}

console.log('AppSec AI agent configuration file read successfully');

// Handle list roles flag
if (options.list_roles) {
  console.log('Listing all available AppSec AI agent roles');
  listRoles(confDict, options.environment);
  process.exit(0);
}

// Set Anthropic API environment variables if provided via command line
// SECURITY WARNING: Passing API keys via command line is insecure as they may be visible
// in process lists and shell history. Prefer using environment variables.
if (options.anthropicApiKey) {
  console.warn('⚠️  SECURITY WARNING: API key provided via command line argument.');
  console.warn('   Command-line arguments may be visible in process lists and shell history.');
  console.warn('   For better security, use the ANTHROPIC_API_KEY environment variable instead.\n');
  process.env.ANTHROPIC_API_KEY = options.anthropicApiKey;
}
if (options.anthropicBaseUrl) {
  process.env.ANTHROPIC_BASE_URL = options.anthropicBaseUrl;
}

// Failover: CLI overrides env. Set env so adapter reads them.
if (options.failover !== undefined) {
  process.env.FAILOVER_ENABLED = options.failover ? 'true' : 'false';
}
if (options.openaiApiKey !== undefined) {
  console.warn('⚠️  SECURITY WARNING: OpenAI API key provided via command line argument.');
  console.warn('   For better security, use the OPENAI_API_KEY environment variable instead.\n');
  process.env.OPENAI_API_KEY = options.openaiApiKey;
}
if (options.openaiBaseUrl !== undefined) {
  process.env.OPENAI_BASE_URL = options.openaiBaseUrl;
}

// Validate model option: accept family aliases, SDK model IDs, or version prefixes
const FAMILY_ALIASES = ['sonnet', 'opus', 'haiku'];
const model = options.model.toLowerCase().trim();
const isValidModel = FAMILY_ALIASES.includes(model)
  || model.startsWith('claude-')
  || FAMILY_ALIASES.some(f => model.startsWith(`${f}-`));
if (!isValidModel) {
  console.error(`Error: Invalid model "${options.model}". Valid formats: family alias (sonnet, opus, haiku), SDK model ID (claude-sonnet-4-6), or version prefix (sonnet-4-6)`);
  process.exit(1);
}

// Prepare args (chunking: CLI overrides config; main will merge with conf)
const args = {
  role: options.role,
  environment: options.environment,
  src_dir: options.src_dir,
  output_file: options.output_file,
  output_format: options.output_format,
  verbose: options.verbose,
  context: options.context,
  diff_context: options.diffContext,
  fix_context: options.fixContext,
  qa_context: options.qaContext,
  retest_context: options.retestContext,
  extract_context: options.extractContext,
  adversarial_context: options.adversarialContext,
  import_graph_context: options.importGraphContext,
  runtime_enrichment_context: options.runtimeEnrichmentContext,
  experiment_enabled: options.experimentEnabled === true,
  model: model,
  diff_max_tokens_per_batch: options.diffMaxTokens !== undefined ? parseInt(options.diffMaxTokens, 10) : undefined,
  diff_max_batches: options.diffMaxBatches !== undefined ? parseInt(options.diffMaxBatches, 10) : undefined,
  diff_max_files: options.diffMaxFiles !== undefined ? parseInt(options.diffMaxFiles, 10) : undefined,
  diff_exclude: Array.isArray(options.diffExclude) && options.diffExclude.length > 0 ? options.diffExclude : undefined,
  max_turns: options.maxTurns !== undefined ? parseInt(options.maxTurns, 10) : undefined,
  no_tools: options.noTools === true,
};

// Log context if provided
if (args.context) {
  console.log('Using context:', args.context.substring(0, 50) + (args.context.length > 50 ? '...' : ''));
}

// Log diff context if provided and validate role compatibility
if (args.diff_context) {
  console.log('Using diff context file:', args.diff_context);
  if (args.role !== 'code_reviewer' && args.role !== 'pr_reviewer') {
    console.warn('⚠️  Warning: --diff-context is only used with the code_reviewer or pr_reviewer role.');
    console.warn(`   Current role: ${args.role}. The diff context will be ignored.`);
    console.warn('   Use -r code_reviewer or -r pr_reviewer to enable PR diff-focused code review.\n');
  }
}

// v5.4.0 / plan §3.1 Stage B: import-graph context is only consumed by the
// pr_reviewer diff-mode prompt. Other roles simply ignore it (fail-open).
if (args.import_graph_context) {
  console.log('Using import-graph context file:', args.import_graph_context);
  if (!(args.role === 'pr_reviewer' && args.diff_context)) {
    console.warn('⚠️  Warning: --import-graph-context is only consumed by pr_reviewer in diff-context mode.');
    console.warn(`   Current role: ${args.role}${args.diff_context ? '' : ' (no --diff-context supplied)'}. The import-graph context will be ignored.`);
    console.warn('   Use -r pr_reviewer --diff-context <file> to enable Stage B reachability hints.\n');
  }
}

// v2.3.0 / sast-ai-app plan §4 + §8.14: runtime-enrichment context is only
// consumed by the pr_reviewer diff-mode prompt. Same role-gate as
// --import-graph-context — other roles simply ignore it (fail-open).
if (args.runtime_enrichment_context) {
  console.log('Using runtime-enrichment context file:', args.runtime_enrichment_context);
  if (!(args.role === 'pr_reviewer' && args.diff_context)) {
    console.warn('⚠️  Warning: --runtime-enrichment-context is only consumed by pr_reviewer in diff-context mode.');
    console.warn(`   Current role: ${args.role}${args.diff_context ? '' : ' (no --diff-context supplied)'}. The runtime-enrichment context will be ignored.`);
    console.warn('   Use -r pr_reviewer --diff-context <file> to enable §4 hot-file hints.\n');
  }
}

// Run main function
main(confDict, args).catch((error: Error) => {
  console.error('Error running agent:', error);
  process.exit(1);
});
