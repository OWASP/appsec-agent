# Code Fix Agent Implementation Plan

> **Status**: 📋 Future Enhancement - Separate Project  
> **Author**: Sam Li  
> **Created**: December 2025  
> **Prerequisite**: AUTO_REMEDIATION_PLAN.md (Hybrid approach implemented first)

## Executive Summary

This document outlines the implementation plan for a sophisticated **Code Fix Agent** that uses the existing `appsec-agent` pattern to generate, validate, and iterate on security vulnerability fixes. This is an upgrade path from the Hybrid approach (direct Claude API with basic validation) to a full agent-based solution.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Agent Design](#2-agent-design)
3. [Tool Definitions](#3-tool-definitions)
4. [Agent Configuration](#4-agent-configuration)
5. [Integration Points](#5-integration-points)
6. [Implementation Phases](#6-implementation-phases)
7. [Testing Strategy](#7-testing-strategy)
8. [Migration from Hybrid](#8-migration-from-hybrid)

---

## 1. Architecture Overview

### Current Pattern: appsec-agent

The existing `appsec-agent` follows this pattern:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     EXISTING APPSEC-AGENT PATTERN                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐      │
│  │ agent-run   │     │ AgentActions     │     │ Claude API          │      │
│  │ CLI         │────▶│ (role-based)     │────▶│ (with tools)        │      │
│  └─────────────┘     └──────────────────┘     └─────────────────────┘      │
│        │                     │                         │                    │
│        │                     │                         │                    │
│        ▼                     ▼                         ▼                    │
│  Configuration          Tool Execution            Response Parsing         │
│  (YAML roles)           (file ops, etc)           (structured output)      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Proposed: Code Fix Agent

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     CODE FIX AGENT ARCHITECTURE                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Input: Finding + Source Code + Context                                     │
│         │                                                                   │
│         ▼                                                                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      CODE FIX AGENT LOOP                            │   │
│  │                                                                     │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ 1. ANALYZE                                                   │   │   │
│  │  │    • Parse finding details (CWE, severity, location)        │   │   │
│  │  │    • Read source file and surrounding context               │   │   │
│  │  │    • Identify related files (imports, dependencies)         │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                           │                                         │   │
│  │                           ▼                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ 2. GENERATE FIX                                              │   │   │
│  │  │    • Reason about vulnerability root cause                   │   │   │
│  │  │    • Generate minimal, targeted fix                          │   │   │
│  │  │    • Preserve existing functionality                         │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                           │                                         │   │
│  │                           ▼                                         │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │ 3. VALIDATE                                                  │   │   │
│  │  │    • Run syntax checker (language-specific)                  │   │   │
│  │  │    • Run linter (ESLint, Pylint, etc.)                      │   │   │
│  │  │    • Optionally run tests                                    │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  │                           │                                         │   │
│  │              ┌────────────┴────────────┐                           │   │
│  │              │                         │                           │   │
│  │              ▼                         ▼                           │   │
│  │         [PASS]                    [FAIL]                           │   │
│  │              │                         │                           │   │
│  │              │              ┌──────────┴──────────┐                │   │
│  │              │              │ Retry with feedback │                │   │
│  │              │              │ (max 3 attempts)    │                │   │
│  │              │              └──────────┬──────────┘                │   │
│  │              │                         │                           │   │
│  │              ▼                         ▼                           │   │
│  │         SUCCESS                   LOOP BACK                        │   │
│  │                                   (or FAIL after max retries)      │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Output: Validated Fix + Confidence Score + Explanation                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Agent Design

### 2.1 Agent Role Definition

```yaml
# conf/appsec_agent.yaml - New role addition

roles:
  code_fixer:
    description: "Security vulnerability fix generation agent"
    system_prompt: |
      You are a security engineer specialized in fixing code vulnerabilities.
      
      Your task is to analyze security findings and generate minimal, correct fixes
      that address the vulnerability without breaking existing functionality.
      
      ## Guidelines
      1. Understand the root cause of the vulnerability
      2. Generate the smallest possible fix
      3. Preserve existing code style and conventions
      4. Do NOT add unnecessary refactoring
      5. Validate your fixes before submitting
      6. Explain your reasoning clearly
      
      ## Available Tools
      - read_file: Read source files for context
      - write_file: Write the fixed code (temporary)
      - run_syntax_check: Validate code syntax
      - run_linter: Run language-specific linter
      - run_tests: Execute relevant tests (optional)
      - search_codebase: Find related files/patterns
      - get_imports: Analyze file dependencies
      
    max_iterations: 5
    tools:
      - read_file
      - write_file
      - run_syntax_check
      - run_linter
      - run_tests
      - search_codebase
      - get_imports
      - submit_fix
    output_format: json
```

### 2.2 Agent State Machine

```typescript
enum AgentState {
  ANALYZING = 'analyzing',
  GENERATING = 'generating',
  VALIDATING = 'validating',
  RETRYING = 'retrying',
  SUCCESS = 'success',
  FAILED = 'failed',
}

interface AgentContext {
  finding: Finding;
  projectPath: string;
  sourceFile: string;
  sourceCode: string;
  relatedFiles: string[];
  
  // State tracking
  currentState: AgentState;
  iteration: number;
  maxIterations: number;
  
  // Fix attempts
  fixAttempts: FixAttempt[];
  currentFix: GeneratedFix | null;
  
  // Validation results
  validationErrors: string[];
  linterErrors: string[];
  testResults: TestResult | null;
}

interface FixAttempt {
  iteration: number;
  fixedCode: string;
  validationPassed: boolean;
  errors: string[];
  feedback: string;
}
```

### 2.3 Agent Loop Implementation

```typescript
// appsec-agent/src/agents/codeFixerAgent.ts

import { AgentActions, Tool, ToolResult } from '../core';

export class CodeFixerAgent {
  private context: AgentContext;
  private tools: Map<string, Tool>;
  private anthropic: AnthropicClient;
  
  constructor(config: AgentConfig) {
    this.tools = this.initializeTools(config);
    this.anthropic = new AnthropicClient(config.apiKey);
  }
  
  async fixFinding(finding: Finding, projectPath: string): Promise<FixResult> {
    // Initialize context
    this.context = {
      finding,
      projectPath,
      sourceFile: finding.file,
      currentState: AgentState.ANALYZING,
      iteration: 0,
      maxIterations: 5,
      fixAttempts: [],
      currentFix: null,
      validationErrors: [],
      linterErrors: [],
      testResults: null,
    };
    
    // Read source file
    this.context.sourceCode = await this.tools.get('read_file')!.execute({
      path: path.join(projectPath, finding.file)
    });
    
    // Agent loop
    while (this.context.iteration < this.context.maxIterations) {
      this.context.iteration++;
      
      try {
        // Generate or refine fix
        const response = await this.callAgent();
        
        // Process tool calls
        for (const toolCall of response.toolCalls) {
          const result = await this.executeToolCall(toolCall);
          
          if (toolCall.name === 'submit_fix') {
            // Validate the submitted fix
            const validationResult = await this.validateFix(result.fixedCode);
            
            if (validationResult.passed) {
              this.context.currentState = AgentState.SUCCESS;
              return this.buildSuccessResult();
            } else {
              // Add to attempts and continue loop
              this.context.fixAttempts.push({
                iteration: this.context.iteration,
                fixedCode: result.fixedCode,
                validationPassed: false,
                errors: validationResult.errors,
                feedback: this.buildFeedback(validationResult),
              });
              this.context.currentState = AgentState.RETRYING;
            }
          }
        }
      } catch (error) {
        console.error(`Iteration ${this.context.iteration} failed:`, error);
      }
    }
    
    // Max iterations reached
    this.context.currentState = AgentState.FAILED;
    return this.buildFailureResult();
  }
  
  private async callAgent(): Promise<AgentResponse> {
    const messages = this.buildMessages();
    
    return await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      system: this.getSystemPrompt(),
      messages,
      tools: this.getToolDefinitions(),
    });
  }
  
  private buildMessages(): Message[] {
    const messages: Message[] = [];
    
    // Initial analysis request
    messages.push({
      role: 'user',
      content: this.buildInitialPrompt(),
    });
    
    // Add previous attempts as conversation history
    for (const attempt of this.context.fixAttempts) {
      messages.push({
        role: 'assistant',
        content: `I generated this fix:\n\`\`\`\n${attempt.fixedCode}\n\`\`\``,
      });
      messages.push({
        role: 'user',
        content: `Validation failed:\n${attempt.feedback}\n\nPlease fix these issues and try again.`,
      });
    }
    
    return messages;
  }
  
  private buildInitialPrompt(): string {
    return `
## Security Finding to Fix

**Severity**: ${this.context.finding.severity}
**Type**: ${this.context.finding.title}
**CWE**: ${this.context.finding.cwe || 'N/A'}
**File**: ${this.context.finding.file}
**Line**: ${this.context.finding.line}

### Description
${this.context.finding.description}

### Current Code
\`\`\`
${this.context.sourceCode}
\`\`\`

### Instructions
1. Analyze the vulnerability
2. Generate a minimal fix
3. Use the available tools to validate your fix
4. Submit the fix when validation passes

Please start by analyzing the code and then generate a fix.
`;
  }
}
```

---

## 3. Tool Definitions

### 3.1 Tool Interface

```typescript
interface Tool {
  name: string;
  description: string;
  inputSchema: JSONSchema;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
}

interface ToolResult {
  success: boolean;
  output: string;
  data?: Record<string, unknown>;
}
```

### 3.2 Required Tools

#### read_file
```typescript
const readFileTool: Tool = {
  name: 'read_file',
  description: 'Read the contents of a file in the project',
  inputSchema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Relative path to the file' },
      start_line: { type: 'number', description: 'Optional start line' },
      end_line: { type: 'number', description: 'Optional end line' },
    },
    required: ['path'],
  },
  async execute({ path, start_line, end_line }) {
    const fullPath = resolvePath(this.context.projectPath, path);
    let content = await fs.readFile(fullPath, 'utf-8');
    
    if (start_line !== undefined && end_line !== undefined) {
      const lines = content.split('\n');
      content = lines.slice(start_line - 1, end_line).join('\n');
    }
    
    return { success: true, output: content };
  },
};
```

#### run_syntax_check
```typescript
const runSyntaxCheckTool: Tool = {
  name: 'run_syntax_check',
  description: 'Validate code syntax for a given language',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The code to validate' },
      language: { type: 'string', description: 'Programming language' },
    },
    required: ['code', 'language'],
  },
  async execute({ code, language }) {
    const validator = getSyntaxValidator(language);
    const result = await validator.validate(code);
    
    return {
      success: result.valid,
      output: result.valid ? 'Syntax is valid' : `Syntax errors:\n${result.errors.join('\n')}`,
      data: { valid: result.valid, errors: result.errors },
    };
  },
};
```

#### run_linter
```typescript
const runLinterTool: Tool = {
  name: 'run_linter',
  description: 'Run language-specific linter on code',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'The code to lint' },
      language: { type: 'string', description: 'Programming language' },
      file_path: { type: 'string', description: 'Original file path for context' },
    },
    required: ['code', 'language'],
  },
  async execute({ code, language, file_path }) {
    // Write to temp file
    const tempFile = await writeTempFile(code, getExtension(language));
    
    try {
      let result: LintResult;
      
      switch (language) {
        case 'typescript':
        case 'javascript':
          result = await runESLint(tempFile);
          break;
        case 'python':
          result = await runPylint(tempFile);
          break;
        default:
          return { success: true, output: 'No linter available for this language' };
      }
      
      return {
        success: result.errorCount === 0,
        output: result.errorCount === 0 
          ? 'No linting errors' 
          : `Linting errors:\n${formatLintErrors(result.errors)}`,
        data: result,
      };
    } finally {
      await fs.unlink(tempFile);
    }
  },
};
```

#### run_tests
```typescript
const runTestsTool: Tool = {
  name: 'run_tests',
  description: 'Run tests related to the modified file',
  inputSchema: {
    type: 'object',
    properties: {
      file_path: { type: 'string', description: 'Path to the modified file' },
      test_pattern: { type: 'string', description: 'Optional test file pattern' },
    },
    required: ['file_path'],
  },
  async execute({ file_path, test_pattern }) {
    // Find related test files
    const testFiles = await findRelatedTests(file_path, test_pattern);
    
    if (testFiles.length === 0) {
      return { success: true, output: 'No related tests found' };
    }
    
    // Run tests with timeout
    const result = await runTestsWithTimeout(testFiles, 30000);
    
    return {
      success: result.passed,
      output: result.passed
        ? `All ${result.total} tests passed`
        : `Tests failed: ${result.failed}/${result.total}\n${result.output}`,
      data: result,
    };
  },
};
```

#### submit_fix
```typescript
const submitFixTool: Tool = {
  name: 'submit_fix',
  description: 'Submit the generated fix for final validation',
  inputSchema: {
    type: 'object',
    properties: {
      fixed_code: { type: 'string', description: 'The complete fixed code' },
      start_line: { type: 'number', description: 'Start line of the fix' },
      end_line: { type: 'number', description: 'End line of the fix' },
      explanation: { type: 'string', description: 'Explanation of the fix' },
      confidence: { 
        type: 'string', 
        enum: ['high', 'medium', 'low'],
        description: 'Confidence level in the fix' 
      },
    },
    required: ['fixed_code', 'explanation', 'confidence'],
  },
  async execute(params) {
    // This tool signals the agent to validate and potentially complete
    return {
      success: true,
      output: 'Fix submitted for validation',
      data: params,
    };
  },
};
```

#### search_codebase
```typescript
const searchCodebaseTool: Tool = {
  name: 'search_codebase',
  description: 'Search for patterns or symbols in the codebase',
  inputSchema: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Search pattern (regex supported)' },
      file_pattern: { type: 'string', description: 'Glob pattern to filter files' },
      max_results: { type: 'number', description: 'Maximum results to return' },
    },
    required: ['pattern'],
  },
  async execute({ pattern, file_pattern, max_results = 10 }) {
    const results = await ripgrep(pattern, this.context.projectPath, {
      glob: file_pattern,
      maxCount: max_results,
    });
    
    return {
      success: true,
      output: formatSearchResults(results),
      data: { matches: results },
    };
  },
};
```

---

## 4. Agent Configuration

### 4.1 YAML Configuration

```yaml
# conf/code_fixer_config.yaml

