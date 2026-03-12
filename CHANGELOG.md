# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.4] - 2026-03-12

### Changed
- **Flatten `RETEST_VERDICT_SCHEMA`**: Removed the `name`/`strict`/`schema` wrapper from `RETEST_VERDICT_SCHEMA` in `src/schemas/finding_validator.ts`, aligning it with the flat `Record<string, unknown>` pattern used by the other schemas (`SECURITY_REPORT_SCHEMA`, `THREAT_MODEL_REPORT_SCHEMA`, `FIX_OUTPUT_SCHEMA`).
- Updated tests in `finding_validator.test.ts` and `agent_options.test.ts` to match the new flat schema structure.
- Version bump to 1.8.4.

## [1.8.3] - 2026-03-12

### Added
- **Finding Validator agent (`finding_validator`)**: New agent role that validates whether a previously detected security vulnerability is still present in code. Receives a finding with code snippet via `--retest-context <file>` and returns a structured JSON verdict (`RetestVerdict`) with `still_present`, `confidence`, `reasoning`, and `current_line`.
  - New `RetestContext` / `RetestContextFinding` / `RetestVerdict` TypeScript interfaces and `RETEST_VERDICT_SCHEMA` JSON schema in `src/schemas/finding_validator.ts`.
  - New `getFindingValidatorOptions()` in `AgentOptions`: configures the `finding-validator` agent with `Read`/`Grep` tools and JSON schema output enforcement.
  - New `findingValidatorWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadRetestContext()` in `src/schemas/finding_validator.ts`: reads/validates retest context JSON with required field checks.
  - New `buildFindingValidatorPrompt()` in `main.ts`: builds a prompt with finding metadata, code snippet, and analysis instructions.
  - New `--retest-context <file>` CLI option in `agent-run`.
  - `finding_validator` role configuration added to `conf/appsec_agent.yaml`.
  - Public exports for `RetestContext`, `RetestContextFinding`, `RetestVerdict`, and `RETEST_VERDICT_SCHEMA` from the package index.
- **Comprehensive test coverage for finding validator**: 16 tests in `finding_validator.test.ts` (context loading, validation branches, schema structure), 6 tests in `agent_options.test.ts` (agent config, default prompt, srcDir, JSON schema, model), 5 tests in `main.test.ts` (missing context error, full run, prompt content, src_dir passthrough, null field handling). Total tests: 313 across 14 suites.

### Changed
- Version bump to 1.8.3.

## [1.8.2] - 2026-03-11

### Changed
- **Default model changed to opus**: The default Claude model is now `opus` instead of `sonnet` for all agent roles. Users can still override with `-m sonnet` or `-m haiku` via the CLI.
- Version bump to 1.8.2.

## [1.8.1] - 2026-03-02

### Added
- **Test coverage for Bash tool**: 20 new tests in `bash_tool.test.ts` covering tool definition, safe command execution, working directory isolation, environment variables, all dangerous pattern blocks (rm -rf, sudo, eval, curl|sh, etc.), error handling, timeout enforcement, and output truncation.
- **Test coverage for QA context**: 18 new tests in `qa_context.test.ts` covering `loadQaContext` validation (missing/invalid `pr_url`, missing/invalid `test_command`, default coercion for `timeout_seconds` and `block_on_failure`, optional fields, invalid JSON, path resolution) and `QA_VERDICT_SCHEMA` structure.
- **Test coverage for getDiffReviewerOptions**: 7 new tests covering agent config, source directory injection, JSON schema enforcement, markdown mode, config override via `diff_reviewer_system_prompt`, and defaults.
- **Test coverage for getQaVerifierOptions**: 6 new tests covering agent config with structured output, default prompt, source directory injection, null srcDir, JSON schema enforcement, and model selection.

### Changed
- Version bump to 1.8.1.
- Total tests: 286 (up from 235). Test suites: 13 (up from 11).
- Coverage improvements: `bash_tool.ts` 0% → 100% stmts, `qa_context.ts` 72% → 100% stmts, `agent_options.ts` 66% → 93% stmts. All schemas at 100%.

## [1.8.0] - 2026-03-02

