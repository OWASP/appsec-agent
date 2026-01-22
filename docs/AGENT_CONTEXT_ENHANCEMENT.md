# User Context for Code Review Agent

**Author:** Auto-generated  
**Date:** December 22, 2025  
**Target Project:** appsec-agent (~/apps/appsec-agent)  
**Status:** Implemented ✅

---

## Overview

This document proposes adding a `--context` CLI parameter to the `agent-run` tool in the appsec-agent project. This enhancement enables users to provide deployment and environment context that significantly improves the relevance and accuracy of security code reviews.

## Problem Statement

Currently, the code review agent performs security analysis without knowledge of:
- **Deployment environment** (AWS Lambda, Kubernetes, Docker, on-premise)
- **Infrastructure context** (VPC configuration, network isolation, cloud provider)
- **Data sensitivity** (PII handling, payment processing, healthcare data)
- **Access patterns** (internal tool, public API, B2B integration)
- **Compliance requirements** (SOC2, HIPAA, PCI-DSS, GDPR)

This lack of context can lead to:
- Generic findings that don't account for environment-specific mitigations
- Missed vulnerabilities specific to certain deployment patterns
- False positives when infrastructure controls provide protection
- Irrelevant recommendations for the actual deployment scenario

## Example Use Case

**Project:** `hermes` - An AWS Lambda function  

Without context, the agent might:
- Flag missing rate limiting (but Lambda has built-in concurrency limits)
- Miss Lambda-specific issues like cold start secrets exposure
- Not consider AWS IAM role permissions in the analysis

With context: `"AWS Lambda function deployed in production VPC, handles user authentication, processes PII data, uses API Gateway with WAF"`

The agent can now:
- Focus on Lambda-specific vulnerabilities (event injection, serialization)
- Consider AWS IAM best practices
- Evaluate secrets management appropriate for Lambda (Secrets Manager vs env vars)
- Assess PII handling compliance

---

## Implementation Details

### 1. CLI Parameter Addition

**File:** `bin/agent-run.ts`

Add a new CLI option for context:

```typescript
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
  // NEW: Add context parameter
  .option('-c, --context <context>', 'Additional context for the code review (e.g., deployment environment, architecture, compliance requirements)')
  .option('-l, --list_roles', 'List all available roles')
  .option('-v, --version', 'Program version')
  .option('-V, --verbose', 'Verbose mode');
```

Update args object to include context:

```typescript
const args = {
  role: options.role,
  environment: options.environment,
  src_dir: options.src_dir,
  output_file: options.output_file,
  output_format: options.output_format,
  verbose: options.verbose,
  context: options.context  // NEW
};
```

### 2. Update AgentArgs Interface

**File:** `src/agent_actions.ts`

```typescript
export interface AgentArgs {
  role: string;
  environment: string;
  src_dir?: string;
  output_file?: string;
  output_format?: string;
  verbose?: boolean;
  context?: string;  // NEW: User-provided context for code review
}
```

### 3. Enhance User Prompt Generation

**File:** `src/main.ts`

Modify the `code_reviewer` section to incorporate context:

```typescript
} else if (args.role === 'code_reviewer') {
  console.log('Running Code Review Agent');
  
  const extension = getExtensionForFormat(args.output_format);
  const outputFile = validateOutputFile(args.output_file || `code_review_report.${extension}`, currentWorkingDir);
  const tmpSrcDir = args.src_dir ? validateAndCopySrcDir(args.src_dir, currentWorkingDir) : null;
  const srcLocation = tmpSrcDir ? `current working directory ${tmpSrcDir}` : 'current working directory';
  
  // NEW: Build context section if provided
  let contextSection = '';
  if (args.context) {
    contextSection = `

IMPORTANT DEPLOYMENT & ENVIRONMENT CONTEXT:
${args.context}

Please consider this context when analyzing the code. Focus on:
- Security issues specific to this deployment environment
- Vulnerabilities that may be mitigated or exacerbated by this context
- Best practices relevant to the stated architecture and compliance requirements
- Environment-specific attack vectors and threat models

`;
  }
  
  const userPrompt = `Review the code in the ${srcLocation}.${contextSection}
Provide a comprehensive security review report identifying potential security issues found in the code. Please write the review report in the ${outputFile} file under current working directory in ${args.output_format} format.`;
  
  await agentActions.codeReviewerWithOptions(userPrompt);
  cleanupTmpDir(tmpSrcDir);
```

### 4. Optional: Enhance System Prompt in YAML Config

**File:** `conf/appsec_agent.yaml`

Consider updating the system prompt to mention context awareness:

```yaml
code_reviewer:
  options:
    system_prompt: |
      You are an Application Security (AppSec) expert assistant. You are responsible for performing a thorough code review.
      
      When deployment or environment context is provided, tailor your analysis to:
      - Identify vulnerabilities specific to that deployment pattern
      - Consider environment-specific mitigations and controls
      - Prioritize findings based on the actual threat landscape
      - Recommend best practices appropriate for the stated architecture
      
      List out all the potential security issues found in the code. Provide affected code snippet and security advice and guidance in the code review report.
    output_format: "markdown"
    verbose: True
```