agent:
  name: code_fixer
  version: "1.0.0"
  
model:
  name: claude-sonnet-4-20250514
  max_tokens: 4096
  temperature: 0.2  # Lower temperature for more deterministic fixes
  
behavior:
  max_iterations: 5
  timeout_seconds: 120
  enable_caching: true
  
validation:
  syntax_check: true
  linter: true
  tests: false  # Disabled by default, enable for thorough validation
  
tools:
  enabled:
    - read_file
    - write_file
    - run_syntax_check
    - run_linter
    - search_codebase
    - get_imports
    - submit_fix
  optional:
    - run_tests
    
language_support:
  typescript:
    syntax_checker: typescript-compiler
    linter: eslint
    test_runner: jest
  javascript:
    syntax_checker: acorn
    linter: eslint
    test_runner: jest
  python:
    syntax_checker: ast
    linter: pylint
    test_runner: pytest
  java:
    syntax_checker: javac
    linter: checkstyle
    test_runner: junit
  go:
    syntax_checker: go-build
    linter: golint
    test_runner: go-test

output:
  format: json
  include_diff: true
  include_explanation: true
```

### 4.2 CLI Interface

```bash
# New CLI command for code fix agent
node bin/agent-run \
  -r code_fixer \
  -k $ANTHROPIC_API_KEY \
  -u $ANTHROPIC_BASE_URL \
  --finding-file finding.json \
  --project-path /path/to/project \
  --output-format json \
  --max-iterations 5 \
  --enable-tests false