### Added
- **QA Verifier agent (`qa_verifier`)**: New agent role that verifies security fixes by running the project's test suite and analyzing results. Receives test configuration via `--qa-context <file>` and returns a structured JSON verdict (`QaVerdict`) with pass/fail status, exit code, failure descriptions, logs, analysis, and actionable suggestions.
  - New `QaContext` / `QaVerdict` TypeScript interfaces and `QA_VERDICT_SCHEMA` JSON schema in `src/schemas/qa_context.ts`.
  - New `getQaVerifierOptions()` in `AgentOptions`: configures the `qa-verifier` agent with `Read`, `Grep`, and `Bash` tools and JSON schema output enforcement.
  - New `qaVerifierWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadQaContext()` in `src/schemas/qa_context.ts`: reads/validates QA context JSON with required field checks and defaults.
  - New `buildQaVerifierPrompt()` in `main.ts`: builds a prompt with PR URL, test configuration, deployment context, environment variables, and step-by-step instructions.
  - New `--qa-context <file>` CLI option in `agent-run`.
  - `qa_verifier` role configuration added to `conf/appsec_agent.yaml`.
- **Restricted Bash tool (`src/tools/bash_tool.ts`)**: Controlled shell access for the QA verifier agent with command validation (blocks dangerous patterns like `rm -rf /`, `sudo`, `eval`), timeout enforcement, working directory isolation, and output size limits.
- **Companion test generation for code fixer**: `FixContext` now supports an optional `generate_companion_test` flag. When true, the code fixer prompt includes instructions to generate a companion unit test verifying the fix. `FixOutput` schema extended with optional `test_code`, `test_file`, and `test_framework` fields.
- **New tests**: 5 new QA verifier tests in `main.test.ts` (missing qa-context error, full run, deployment context, test configuration in prompt, src_dir passthrough). Total tests: 235.

### Changed
- Version bump to 1.8.0.

## [1.7.1] - 2026-03-02

### Added
- **Deployment context for threat modeler**: The `threat_modeler` role now accepts `-c/--context` to provide deployment and environment information (e.g., cloud provider, compliance requirements). Context is injected into both JSON and non-JSON prompts so the model can tailor threats, attack vectors, and risk assessments to the actual deployment environment.
- **Deployment context for code fixer**: `FixContext` now supports an optional `deployment_context` field. When present, the code fixer prompt includes a "Deployment & Environment Context" section so fixes consider environment-specific security practices.
- **New tests**: 5 new tests covering context injection for threat modeler (JSON and non-JSON modes, absence case) and code fixer (presence and absence of `deployment_context`).

### Changed
- Version bump to 1.7.1.

## [1.7.0] - 2026-03-02

### Added
- **Code Fixer agent (`code_fixer`)**: New agent role that generates precise, minimal security fixes for code vulnerabilities. Receives a finding with full code context via `--fix-context <file>` and returns a structured JSON fix (`FixOutput`) with `fixed_code`, `start_line`, `end_line`, `explanation`, `confidence`, and `breaking_changes`.
  - New `FixContext` / `FixOutput` TypeScript interfaces and `FIX_OUTPUT_SCHEMA` JSON schema in `src/schemas/security_fix.ts`.
  - New `getCodeFixerOptions()` in `AgentOptions`: configures the `code-fixer` agent with `Read`/`Grep` tools and always-on JSON schema output enforcement.
  - New `codeFixerWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadFixContext()` and `buildCodeFixerPrompt()` in `main.ts`: reads/validates fix context JSON, builds a detailed prompt including finding metadata, code context, indentation rules, line number constraints, and retry support for failed validations.
  - New `--fix-context <file>` CLI option in `agent-run`.
  - `code_fixer` role configuration added to `conf/appsec_agent.yaml`.
  - Public exports for `FixContext`, `FixContextFinding`, `FixContextCodeContext`, `FixOutput`, and `FIX_OUTPUT_SCHEMA` from the package index.
- **Retry support for code fixer**: When a previous fix fails validation, the caller can pass `previous_fix_code` and `validation_errors` in the fix context; the prompt includes a retry section so the model corrects its output.
- **Comprehensive test coverage for code fixer**: 5 new tests in `main.test.ts` (missing fix-context error, full run, prompt content, src_dir passthrough, retry context) and 4 new tests in `agent_options.test.ts` (agent config, default prompt, src_dir in prompt, JSON schema enforcement). Total tests: 225.

