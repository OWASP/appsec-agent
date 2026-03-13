/**
 * Context Extraction Schemas
 *
 * Defines the input context and output for the context_extractor role.
 * ExtractionContext is assembled by sast-ai-app and passed via --extract-context JSON file.
 * The structured output contains project intelligence fields used to reduce false positives.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Input: context provided by sast-ai-app via --extract-context JSON file
// ---------------------------------------------------------------------------

export interface ExtractionContextFile {
  path: string;
  content: string;
}

export interface ExtractionContext {
  owner: string;
  repo: string;
  description: string | null;
  language: string | null;
  languages: Record<string, number>;
  files: ExtractionContextFile[];
}

// ---------------------------------------------------------------------------
// Output: structured extraction returned by the agent
// ---------------------------------------------------------------------------

export interface ExtractionResult {
  project_summary: string;
  security_context: string;
  deployment_context: string;
  developer_context: string;
}

// ---------------------------------------------------------------------------
// Context loader
// ---------------------------------------------------------------------------

export function loadExtractionContext(filePath: string, cwd: string): ExtractionContext {
  const resolved = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Extraction context file not found: ${resolved}`);
  }
  const content = fs.readFileSync(resolved, 'utf-8');
  const ctx = JSON.parse(content) as ExtractionContext;

  if (!ctx.owner || typeof ctx.owner !== 'string') {
    throw new Error('Extraction context must include a valid owner');
  }
  if (!ctx.repo || typeof ctx.repo !== 'string') {
    throw new Error('Extraction context must include a valid repo');
  }
  if (!Array.isArray(ctx.files)) {
    throw new Error('Extraction context must include a files array');
  }

  return ctx;
}

// ---------------------------------------------------------------------------
// JSON Schema for Claude SDK outputFormat (structured output)
// ---------------------------------------------------------------------------

export const CONTEXT_EXTRACTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: ['project_summary', 'security_context', 'deployment_context', 'developer_context'],
  properties: {
    project_summary: {
      type: 'string',
      description: '1-2 sentence description of what the project does, its tech stack, and architecture. Max 500 chars.',
    },
    security_context: {
      type: 'string',
      description: 'Security defenses detected: auth frameworks, encryption, input validation, CSRF/XSS protection, rate limiting, ORM usage, CSP headers, secrets management. Be specific about library names. Max 500 chars.',
    },
    deployment_context: {
      type: 'string',
      description: 'How the project is deployed: CI/CD system, container runtime, cloud provider, environments, infrastructure. Max 500 chars.',
    },
    developer_context: {
      type: 'string',
      description: 'Security-relevant developer guidance ONLY: rules about PHI/PII handling, SQL injection prevention, auth patterns, input validation requirements, compliance (HIPAA/SOX/GDPR). Exclude generic coding style, formatting, naming conventions. Max 2000 chars.',
    },
  },
  additionalProperties: false,
};