# Example finding.json
{
  "id": "finding-001",
  "severity": "critical",
  "title": "SQL Injection",
  "cwe": "CWE-89",
  "file": "src/db/users.ts",
  "line": 45,
  "description": "User input directly concatenated into SQL query",
  "code_snippet": "const query = `SELECT * FROM users WHERE id = ${userId}`;"
}
```

---

## 5. Integration Points

### 5.1 Integration with RemediationService

```typescript
// backend/src/services/remediationService.ts

class RemediationService {
  private useAgentMode: boolean;
  
  constructor(config: RemediationConfig) {
    // Check if agent mode is enabled in settings
    this.useAgentMode = config.useAgentMode ?? false;
  }
  
  async generateFix(finding: Finding, sourceCode: string): Promise<GeneratedFix> {
    if (this.useAgentMode) {
      return this.generateFixWithAgent(finding, sourceCode);
    } else {
      return this.generateFixWithDirectAPI(finding, sourceCode);
    }
  }
  
  private async generateFixWithAgent(
    finding: Finding, 
    sourceCode: string
  ): Promise<GeneratedFix> {
    // Spawn agent-run process
    const agentRunPath = findAgentRunPath();
    const findingFile = await this.writeFindingToTempFile(finding);
    
    return new Promise((resolve, reject) => {
      const child = spawn('node', [
        agentRunPath,
        '-r', 'code_fixer',
        '-k', this.config.apiKey,
        '-u', this.config.baseUrl,
        '--finding-file', findingFile,
        '--project-path', this.workDir,
        '--output-format', 'json',
        '--max-iterations', '5',
      ]);
      
      let output = '';
      child.stdout.on('data', (data) => { output += data; });
      
      child.on('close', (code) => {
        if (code === 0) {
          const result = JSON.parse(output);
          resolve({
            finding,
            originalCode: sourceCode,
            fixedCode: result.fixed_code,
            explanation: result.explanation,
            confidence: result.confidence,
            validated: result.validation_passed,
            iterations: result.iterations,
          });
        } else {
          reject(new Error(`Agent exited with code ${code}`));
        }
      });
    });
  }
  