### Changed
- Version bump to 1.7.0.

## [1.6.1] - 2026-02-28

### Changed
- **Enable PR diff chunking for `code_reviewer`**: Added `diff_review_max_tokens_per_batch`, `diff_review_max_batches`, and `diff_review_max_files` to `code_reviewer` config, matching `pr_reviewer` defaults (150K tokens/batch, 3 batches, 80 files). Previously `code_reviewer` with `--diff-context` had no chunking, limiting it to a single context window.
- Version bump to 1.6.1.

## [1.6.0] - 2026-02-28

### Added
- **Structured JSON output for threat modeler**: When using `--output-format json`, the threat modeler now enforces a JSON schema (`THREAT_MODEL_REPORT_SCHEMA`) so model output conforms to a defined structure covering Data Flow Diagram (nodes, flows, trust boundaries), STRIDE threat model, and risk registry. Schema and TypeScript types live in `src/schemas/threat_model_report.ts`.
- **Threat model report schema exports**: New public exports for `DFDNode`, `DFDDataFlow`, `DFDTrustBoundary`, `Threat`, `Risk`, `ThreatModelReport`, and `THREAT_MODEL_REPORT_SCHEMA` from the package index.

### Changed
- **Threat modeler agent refactor**: `threatModelerAgentWithOptions` now returns the structured JSON string (instead of empty string) when structured output is available. `main.ts` writes the schema-constrained result to the output file, matching the pattern used by the code reviewer.
- **Threat modeler prompt split**: JSON mode uses a structured analysis prompt (no file writes by the model); non-JSON mode preserves the original ASCII DFD + file-writing behavior.
- **`getThreatModelerOptions` accepts `outputFormat`**: When format is JSON, tools are restricted to read-only (`Read`, `Grep`) and `outputFormat` is set with the threat model schema.
- Removed redundant comments from `agent_actions.ts`.
- Version bump to 1.6.0.

## [1.4.0] - 2026-02-25

### Changed
- **Flatten SecurityFinding schema**: Replaced nested `affected_files` array and complex `remediation` object with flat `file`, `line_numbers`, and `recommendation` fields for simpler report structure.
- **New finding fields**: Added `confidence` (HIGH/MEDIUM/LOW), `code_snippet`, `fixed_code`, `cwe`, and `owasp` fields for richer finding metadata.
- Version bump to 1.4.0.

## [1.3.5] - 2026-02-23

### Fixed
- **JSON report schema conformance**: When output format is JSON, the prompt now instructs the model to provide the report as a structured response (follow the required schema) and not to write the file; the system writes the schema-constrained `structured_output` to the report file. This ensures the root `security_review_report` wrapper and full schema compliance. Applied to both code reviewer and PR diff reviewer (single and batched). When `structuredResult` is present, it is always written to the output file (overwriting any file the model may have written via the Write tool).
- **Version and author in `agent-run -v`**: `getProjectRoot()` now locates the directory containing `package.json` by walking up from `__dirname`, so version and author display correctly when running the compiled CLI (e.g. `node dist/bin/agent-run.js -v` or after `npm install`).

## [1.3.4] - 2026-02-23

### Fixed
- **Write structured output to report file**: `codeReviewerWithOptions` and `diffReviewerWithOptions` now return the structured JSON string. `main.ts` writes it to the output file (e.g., `code_review_report.json`) if Claude didn't use the Write tool. With `outputFormat: { type: 'json_schema' }`, Claude produces the report as `structured_output` on the SDK result and may skip the Write tool entirely. The caller (`main.ts`) knows the correct output path and writes the file, so downstream consumers find it as expected.

## [1.3.3] - 2026-02-23

### Fixed
- **Write structured output to report file** (incomplete): Attempted to write via `this.args.output_file` in `agent_actions.ts`, but the backend doesn't pass `-o` to the CLI, so `output_file` was always undefined. Superseded by v1.3.4.

## [1.3.2] - 2026-02-23

### Fixed
- **Structured output extraction**: When using JSON schema output format (`-f json`), the agent now correctly extracts `structured_output` from the result message. Previously, the structured JSON was returned in `result.structured_output` per Claude SDK spec, but the code only captured conversational text from `assistant.message.content`, causing "No report generated" errors in downstream parsers.

