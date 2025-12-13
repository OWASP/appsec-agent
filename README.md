# AppSec Agent (TypeScript)

A TypeScript package that provides AI-powered agents for Application Security (AppSec) tasks, built on top of the Claude Agent SDK. It helps automate mundane application security operations and streamline workflows.

**📦 Available on npm**: Install with `npm install appsec-agent`

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

## 🛠 Installation

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn
- Anthropic API key

### Step 1: Install Claude Code
Our agent toolkit is built on top of Claude Agent SDK (v0.1.58), which in turn is built on top of Claude Code. To install our toolkit, you need to start with Claude Code. You may want to install it in the global user space:

```bash
$ npm install -g @anthropic-ai/claude-code@2.0.58
```

### Step 2: Install appsec-agent
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
- Support multiple output formats (Markdown, etc.)
- Analyze entire project directories
- Use advanced tools: Read, Grep, and Write capabilities

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
│   └── __tests__/
│       ├── concurrency.test.ts  # Concurrency and thread-safety tests
│       └── ...                # Other test files
├── bin/
│   ├── agent-run.js          # Main CLI script (compiled)
│   └── agent-run.ts          # Main CLI script (source)
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
$ node bin/agent-run.js
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
- ✅ 115 total tests
- ✅ 11 concurrency tests
- ✅ Full coverage of core functionality

## 📚 References

- [Claude Agent SDK Documentation](https://docs.claude.com/en/api/agent-sdk)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [Claude Code Documentation](https://docs.anthropic.com/claude-code)

## 📄 License

This project is licensed under the MIT License.

## 👥 Author

**Sam Li** - *Initial work* - [yang.li@owasp.org](mailto:yang.li@owasp.org)

---

*Built with ❤️ for the AppSec community*