  private async generateFixWithDirectAPI(
    finding: Finding,
    sourceCode: string
  ): Promise<GeneratedFix> {
    // Existing hybrid approach implementation
    // ...
  }
}
```

### 5.2 Settings Extension

```typescript
// Add to settings model
interface RemediationSettings {
  // Existing settings...
  auto_remediation_enabled: number;
  remediation_ai_model: string;
  remediation_max_files_per_pr: number;
  remediation_pr_draft_mode: number;
  
  // New agent mode settings
  remediation_use_agent_mode: number;        // 0 = hybrid, 1 = agent
  remediation_agent_max_iterations: number;  // default: 5
  remediation_agent_enable_tests: number;    // 0 = no, 1 = yes
  remediation_agent_timeout_seconds: number; // default: 120
}
```

---

## 6. Implementation Phases

### Phase 1: Core Agent Framework (8 hours)
- [ ] Create `CodeFixerAgent` class
- [ ] Implement agent state machine
- [ ] Implement agent loop with iteration tracking
- [ ] Add conversation history management
- [ ] Write unit tests for agent core

### Phase 2: Tool Implementation (6 hours)
- [ ] Implement `read_file` tool
- [ ] Implement `write_file` tool (temp files)
- [ ] Implement `run_syntax_check` tool
  - TypeScript/JavaScript (TypeScript compiler)
  - Python (ast module)
- [ ] Implement `run_linter` tool
  - ESLint integration
  - Pylint integration
- [ ] Implement `search_codebase` tool
- [ ] Implement `submit_fix` tool
- [ ] Write unit tests for each tool

### Phase 3: Validation Pipeline (4 hours)
- [ ] Build validation orchestrator
- [ ] Implement syntax validation for each language
- [ ] Implement linter integration
- [ ] Add test runner integration (optional)
- [ ] Build error feedback formatter

### Phase 4: CLI Integration (3 hours)
- [ ] Add `code_fixer` role to agent-run CLI
- [ ] Implement finding file input
- [ ] Implement JSON output format
- [ ] Add timeout and iteration controls
- [ ] Write CLI tests

### Phase 5: Service Integration (3 hours)
- [ ] Add agent mode toggle to RemediationService
- [ ] Implement agent spawning logic
- [ ] Add output parsing and result building
- [ ] Update settings model
- [ ] Write integration tests

### Phase 6: Configuration & Docs (2 hours)
- [ ] Create YAML configuration file
- [ ] Add language support configuration
- [ ] Write agent usage documentation
- [ ] Create example finding files

### Estimated Total: ~26 hours

---

## 7. Testing Strategy

### 7.1 Unit Tests

```typescript
describe('CodeFixerAgent', () => {
  describe('fixFinding', () => {
    it('should fix a simple SQL injection', async () => {
      const finding: Finding = {
        id: 'test-001',
        severity: 'critical',
        title: 'SQL Injection',
        cwe: 'CWE-89',
        file: 'src/db/users.ts',
        line: 10,
        description: 'User input concatenated in SQL query',
      };
      
      const sourceCode = `
        function getUser(userId: string) {
          const query = \`SELECT * FROM users WHERE id = \${userId}\`;
          return db.execute(query);
        }
      `;
      
      const result = await agent.fixFinding(finding, '/tmp/test-project');
      
      expect(result.success).toBe(true);
      expect(result.fixedCode).toContain('$1'); // Parameterized query
      expect(result.validated).toBe(true);
    });
    
    it('should retry on validation failure', async () => {
      // Mock first attempt to fail syntax check
      // Verify agent retries and succeeds
    });
    
    it('should fail after max iterations', async () => {
      // Mock all attempts to fail
      // Verify agent returns failure after max iterations
    });
  });
});
```

### 7.2 Integration Tests

```typescript
describe('CodeFixerAgent Integration', () => {
  it('should fix XSS vulnerability in React component', async () => {
    // Test with real file system and linter
  });
  
  it('should handle multi-file dependencies', async () => {
    // Test with imports and related files
  });
  
  it('should work with Python code', async () => {
    // Test Python syntax validation and Pylint
  });
});
```

### 7.3 E2E Tests

```bash
# E2E test script
#!/bin/bash