## [1.3.1] - 2026-02-23

### Changed
- Release patch for JSON schema enforcement feature
- Schema enforces `affected_files[].lines` as string format (e.g., `"8-10"`) for compatibility with sast-ai-app parser

## [1.3.0] - 2026-02-12

### Added
- **Structured JSON output for security reports**: When using `--output-format json`, code reviewer and PR diff reviewer now enforce a JSON schema so model output conforms to a defined structure (metadata, executive_summary, findings with severity/category/affected_files/remediation, etc.). Ensures compatibility with the sast-ai-app parser. Schema and TypeScript types live in `src/schemas/security_report.ts`.

## [1.2.1] - 2026-02-12

### Changed
- **Claude Agent SDK**: Upgraded to `@anthropic-ai/claude-agent-sdk@^0.2.39` (parity with Claude Code 2.1.39); peer `@anthropic-ai/claude-code` set to `2.1.39`
- **Dependencies**: Added `zod@^4.0.0` for SDK peer; added `.npmrc` with `legacy-peer-deps=true` to resolve openai optional peer conflict

## [1.2.0] - 2026-02-11

### Added
- **PR diff chunking**: For large PRs that exceed the model context limit, the agent can split the diff into batches, review each batch, and merge reports into a single output file.
  - Config: `diff_review_max_tokens_per_batch`, `diff_review_max_batches`, `diff_review_max_files`, `diff_review_exclude_paths` under **`pr_reviewer.options`** (chunking is **on by default** for `pr_reviewer` when using `-d/--diff-context`). For `code_reviewer`, chunking is off unless set in config or CLI.
  - CLI: `--diff-max-tokens`, `--diff-max-batches`, `--diff-max-files`, `--diff-exclude` (repeatable). Bounded by `max_batches` (e.g. 3) so PR mode does not become a full-repo review.
  - Cost tracking: per-batch and total API cost are logged and (for JSON) included in merged report `meta.total_cost_usd`.
  - New modules: `src/diff_chunking.ts` (token estimation, filtering, batching), `src/diff_report_merge.ts` (merge JSON/Markdown batch reports). Main orchestrates only; feature can be reworked or disabled via config.
  - Merged report may include a **Skipped** section when files are excluded or the batch limit is reached.

## [1.1.0] - 2026-02-11

### Added
- **OpenAI fallback write tool**: When using OpenAI failover (e.g. code review with `-F`), the model can now write the report to a file via a `write_file` tool, matching Anthropic behavior. Tool definition and execution live in `src/openai_tools.ts` for easy maintenance. Writes are restricted to the current working directory via existing path validation.

## [1.0.5] - 2026-02-11

### Added
- **pr_reviewer role**: New role listed in `agent-run -l` for PR-focused security review. Use `-r pr_reviewer` with `-d/--diff-context <file>` for PR diff mode, or without `-d` for full-repo review with PR-focused prompt. Main and CLI treat `pr_reviewer` like `code_reviewer` for routing and diff-context warning.

## [1.0.4] - 2026-02-11

### Added
- **Cost display in failover mode**: When using OpenAI fallback (e.g. simple query with `-F`), the end-of-turn cost is now shown. The adapter requests `stream_options: { include_usage: true }`, captures token usage from the stream, estimates USD from a per-model table (gpt-4o, gpt-4o-mini, etc.), and sets `total_cost_usd` on the result message.

## [1.0.3] - 2026-02-11

### Fixed
- **Failover when primary returns error result**: When Anthropic yields a result with `is_error: true` (e.g. invalid API key) instead of throwing, the adapter now treats it as failure and runs OpenAI fallback when enabled, without yielding the primary error message first. The caller now only sees the fallback response.

## [1.0.2] - 2026-02-11

### Added
- **Short options for failover**: `-F` for `--failover`, `-K` for `--openai-api-key`
- **OpenAI base URL CLI option**: `-U, --openai-base-url <url>` to override OPENAI_BASE_URL (for custom/partner endpoints when failover is enabled)

## [1.0.1] - 2026-02-11