---

## Usage Examples

### Basic Usage with Context

```bash
# AWS Lambda context
node bin/agent-run.js -r code_reviewer -s ./hermes \
  -c "AWS Lambda function in production VPC, handles user authentication via API Gateway, processes PII data, uses Secrets Manager for credentials"

# Kubernetes microservice context
node bin/agent-run.js -r code_reviewer -s ./payment-service \
  -c "Kubernetes microservice on GKE, PCI-DSS compliant environment, receives traffic from internal service mesh only, uses Vault for secrets"

# Internal CLI tool context
node bin/agent-run.js -r code_reviewer -s ./admin-cli \
  -c "Internal CLI tool run by DevOps team, requires VPN access, has elevated AWS IAM permissions, accesses production databases"
```

### Integration with sast-ai-app

The sast-ai-app will call agent-run with context derived from project settings:

```typescript
// In sast-ai-app/backend/src/routes/codeReview.ts
const childProcess = spawn('node', [
  agentRunPath,
  '-r', 'code_reviewer',
  '-s', `./${repoName}`,
  '-k', anthropicConfig.apiKey,
  '-u', anthropicConfig.baseUrl,
  '-f', 'json',
  '-V',
  ...(projectContext ? ['-c', projectContext] : [])
], {
  cwd: workDir,
  env,
  stdio: ['ignore', 'pipe', 'pipe']
});
```

---

## Context Guidelines

### Recommended Context Elements

| Category | Examples |
|----------|----------|
| **Deployment Type** | AWS Lambda, Kubernetes, Docker, EC2, On-premise, Serverless |
| **Cloud Provider** | AWS, GCP, Azure, Multi-cloud |
| **Network Context** | VPC, Public internet, Internal only, Service mesh |
| **Data Sensitivity** | PII, PHI, Payment data, Public data |
| **Compliance** | SOC2, HIPAA, PCI-DSS, GDPR, FedRAMP |
| **Access Patterns** | Public API, Internal tool, B2B integration |
| **Auth Mechanisms** | OAuth, API keys, IAM roles, mTLS |

### Example Context Strings

```text
# Web Application
"Next.js application deployed on Vercel, public-facing, handles user registration with email/password auth, stores data in PostgreSQL on AWS RDS"

# Data Pipeline
"Apache Airflow DAG running on EKS, processes customer analytics data, reads from S3, writes to Snowflake, runs on schedule every 6 hours"

# Mobile Backend
"Node.js API backend for iOS/Android apps, deployed on AWS ECS Fargate, uses Cognito for auth, processes in-app purchases, PCI-DSS scope"
```

---

## Testing Plan

### Unit Tests

Add tests in `src/__tests__/agent-run.test.ts`:

```typescript
describe('Context parameter', () => {
  it('should accept context via -c flag', () => {
    const args = parseArgs(['-r', 'code_reviewer', '-c', 'AWS Lambda function']);
    expect(args.context).toBe('AWS Lambda function');
  });

  it('should accept context via --context flag', () => {
    const args = parseArgs(['--context', 'Kubernetes on GKE']);
    expect(args.context).toBe('Kubernetes on GKE');
  });

  it('should work without context (optional parameter)', () => {
    const args = parseArgs(['-r', 'code_reviewer']);
    expect(args.context).toBeUndefined();
  });
});
```

### Integration Tests

Verify that context appears in the generated report by checking for context-specific findings.

---

## Backward Compatibility

This enhancement is **fully backward compatible**:
- The `--context` parameter is optional
- Existing CLI invocations continue to work unchanged
- Reports generated without context maintain the same format

---

## Future Enhancements

1. **Context from file**: Support `--context-file` to load context from a JSON/YAML file
2. **Structured context**: Define a schema for context (JSON) for programmatic use
3. **Context templates**: Pre-defined context templates for common architectures
4. **Context validation**: Warn about potentially conflicting context elements

---

## Implementation Checklist

- [x] Add `-c, --context` option to `bin/agent-run.ts`
- [x] Update `AgentArgs` interface in `src/agent_actions.ts`
- [x] Modify user prompt generation in `src/main.ts`
- [x] Update `conf/appsec_agent.yaml` system prompt (optional)
- [x] Add unit tests for context parameter
- [x] Update README.md with context usage examples
- [x] Test with various context strings
- [x] Update CHANGELOG.md

---

## Related Changes in sast-ai-app

The following changes have been implemented in sast-ai-app:

1. ✅ Add `deployment_context` column to projects table
2. ✅ Create API endpoint to update project context
3. ✅ Add UI for entering/editing project context
4. ✅ Pass context to agent-run when spawning code review jobs (see `backend/src/routes/codeReview.ts`)