# Test SQL injection fix
node bin/agent-run \
  -r code_fixer \
  --finding-file test/fixtures/sql-injection.json \
  --project-path test/fixtures/vulnerable-app \
  --output-format json \
  | jq '.success' \
  | grep -q 'true' || exit 1

echo "✅ SQL injection fix test passed"
```

---

## 8. Migration from Hybrid

### 8.1 Feature Flag Approach

```typescript
// Gradual rollout with feature flag
async function generateFix(finding: Finding): Promise<GeneratedFix> {
  const settings = SettingsModel.get();
  
  // Check feature flag
  if (settings.remediation_use_agent_mode) {
    try {
      return await this.generateFixWithAgent(finding);
    } catch (error) {
      console.warn('Agent mode failed, falling back to hybrid:', error);
      // Fallback to hybrid on agent failure
      return await this.generateFixWithDirectAPI(finding);
    }
  }
  
  return await this.generateFixWithDirectAPI(finding);
}
```

### 8.2 Comparison Mode

```typescript
// During testing, run both and compare
async function generateFixWithComparison(finding: Finding): Promise<GeneratedFix> {
  const [hybridResult, agentResult] = await Promise.allSettled([
    this.generateFixWithDirectAPI(finding),
    this.generateFixWithAgent(finding),
  ]);
  
  // Log comparison for analysis
  logger.info('Fix comparison', {
    finding: finding.id,
    hybrid: hybridResult.status === 'fulfilled' ? hybridResult.value : null,
    agent: agentResult.status === 'fulfilled' ? agentResult.value : null,
  });
  
  // Use hybrid result by default during comparison phase
  if (hybridResult.status === 'fulfilled') {
    return hybridResult.value;
  }
  
  if (agentResult.status === 'fulfilled') {
    return agentResult.value;
  }
  
  throw new Error('Both fix methods failed');
}
```

### 8.3 Migration Checklist

- [ ] Implement agent mode behind feature flag
- [ ] Run comparison mode in staging
- [ ] Analyze fix quality metrics (success rate, validation rate)
- [ ] Gradually increase agent mode percentage
- [ ] Monitor latency and cost
- [ ] Full rollout when metrics are satisfactory

---

## Appendix A: Language Support Matrix

| Language | Syntax Check | Linter | Test Runner | Status |
|----------|--------------|--------|-------------|--------|
| TypeScript | ✅ tsc | ✅ ESLint | ✅ Jest | Planned |
| JavaScript | ✅ acorn | ✅ ESLint | ✅ Jest | Planned |
| Python | ✅ ast | ✅ Pylint | ✅ pytest | Planned |
| Java | ⏳ javac | ⏳ Checkstyle | ⏳ JUnit | Future |
| Go | ⏳ go build | ⏳ golint | ⏳ go test | Future |
| Rust | ⏳ rustc | ⏳ clippy | ⏳ cargo test | Future |

---

## Appendix B: Example Agent Trace

```
┌─────────────────────────────────────────────────────────────────┐
│ CODE FIX AGENT TRACE - SQL Injection Fix                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ [Iteration 1]                                                   │
│ State: ANALYZING                                                │
│ Tool Call: read_file("src/db/users.ts")                        │
│ → Read 45 lines of code                                        │
│                                                                 │
│ Tool Call: search_codebase("parameterized|prepared")           │
│ → Found 3 examples of parameterized queries in codebase        │
│                                                                 │
│ State: GENERATING                                               │
│ Reasoning: The vulnerability is in line 10 where userId is     │
│            concatenated. Following codebase patterns, I'll use │
│            parameterized query with $1 placeholder.            │
│                                                                 │
│ State: VALIDATING                                               │
│ Tool Call: submit_fix(fixed_code="...", confidence="high")     │
│ Tool Call: run_syntax_check(code="...", language="typescript") │
│ → Syntax valid ✓                                               │
│ Tool Call: run_linter(code="...", language="typescript")       │
│ → 0 errors, 0 warnings ✓                                       │
│                                                                 │
│ State: SUCCESS                                                  │
│ Result: Fix validated and submitted                            │
│ Iterations: 1                                                   │
│ Confidence: high                                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Cost Comparison