### Added
- **Test coverage for LLM failover**: New tests for `llm_query` adapter
  - Default system prompt when options have no systemPrompt and no valid agents
  - OPENAI_BASE_URL passed to OpenAI client when set in env
- **Test coverage for failover CLI**: New tests for agent-run CLI
  - FAILOVER_ENABLED set when `--failover` is provided (true/false)
  - OPENAI_API_KEY set when `--openai-api-key` is provided
  - Both options applied when both are provided

## [0.3.7] - 2026-02-10

### Added
- **Model Selection CLI Option**: New `-m/--model` CLI option to select Claude model
  - Supports `sonnet` (default), `opus`, and `haiku` models
  - Allows users to choose between speed, cost, and capability trade-offs
  - Validation ensures only valid model names are accepted
  - Model selection applies to all agent roles (code_reviewer, threat_modeler, diff_reviewer)

## [0.3.6] - 2026-01-21

### Fixed
- **Build Script**: Added execute permission (`chmod +x`) to CLI script in build process
  - Fixes "permission denied" errors when running `agent-run` after npm install

### Changed
- **SDK Version**: Bumped `@anthropic-ai/claude-agent-sdk` from `^0.1.58` to `^0.1.76`

## [0.3.5] - 2026-01-21

### Added
- **PR Diff Context Mode**: New `-d/--diff-context` CLI option for code_reviewer role
  - Enables focused security review of Pull Request changes only
  - Significantly reduces token usage by analyzing only changed code
  - Supports JSON file input with PR metadata, file changes, and diff hunks
  - Includes `DiffContext`, `DiffContextFile`, and `DiffHunk` TypeScript interfaces
  - New `formatDiffContextForPrompt()` function to format diff context for AI analysis
  - New `getDiffReviewerOptions()` method in AgentOptions for diff-focused reviews
  - New `diffReviewerWithOptions()` method in AgentActions for PR-focused code review
- **Input File Path Validation**: New `validateInputFilePath()` function
  - Validates input file paths for security concerns
  - Allows absolute paths while validating relative paths for directory traversal
  - Prevents null bytes and control characters in paths
- **Comprehensive Test Coverage**: 67 new tests (120 → 187 total)
  - 51 tests for `validateDiffContext` covering all field types and edge cases
  - 9 tests for `validateInputFilePath` covering path validation scenarios
  - 7 tests for diff context code review flow in main.ts

### Changed
- **Enhanced `validateDiffContext`**: Stricter validation for diff context JSON
  - Required string fields now reject empty strings
  - Line numbers (`startLine`, `endLine`) must be non-negative
  - Added validation that `startLine <= endLine`
  - Optional fields (`imports`, `beforeContext`, `afterContext`, `containingFunction`, `previousFilename`, `deploymentContext`) now validated for correct types
  - `fullFileAvailable` validated as boolean when present

### Fixed
- **Silent Ignore of `--diff-context`**: Now displays warning when `--diff-context` is used without `code_reviewer` role
  - Previously the option was silently ignored with other roles
  - Now warns users and suggests using `-r code_reviewer`
- **Diff Context Validation Error Handling**: Fixed error handling in `loadDiffContext()`
  - Validation errors no longer get caught by JSON parsing try-catch block
  - Proper error messages displayed for invalid diff context format

## [0.3.0] - 2025-12-22

### Added
- **Context Parameter for Code Reviews**: New `-c/--context` CLI option for code_reviewer role
  - Allows users to provide deployment and environment context for more targeted security analysis
  - Supports describing deployment type (AWS Lambda, Kubernetes, Docker, etc.)
  - Supports specifying compliance requirements (SOC2, HIPAA, PCI-DSS, GDPR)
  - Supports describing data sensitivity (PII, PHI, payment data)
  - Context is injected into the user prompt to help the agent focus on environment-specific vulnerabilities
  - Fully backward compatible - context is optional

### Changed
- **Enhanced Code Review Prompts**: Code reviewer now generates more comprehensive prompts
  - When context is provided, prompts include guidance to focus on environment-specific issues
  - Prompts encourage consideration of infrastructure mitigations and threat models

## [0.2.1] - 2025-12-18

### Added
- **Multiple Output Formats**: Support for additional output formats beyond markdown
  - Added `json`, `xml`, `csv`, and `xlsx` format options via `-f/--output_format` flag
  - New `getExtensionForFormat()` utility function to map formats to file extensions
  - New `FORMAT_TO_EXTENSION` mapping for extensible format support

