# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