| Approach | Avg Tokens/Fix | Avg Cost/Fix | Avg Latency |
|----------|---------------|--------------|-------------|
| Direct API | ~2,000 | $0.02 | 2 seconds |
| Hybrid | ~3,000 | $0.03 | 4 seconds |
| Agent (1 iter) | ~5,000 | $0.05 | 8 seconds |
| Agent (3 iter) | ~12,000 | $0.12 | 20 seconds |
| Agent (5 iter) | ~20,000 | $0.20 | 35 seconds |

*Costs based on Claude Sonnet pricing. Actual costs may vary.*

---

## Appendix D: Future Enhancements

### AI Model Per Severity Strategy

When using the full agent approach, consider using different AI models based on finding severity to optimize cost vs. quality:

```yaml
# conf/code_fixer_config.yaml

model_strategy:
  # Use most capable model for critical findings (highest accuracy needed)
  critical:
    model: claude-sonnet-4-20250514
    max_iterations: 5
    temperature: 0.1
    
  # Use capable model for high severity
  high:
    model: claude-sonnet-4-20250514
    max_iterations: 4
    temperature: 0.2
    
  # Use faster/cheaper model for medium severity
  medium:
    model: claude-sonnet-4-20250514
    max_iterations: 3
    temperature: 0.2
    
  # Use most cost-effective model for low severity
  low:
    model: claude-haiku  # When available
    max_iterations: 2
    temperature: 0.3
```