### Changed
- **Dynamic Output File Naming**: Output files now default based on role and format
  - `code_reviewer` defaults to `code_review_report.<ext>` where `<ext>` matches the output format
  - `threat_modeler` defaults to `threat_model_report.<ext>` where `<ext>` matches the output format
  - Removed hardcoded `.md` extension default from `-o/--output_file` option
- **CLI Help Text**: Updated to show all available output formats (markdown, json, xml, csv, xlsx)

## [0.1.0] - 2025-12-10

### Added
- **simple_query_agent**: Added `--src_dir` command line argument support
  - Allows copying source code directories to a hidden folder for agent context
  - Agent can search and read files within the copied directory to answer questions
  - Automatically cleans up temporary directory when user exits
  - Works similarly to `code_reviewer` role's `--src_dir` functionality
  - Updated CLI help text to indicate `--src_dir` works with both `simple_query_agent` and `code_reviewer`

### Changed
- **Path Validation**: Enhanced `validateDirectoryPath()` to allow relative paths with directory traversal sequences
  - Relative paths like `../sast-ai-app/backend/` are now allowed and get resolved to absolute paths
  - Maintains security by resolving paths before validation
  - Updated `copyProjectSrcDir()` to handle relative paths properly
- **Documentation**: Updated README with `--src_dir` usage examples for `simple_query_agent`

## [0.0.8] - 2025-12-10

### Added
- Peer dependency `@anthropic-ai/claude-code@2.0.58` for compatibility with Claude Code integration
- Update claude-agent-sdk to latest stable version 0.1.58

## [0.0.6] - 2025-11-24

### Added
- **Thread-Safety for Web Applications**: Comprehensive improvements for safe concurrent usage
  - `getToolUsageLog()` method in `AgentOptions` to provide read-only access to tool usage logs
  - `clearToolUsageLog()` method in `AgentOptions` to clear logs between requests
  - Comprehensive concurrency test suite (11 new tests) covering:
    - Conversation history isolation across multiple instances
    - Tool usage log isolation
    - Concurrent file operations
    - Race condition prevention
    - Memory leak prevention
- **Documentation**: Added "Web Application Usage" section to README with best practices and code examples

### Changed
- **Thread-Safety**: Made `toolUsageLog` private in `AgentOptions` class
  - Changed from `public toolUsageLog` to `private toolUsageLog` to prevent external mutation
  - Added `getToolUsageLog()` method that returns a copy for safe read-only access
  - Added `clearToolUsageLog()` method for clearing logs between requests
- **Thread-Safety**: Enhanced `validateOutputFilePath()` function
  - Removed default parameter `baseDir: string = process.cwd()` to require explicit working directory
  - Prevents race conditions from concurrent `process.cwd()` calls in web applications
  - Updated all call sites to pass working directory explicitly
- **Thread-Safety**: Improved `main()` function
  - Captures `process.cwd()` once at the start of the function
  - Passes captured working directory to all file operations
  - Eliminates race conditions from concurrent directory changes
- **Testing**: Enhanced test suite with comprehensive concurrency tests
  - All console output suppressed in concurrency tests for cleaner test output
  - Tests verify isolation of conversation history and tool usage logs
  - Tests verify safe concurrent file operations
  - Tests verify race condition prevention

### Fixed
- **Thread-Safety**: Fixed potential race conditions in concurrent web application usage
  - Previously, multiple concurrent requests could interfere with each other's working directory
  - Now captures working directory once per request to prevent race conditions
- **Thread-Safety**: Fixed tool usage log accumulation in web applications
  - Previously, `toolUsageLog` was public and could accumulate unbounded data
  - Now private with controlled access and clear method for memory management

## [0.0.4] - 2025-11-13

### Added
- Command-line arguments `-k/--anthropic-api-key` and `-u/--anthropic-base-url` to pass Anthropic API credentials via the command line
- Tests for CLI environment variable handling
- **Security**: Comprehensive security validation utilities
  - `isSafePath()` function to detect dangerous path patterns (directory traversal, null bytes, control characters)
  - `validateAndSanitizePath()` function to normalize and validate file paths against base directories
  - `validateDirectoryPath()` function to validate source directory inputs
  - `validateOutputFilePath()` function to ensure output files are written only within intended directories
  - Path validation for all user-provided file and directory inputs
  - Command injection protection in `runCommand()` function with pattern detection and timeout limits
  - API key security warnings when credentials are passed via command-line arguments
