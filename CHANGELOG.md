# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Command-line arguments `-k/--anthropic-api-key` and `-u/--anthropic-base-url` to pass Anthropic API credentials via the command line
- Tests for CLI environment variable handling

### Changed
- **simple_query_agent**: Retrofitted to match Python implementation with continuous conversation loop
  - Added conversation history tracking to maintain context across multiple queries
  - Implemented continuous conversation loop with `/end` command to exit
  - Improved stream event handling to properly process all messages including tool results
  - Fixed cost display timing to only show after stream completely finishes (including tool execution)
  - Enhanced assistant message processing to handle content that arrives after tools complete
  - Added proper stdout flushing to ensure all streaming output is displayed before showing cost and next prompt

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