**Implementation:**

```typescript
interface ModelConfig {
  model: string;
  maxIterations: number;
  temperature: number;
}

function getModelConfigForSeverity(severity: SeverityLevel): ModelConfig {
  const configs: Record<SeverityLevel, ModelConfig> = {
    critical: {
      model: 'claude-sonnet-4-20250514',
      maxIterations: 5,
      temperature: 0.1,
    },
    high: {
      model: 'claude-sonnet-4-20250514',
      maxIterations: 4,
      temperature: 0.2,
    },
    medium: {
      model: 'claude-sonnet-4-20250514',
      maxIterations: 3,
      temperature: 0.2,
    },
    low: {
      model: 'claude-haiku', // or claude-sonnet-4-20250514
      maxIterations: 2,
      temperature: 0.3,
    },
  };
  
  return configs[severity];
}

// Usage in agent
async fixFinding(finding: Finding): Promise<FixResult> {
  const modelConfig = getModelConfigForSeverity(finding.severity);
  
  this.context.maxIterations = modelConfig.maxIterations;
  
  const response = await this.anthropic.messages.create({
    model: modelConfig.model,
    temperature: modelConfig.temperature,
    // ...
  });
}
```

**Benefits:**
- **Cost optimization**: Lower-cost models for low-severity findings
- **Quality assurance**: Best models for critical vulnerabilities
- **Latency management**: Faster models where speed matters more than perfection

**Cost Impact (Estimated):**

| Severity Mix | Single Model Cost | Multi-Model Cost | Savings |
|--------------|-------------------|------------------|---------|
| 10% critical, 20% high, 40% medium, 30% low | $1.00 | $0.70 | ~30% |

> **Note**: This enhancement is planned for after the basic agent implementation is complete and validated.