- **Security Tests**: 26 new test cases covering all security validation functions
  - Path traversal attack prevention tests
  - Command injection detection tests
  - Input validation edge case tests
  - Directory and file path security tests

### Changed
- **simple_query_agent**: 
  - Added conversation history tracking to maintain context across multiple queries
  - Implemented continuous conversation loop with `/end` command to exit
  - Improved stream event handling to properly process all messages including tool results
  - Fixed cost display timing to only show after stream completely finishes (including tool execution)
  - Enhanced assistant message processing to handle content that arrives after tools complete
  - Added proper stdout flushing to ensure all streaming output is displayed before showing cost and next prompt
- **Security**: Enhanced `copyProjectSrcDir()` function with comprehensive path validation
  - Validates source directory paths to prevent directory traversal attacks
  - Ensures temporary directories are created only within the working directory
  - Sanitizes directory names to prevent path injection
  - Improved error handling with clear security-focused error messages
- **Security**: Enhanced `runCommand()` function with security hardening
  - Added validation to detect command injection patterns (`;`, `&`, `|`, backticks, etc.)
  - Added timeout protection (30 second default)
  - Added max buffer limit (1MB default) to prevent resource exhaustion
  - Improved error messages for security violations
- **Security**: Added input validation in `main()` function
  - Validates `src_dir` parameter before use in code_reviewer and threat_modeler roles
  - Validates `output_file` parameter to prevent writing outside intended directories
  - Ensures all file operations are restricted to safe paths
- **Security**: Improved temporary file cleanup
  - Added cleanup for temporary directories in code_reviewer role
  - Enhanced error handling for cleanup operations in threat_modeler role
  - Better resource management to prevent temporary file accumulation

### Security
- **Fixed**: Path traversal vulnerability in `copyProjectSrcDir()` function
  - Previously allowed directory traversal sequences that could access files outside intended directories
  - Now validates and sanitizes all paths before file operations
- **Fixed**: Command injection risk in `runCommand()` function
  - Previously executed commands without validation
  - Now validates commands for dangerous patterns before execution
- **Fixed**: Unvalidated file path inputs
  - Previously used user-provided paths without validation
  - Now validates all file and directory paths before use
- **Fixed**: Output file path security
  - Previously allowed writing files outside the working directory
  - Now restricts all output files to the current working directory
- **Improved**: API key security awareness
  - Added warnings when API keys are passed via command-line (visible in process lists)
  - Recommends using environment variables for better security

## [0.0.2] - 2024-11-10

### Added
- Initial publishing of the AppSec Agent TypeScript package
- Support for multiple agent types: simple query agent, code review agent, and threat modeler
- Tool permission management with advanced callbacks and bypass mode
- Code review capabilities for automated security and privacy issue detection
- Threat modeling with STRIDE methodology and Data Flow Diagrams (DFD)
- Command-line interface (`agent-run`) for running agents
- Configuration support via YAML files and environment variables
- Comprehensive test suite


## [0.0.1] - 2024-11-04

### Added
- Initial project setup
- Core agent architecture and infrastructure
- Basic agent interaction capabilities

[Unreleased]: https://github.com/yourusername/appsec-agent/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/yourusername/appsec-agent/compare/v0.3.0...v0.3.5
[0.3.0]: https://github.com/yourusername/appsec-agent/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/yourusername/appsec-agent/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/yourusername/appsec-agent/compare/v0.0.8...v0.1.0
[0.0.8]: https://github.com/yourusername/appsec-agent/compare/v0.0.6...v0.0.8
[0.0.6]: https://github.com/yourusername/appsec-agent/compare/v0.0.4...v0.0.6
[0.0.4]: https://github.com/yourusername/appsec-agent/compare/v0.0.2...v0.0.4
[0.0.2]: https://github.com/yourusername/appsec-agent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yourusername/appsec-agent/compare/v0.0.0...v0.0.1

