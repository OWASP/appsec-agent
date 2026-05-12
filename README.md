# AppSec Agent (TypeScript)

A TypeScript package that provides AI-powered agents for Application Security (AppSec) tasks, built on top of the Claude Agent SDK. It helps automate mundane application security operations and streamline workflows.

**📦 Available on npm**: Install with `npm install appsec-agent`

**🌐 Looking for a full web dashboard?** Check out [**AI Threat Modeler**](https://github.com/yangsec888/ai-threat-modeler/) — the parent application that bundles `appsec-agent` into a Dockerized Next.js + Express stack with authentication, an interactive threat-aware Data Flow Diagram canvas, risk registry exports (PDF/CSV/JSON), and a chat UI. It's the easiest way to use this agent without writing code.

## 🚀 Features

- **AI-Powered AppSec Automation**: Leverage Claude's capabilities for application security
- **Multiple Agent Types**: Simple query agent, code review agent, and threat modeler for different use cases
- **Tool Permission Management**: Advanced tool permission callbacks with bypass mode for trusted operations
- **Code Review Capabilities**: Automated security and privacy issue detection in code
- **Modular Agent Architecture**: Easy to extend and customize agents for specific use cases
- **Simple Integration**: Built on the Claude Agent SDK for seamless AI integration
- **Production Ready**: Stable package with proper error handling and configuration
- **Thread-Safe for Web Applications**: Designed for concurrent usage in web applications with isolated instance state
- **Comprehensive Testing**: Full test coverage including concurrency tests for web application scenarios

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Available Agents](#available-agents)
- [Web Application Usage](#web-application-usage)
- [Architecture](#architecture)
- [Usage Examples](#usage-examples)
- [Development](#development)
- [Testing](#testing)
- [Related Projects](#related-projects)

## 🛠 Installation

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn
- Anthropic API key

### Step 1: Install appsec-agent

> Note on Claude Code: `@anthropic-ai/claude-agent-sdk` bundles its own
> native `claude` binary for every supported `(platform, arch, libc)`, so
> the standalone `@anthropic-ai/claude-code` CLI is **not required** to
> run this package. Install it globally only if you want the `claude` CLI
> on your `PATH` for manual use.

Install the package from npm:

```bash
$ npm install appsec-agent
```

Or if you prefer global installation (to use the CLI command directly):

```bash
$ npm install -g appsec-agent
```

The package includes pre-built JavaScript files, so no build step is required for usage.

## ⚡ Quick Start

### 1. Set Up Environment Variables

Add these to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
# Anthropic API Configuration
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

### 2. Run Your First Agent

You can run the agent using the CLI command:

```bash
# If installed globally
$ agent-run

# If installed locally, use npx
$ npx agent-run

# Or run with specific options
$ npx agent-run -r simple_query_agent
```

## 🔧 Configuration

The agents can be configured through environment variables and configuration files. Key configuration options include:

- `ANTHROPIC_API_KEY`: Your Anthropic API key (required)
- `ANTHROPIC_BASE_URL`: API endpoint URL (default: https://api.anthropic.com)
- `MAX_TURNS`: Maximum conversation turns (default: 1)

Configuration file: `conf/appsec_agent.yaml`

### Optional: LLM failover (Anthropic → OpenAI)

**Failover is off by default.** The agent uses Anthropic only unless you enable failover. When enabled, if the Anthropic call fails (e.g. API outage or rate limit), the agent will retry using the OpenAI API so the parent app gets a single response path.

To enable failover, set:

- `FAILOVER_ENABLED`: set to `true` to enable (default is disabled).
- `OPENAI_API_KEY`: your OpenAI API key (required when failover is enabled).
- `OPENAI_BASE_URL`: (optional) custom OpenAI endpoint.
- `OPENAI_FALLBACK_MODEL`: (optional) model to use for fallback (e.g. `gpt-4o`); default is `gpt-4o`.

**CLI overrides env overrides config.** You can use:

- `--failover`: enable failover for this run.
- `--openai-api-key <key>`: OpenAI API key for this run (overrides `OPENAI_API_KEY`).

When failover runs, all agents (simple query, code reviewer, threat modeler, diff reviewer) use the same prompt and system message; tooled agents do not run tools on the fallback path. The response shape is unchanged so the parent app is unaffected.

## 🤖 Available Agents

### Simple Query Agent (`simple_query_agent`)
A general-purpose AppSec assistant that can:
- Answer security-related questions
- Help with security analysis tasks
- Provide guidance on security best practices
- Interactive query processing
- Search and analyze file directories (with `--src_dir` option)

### Code Review Agent (`code_reviewer`)
A specialized agent for automated code analysis that can:
- Review code for security vulnerabilities
- Detect privacy issues in codebases
- Generate comprehensive security reports
- Support multiple output formats (Markdown, JSON, XML, CSV, XLSX)
- Analyze entire project directories
- Use advanced tools: Read, Grep, and Write capabilities
- Accept deployment context via `-c/--context` for environment-specific analysis
- **PR-focused review mode** via `-d/--diff-context` for optimized token usage

### Code Fixer Agent (`code_fixer`)
A specialized agent for generating precise security fixes that can:
- Receive a security finding with full code context via `--fix-context`
- Generate minimal, targeted fixes that resolve the vulnerability
- Return structured JSON output (`FixOutput`) with fixed code, line numbers, explanation, and confidence
- Preserve original indentation and code functionality
- Support retry workflows when a previous fix fails validation
- Use `Read` and `Grep` tools for additional source context when `--src_dir` is provided

### QA Verifier Agent (`qa_verifier`)
A specialized agent for verifying security fixes that can:
- Run the project's test suite to verify a security fix doesn't break functionality
- Analyze test failures to determine if they are caused by the fix or are pre-existing
- Provide a structured JSON verdict (`QaVerdict`) with pass/fail status, failure details, and suggestions
- Execute shell commands via a restricted Bash tool with security constraints
- Support custom test commands, setup commands, and environment variables
- Accept deployment context for environment-aware verification

### Threat Modeler (`threat_modeler`)
A specialized agent for comprehensive threat modeling that can:
- Generate ASCII text-based Data Flow Diagrams (DFD)
- Perform STRIDE methodology threat modeling on DFDs
- Create detailed risk registry reports with remediation plans
- Analyze codebases for security threats and vulnerabilities
- Generate multiple deliverable reports

## 📖 Usage Examples

### Basic Query
```bash
# Interactive query agent
$ npx agent-run

# Query agent with source code directory context
$ npx agent-run -r simple_query_agent -s /path/to/source
```

### Code Review Example
```bash
# Review code in current directory
$ npx agent-run -r code_reviewer

# Review specific source directory
$ npx agent-run -r code_reviewer -s /path/to/source

# Custom output file and format
$ npx agent-run -r code_reviewer -o security_report.html -f html

# Review with deployment context for more targeted analysis
$ npx agent-run -r code_reviewer -s ./src \
  -c "AWS Lambda function in production VPC, handles user authentication via API Gateway, processes PII data"

# Kubernetes microservice with compliance context
$ npx agent-run -r code_reviewer -s ./payment-service \
  -c "Kubernetes microservice on GKE, PCI-DSS compliant environment, internal service mesh only"

# Internal tool with access context
$ npx agent-run -r code_reviewer -s ./admin-cli \
  -c "Internal CLI tool run by DevOps, requires VPN access, elevated AWS IAM permissions"
```

The `-c/--context` option provides deployment and environment information that helps the agent:
- Focus on environment-specific vulnerabilities (e.g., Lambda event injection, K8s secrets exposure)
- Consider infrastructure mitigations already in place
- Prioritize findings based on actual threat landscape
- Recommend best practices appropriate for the stated architecture

### PR-Focused Code Review (Diff Context Mode)

For Pull Request reviews, use the `-d/--diff-context` option to provide a JSON file containing only the changed code. This significantly reduces token usage by focusing the review on actual changes rather than the entire codebase.

```bash
# Review a PR using diff context
$ npx agent-run -r code_reviewer -d pr-diff.json

# Combine with source directory for full file access when needed
$ npx agent-run -r code_reviewer -d pr-diff.json -s ./src

# With additional deployment context
$ npx agent-run -r code_reviewer -d pr-diff.json -c "Production API, handles PII"
```

The diff context JSON file should follow this structure:

```json
{
  "prNumber": 123,
  "baseBranch": "main",
  "headBranch": "feature/auth",
  "headSha": "abc123def456",
  "owner": "your-org",
  "repo": "your-repo",
  "files": [
    {
      "filePath": "src/auth/login.ts",
      "language": "typescript",
      "fileType": "modified",
      "imports": "import bcrypt from 'bcrypt';",
      "hunks": [
        {
          "startLine": 42,
          "endLine": 55,
          "beforeContext": "// Previous context",
          "changedCode": "+const password = req.body.password;",
          "afterContext": "// Following context",
          "containingFunction": "async function login(req, res)"
        }
      ]
    }
  ],
  "totalFilesChanged": 1,
  "totalLinesAdded": 10,
  "totalLinesRemoved": 5
}
```

**Note:** If `--diff-context` is provided without the `code_reviewer` role, a warning will be displayed as the option is only applicable to code reviews.

#### PR chunking (large PRs)

When a PR diff exceeds the model's context limit, **chunking** splits the diff into batches, reviews each batch, then merges the reports into a single output file.

- **Config** (in `conf/appsec_agent.yaml`): PR diff chunking options live under **`pr_reviewer.options`** and are **on by default** when you use the `pr_reviewer` role with `-d/--diff-context`. The `code_reviewer` role does not have chunking enabled by default.
  - `diff_review_max_tokens_per_batch`: e.g. `150000` (0 or omit = no chunking)
  - `diff_review_max_batches`: e.g. `3` (cap on number of batches per run)
  - `diff_review_max_files`: optional cap on files reviewed; rest are skipped
  - `diff_review_exclude_paths`: optional list of path patterns to exclude (e.g. `["src/analytics/*"]`)
- **CLI** (override config): `--diff-max-tokens <n>`, `--diff-max-batches <n>`, `--diff-max-files <n>`, `--diff-exclude <pattern>` (repeatable)

When chunking is used, the merged report may include a **Skipped** section listing files that were excluded or that exceeded the batch limit. Total API cost is logged per batch and as a total, and (for JSON reports) included in `meta.total_cost_usd`.

```bash
# pr_reviewer has chunking on by default when using -d
$ npx agent-run -r pr_reviewer -d pr-diff.json

# Or enable chunking via CLI when using code_reviewer (overrides config)
$ npx agent-run -r code_reviewer -d pr-diff.json --diff-max-tokens 150000 --diff-max-batches 3
```

#### Adversarial second pass (`pr_adversary`)

After a `pr_reviewer` run, the parent app can invoke a **second pass** that drops findings without a concrete failure/exploit path. Input is a JSON file listing candidate findings; output is a **filtered** `security_review_report` (same schema as the main PR report).

```bash
# Filter candidate findings (JSON in → JSON out). Optional: same PR diff for context.
$ npx agent-run -r pr_adversary --adversarial-context candidates.json -s ./repo -f json \
  -o adversarial_code_review_report.json

# Optional: include diff context (large diffs are truncated for the prompt)
$ npx agent-run -r pr_adversary --adversarial-context candidates.json --diff-context pr-diff.json -s ./repo -f json
```

- **`--experiment-enabled`:** adds stricter false-positive instructions for this pass; for `pr_reviewer`, also tightens the initial diff review when your integrator passes this flag.

**Input file shape** (minimum per finding: `id`, `title`, `file`, `description`):

```json
{
  "findings": [
    {
      "id": "SEC-001",
      "title": "…",
      "file": "src/a.ts",
      "description": "…",
      "severity": "HIGH",
      "confidence": "HIGH",
      "recommendation": "…"
    }
  ],
  "pr_number": 123,
  "head_sha": "abc123"
}
```

### Code Fixer Example
```bash
# Fix a vulnerability described in a fix context JSON file
$ npx agent-run -r code_fixer --fix-context fix_context.json

# With source directory for additional context
$ npx agent-run -r code_fixer --fix-context fix_context.json -s ./src

# Custom output file
$ npx agent-run -r code_fixer --fix-context fix_context.json -o my_fix.json
```

The fix context JSON file should follow this structure:

```json
{
  "finding": {
    "title": "SQL Injection",
    "severity": "HIGH",
    "cwe": "CWE-89",
    "owasp": "A03:2021",
    "file": "src/db.ts",
    "line": 42,
    "description": "User input directly concatenated into SQL query",
    "recommendation": "Use parameterized queries",
    "category": "Injection"
  },
  "code_context": {
    "language": "typescript",
    "imports": "import { db } from './database';",
    "vulnerable_section": "const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);",
    "vulnerable_section_start": 40,
    "vulnerable_section_end": 44,
    "full_file_with_line_numbers": "  40| const result = db.query(...);",
    "indentation_guidance": "Use 2-space indentation"
  },
  "security_guidance": "Use parameterized queries to prevent SQL injection.",
  "learned_examples": "",
  "negative_examples": "",
  "custom_instructions": "",
  "chain_of_thought": false
}
```

The agent returns a structured `FixOutput`:

```json
{
  "fixed_code": "const result = db.query('SELECT * FROM users WHERE id = ?', [userId]);",
  "start_line": 42,
  "end_line": 42,
  "explanation": "Replaced string interpolation with parameterized query to prevent SQL injection",
  "confidence": "high",
  "breaking_changes": false
}
```

### QA Verifier Example
```bash
# Verify a security fix by running the project's tests
$ npx agent-run -r qa_verifier --qa-context qa_context.json

# With source directory for additional context
$ npx agent-run -r qa_verifier --qa-context qa_context.json -s ./src

# Custom output file
$ npx agent-run -r qa_verifier --qa-context qa_context.json -o qa_verdict.json
```

The QA context JSON file should follow this structure:

```json
{
  "pr_url": "https://github.com/owner/repo/pull/42",
  "test_command": "npm test",
  "test_framework": "jest",
  "setup_commands": "npm ci",
  "timeout_seconds": 120,
  "block_on_failure": true,
  "deployment_context": "Production Kubernetes cluster",
  "environment_variables": {
    "NODE_ENV": "test"
  }
}
```

The agent returns a structured `QaVerdict`:

```json
{
  "pass": true,
  "test_exit_code": 0,
  "failures": [],
  "logs": "All 235 tests passed",
  "analysis": "All tests pass after the security fix.",
  "suggestions": []
}
```

### Threat Modeler Example
```bash
# Run threat modeler on current directory
$ npx agent-run -r threat_modeler

# Run threat modeler on specific source directory
$ npx agent-run -r threat_modeler -s /path/to/source
```

### List Available Roles
```bash
$ npx agent-run -l
```

### Version Information
```bash
$ npx agent-run -v
```

**Note**: If you installed the package globally, you can use `agent-run` directly instead of `npx agent-run`.

## 🌐 Web Application Usage

This package is designed to be thread-safe for use in web applications where multiple requests may be processed concurrently.

### Key Thread-Safety Features

- **Instance Isolation**: Each `AgentActions` and `AgentOptions` instance maintains isolated state
- **Conversation History Isolation**: Conversation history is stored per instance, preventing cross-contamination between requests
- **Tool Usage Log Management**: Tool usage logs are private and can be cleared between requests
- **Working Directory Safety**: Working directory is captured once per request to prevent race conditions

### Best Practices for Web Applications

1. **Create New Instances Per Request**: Always create a new `AgentActions` instance for each HTTP request:

```typescript
import { AgentActions, AgentArgs, loadYaml } from 'appsec-agent';

app.post('/api/query', async (req, res) => {
  const confDict = loadYaml('conf/appsec_agent.yaml');
  const args: AgentArgs = {
    role: 'simple_query_agent',
    environment: 'default',
    verbose: false
  };
  
  // Create new instance per request
  const agentActions = new AgentActions(confDict, 'default', args);
  
  // Use agentActions for this request only
  const result = await agentActions.simpleQueryClaudeWithOptions(req.body.query);
  
  res.json({ result });
});
```

2. **Clear Tool Usage Logs**: If reusing `AgentOptions` instances, clear logs between requests:

```typescript
const agentOptions = new AgentOptions(confDict, environment);
// ... use agentOptions ...
agentOptions.clearToolUsageLog(); // Clear before next request
```

3. **Pass Working Directory Explicitly**: When using file operations, pass the working directory explicitly:

```typescript
import { validateOutputFilePath } from 'appsec-agent';

// In web application context
const workingDir = process.cwd(); // Capture once per request
const outputPath = validateOutputFilePath('report.md', workingDir);
```

### Thread-Safety Guarantees

- ✅ Safe: Creating new instances per request
- ✅ Safe: Using captured working directory
- ❌ Unsafe: Reusing the same instance across multiple requests
- ❌ Unsafe: Calling `process.cwd()` multiple times in concurrent contexts

## 🏗 Architecture

The AppSec AI Agent is built with a modular architecture consisting of several key components:

### Core Components

- **`AgentActions`**: Handles async interactions with Claude agents, including simple queries, code reviews, and threat modeling. Maintains isolated conversation history per instance.
- **`AgentOptions`**: Manages configuration, tool permissions, and permission modes for different agent types. Provides private tool usage logging with getter and clear methods.
- **`utils`**: Utility functions for file operations, YAML loading, and project management with thread-safe path validation
- **`agent-run`**: Command-line interface script for running agents

### File Structure

```
appsec-agent/
├── src/
│   ├── agent_actions.ts       # Agent interaction logic
│   ├── agent_options.ts       # Agent configuration management
│   ├── main.ts               # Main application logic
│   ├── utils.ts              # Utility functions
│   ├── schemas/
│   │   ├── security_report.ts # JSON schema for code review reports
│   │   ├── threat_model_report.ts # JSON schema for threat model reports
│   │   └── security_fix.ts    # JSON schema for code fixer output
│   │   └── qa_context.ts      # JSON schema for QA verifier verdict
│   ├── tools/
│   │   └── bash_tool.ts       # Restricted Bash tool for QA verifier
│   └── __tests__/
│       ├── concurrency.test.ts  # Concurrency and thread-safety tests
│       └── ...                # Other test files
├── bin/
│   └── agent-run.ts          # CLI script (TypeScript source)
├── dist/                      # Compiled output (generated)
│   ├── src/                   # Compiled library code
│   └── bin/
│       └── agent-run.js       # Compiled CLI entry point
├── conf/
│   └── appsec_agent.yaml   # General configuration file
├── package.json
├── tsconfig.json
└── README.md
```

### API Reference

#### AgentOptions Methods

- `getToolUsageLog()`: Returns a copy of the tool usage log (read-only access)
- `clearToolUsageLog()`: Clears the tool usage log (useful for web applications)
- `toolPermissionCallback()`: Handles tool permission requests
- `getSimpleQueryAgentOptions()`: Gets options for simple query agent
- `getCodeReviewerOptions()`: Gets options for code reviewer
- `getThreatModelerOptions()`: Gets options for threat modeler
- `getDiffReviewerOptions()`: Gets options for PR diff-focused code reviewer
- `getCodeFixerOptions()`: Gets options for code fixer agent (always uses JSON schema output)
- `getQaVerifierOptions()`: Gets options for QA verifier agent (Read, Grep, Bash tools + JSON schema output)

#### Diff Context Functions

- `validateDiffContext(data)`: Validates diff context JSON structure with comprehensive field validation
- `formatDiffContextForPrompt(context)`: Formats diff context into a prompt for AI analysis

#### Path Validation Functions

- `validateInputFilePath(filePath, baseDir)`: Validates input file paths for security concerns
- `validateOutputFilePath(filePath, baseDir)`: Validates output file paths to prevent directory traversal
- `isSafePath(filePath, allowAbsolute)`: Checks if a path is safe from traversal attacks

## 🛠 Development

This section is for developers who want to contribute to the package or modify it locally.

### Setting Up Development Environment

1. Clone the repository:
```bash
$ git clone <repository-url>
$ cd appsec-agent
```

2. Install dependencies:
```bash
$ npm install
```

3. Build the project:
```bash
$ npm run build
```

This will compile the TypeScript source files to JavaScript in the `dist/` directory.

### Building the Package

```bash
# Build the package
$ npm run build

# Clean build artifacts
$ npm run clean
```

### Running from Source

During development, you can run the agent directly from source:

```bash
# Using ts-node (no build needed)
$ npx ts-node bin/agent-run.ts

# Or build first, then run
$ npm run build
$ node dist/bin/agent-run.js
```

## 🧪 Testing

The project includes comprehensive test coverage including concurrency tests for web application scenarios.

### Running Tests

```bash
# Run all tests
$ npm test

# Run tests in watch mode
$ npm run test:watch

# Run tests with coverage
$ npm run test:coverage

# Run specific test file
$ npm test -- concurrency.test.ts
```

### Test Coverage

- **Unit Tests**: Core functionality for all components
- **Integration Tests**: End-to-end agent workflows
- **Concurrency Tests**: Thread-safety verification for web application usage
  - Conversation history isolation
  - Tool usage log isolation
  - Concurrent file operations
  - Race condition prevention
  - Memory leak prevention

### Test Results

All tests pass including:
- ✅ 235 total tests across 11 suites
- ✅ 11 concurrency tests
- ✅ 51 diff context validation tests
- ✅ 9 code fixer tests (main + agent options)
- ✅ 5 QA verifier tests
- ✅ Full coverage of core functionality

## 🔗 Related Projects

### [AI Threat Modeler](https://github.com/yangsec888/ai-threat-modeler/) — Parent Application

`appsec-agent` powers [**AI Threat Modeler**](https://github.com/yangsec888/ai-threat-modeler/), a full open-source web application for AppSec automation. If you'd like to use these agents through a polished UI rather than the CLI or library API, the parent app is the recommended way to get started.

Highlights:

- 🐳 **One-command setup** with `docker-compose up -d --build`
- 🖥️ **Next.js web dashboard** with authentication (JWT, bcrypt, role-based access) and admin-managed Anthropic API credentials
- 🧵 **Threat Modeling workflow** — upload a repository ZIP and get a structured JSON threat model (powered by `appsec-agent` v1.6+) with:
  - Interactive threat-aware **Data Flow Diagrams** (React Flow canvas with pan/zoom, search, filters, trust boundaries)
  - Sortable threat tables with STRIDE category and severity badges
  - Risk Registry with cross-referenced threat IDs
  - Export to **PDF** (DFD with embedded vector SVG, and Threat Model), **CSV** (Risk Registry), or **raw JSON**
- 💬 **Chat interface** with persistent conversation history, backed by `appsec-agent` interactive mode
- 📚 **OpenAPI 3.0 / Swagger** docs at `/api-docs`
- 🧪 Comprehensive backend, frontend, and Playwright E2E test coverage

Quick start:

```bash
git clone https://github.com/yangsec888/ai-threat-modeler.git
cd ai-threat-modeler
docker-compose up -d --build
# Then open http://localhost:3000  (default login: admin / admin)
```

See the [AI Threat Modeler README](https://github.com/yangsec888/ai-threat-modeler/blob/main/README.md) and [SETUP.md](https://github.com/yangsec888/ai-threat-modeler/blob/main/SETUP.md) for full details.

## 📚 References

- [AI Threat Modeler (parent app)](https://github.com/yangsec888/ai-threat-modeler/)
- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Claude Code Documentation](https://docs.anthropic.com/claude-code)

## 📄 License

This project is licensed under the [Apache License 2.0](LICENSE) — see the `LICENSE` file for details.

## 👥 Author

**Sam Li** - *Initial work* - [yang.li@owasp.org](mailto:yang.li@owasp.org)

---

*Built with ❤️ for the AppSec community*

