# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.8] - 2025-01-XX

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

[Unreleased]: https://github.com/yourusername/appsec-agent/compare/v0.0.2...HEAD
[0.0.2]: https://github.com/yourusername/appsec-agent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yourusername/appsec-agent/compare/v0.0.0...v0.0.1

