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

// Prepare args
const args = {
  role: options.role,
  environment: options.environment,
  src_dir: options.src_dir,
  output_file: options.output_file,
  output_format: options.output_format,
  verbose: options.verbose,
  context: options.context
};

// Log context if provided
if (args.context) {
  console.log('Using context:', args.context.substring(0, 50) + (args.context.length > 50 ? '...' : ''));
}

// Run main function
main(confDict, args).catch((error: Error) => {
  console.error('Error running agent:', error);
  process.exit(1);
});
