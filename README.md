# AppSec Agent (TypeScript)

A TypeScript package that provides AI-powered agents for Application Security (AppSec) tasks, built on top of the Claude Agent SDK. This is a TypeScript reimplementation of the Python AppSec AI Agent toolkit that helps automate mundane security operations and streamline AppSec workflows.

## 🚀 Features

- **AI-Powered AppSec Automation**: Leverage Claude's capabilities for security operations
- **Multiple Agent Types**: Simple query agent, code review agent, and threat modeler for different use cases
- **Tool Permission Management**: Advanced tool permission callbacks with bypass mode for trusted operations
- **Code Review Capabilities**: Automated security and privacy issue detection in code
- **Modular Agent Architecture**: Easy to extend and customize agents for specific use cases
- **Simple Integration**: Built on the Claude Agent SDK for seamless AI integration
- **Production Ready**: Stable package with proper error handling and configuration

## 📋 Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Available Agents](#available-agents)
- [Architecture](#architecture)
- [Usage Examples](#usage-examples)
- [Development](#development)

## 🛠 Installation

### Prerequisites

- Node.js 18.0 or higher
- npm or yarn
- Anthropic API key

### Step 1: Install Claude Code
Our agent toolkit is built on top of Claude Agent SDK. And the Claude Agent SDK is built on top of Claude Code. So in order to install our toolkit, you would need to start with Claude Code. You may want to install it in the global user space:

```bash
$ npm install -g @anthropic-ai/claude-code
```

### Step 2: Install Dependencies
```bash
$ cd appsec-agent
$ npm install
```

### Step 3: Build the Project
```bash
$ npm run build
```

This will compile the TypeScript source files to JavaScript in the `dist/` directory.

## ⚡ Quick Start

### 1. Set Up Environment Variables

Add these to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
# Anthropic API Configuration
export ANTHROPIC_API_KEY="your-anthropic-api-key"
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

### 2. Run Your First Agent

**Important**: Make sure to build the project first:
```bash
$ npm run build
```

Then you can run the agent:
```bash
# Run the basic agent using npm script
$ npm start

# Or use the CLI directly (after building)
$ node bin/agent-run

# Or use ts-node for development (no build needed)
$ npx ts-node bin/agent-run.ts
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
$ node bin/agent-run
```

### Code Review Example
```bash
# Review code in current directory
$ node bin/agent-run -r code_reviewer

# Review specific source directory
$ node bin/agent-run -r code_reviewer -s /path/to/source

# Custom output file and format
$ node bin/agent-run -r code_reviewer -o security_report.html -f html
```

### Threat Modeler Example
```bash
# Run threat modeler on current directory
$ node bin/agent-run -r threat_modeler

# Run threat modeler on specific source directory
$ node bin/agent-run -r threat_modeler -s /path/to/source
```

### List Available Roles
```bash
$ node bin/agent-run -l
```

### Version Information
```bash
$ node bin/agent-run -v
```

## 🏗 Architecture

The AppSec AI Agent is built with a modular architecture consisting of several key components:

### Core Components

- **`AgentActions`**: Handles async interactions with Claude agents, including simple queries, code reviews, and threat modeling
- **`AgentOptions`**: Manages configuration, tool permissions, and permission modes for different agent types
- **`utils`**: Utility functions for file operations, YAML loading, and project management
- **`agent-run`**: Command-line interface script for running agents

### File Structure

```
appsec-agent/
├── src/
│   ├── agent_actions.ts       # Agent interaction logic
│   ├── agent_options.ts       # Agent configuration management
│   ├── main.ts               # Main application logic
│   └── utils.ts              # Utility functions
├── bin/
│   └── agent-run             # Main CLI script
├── conf/
│   └── appsec_agent.yaml   # General configuration file
├── package.json
├── tsconfig.json
└── README.md
```

## 🛠 Development

### Setting Up Development Environment

1. Clone the repository and navigate to the TypeScript directory:
```bash
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

### Building the Package

```bash
# Build the package
$ npm run build

# Clean build artifacts
$ npm run clean
```

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

