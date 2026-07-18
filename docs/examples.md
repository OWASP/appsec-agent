# Examples

Copy-paste CLI recipes and JSON input formats.

[← Back to README](../README.md) · [Agents guide](agents.md) · [Configuration](configuration.md)

---

## Basics

```bash
# Interactive Q&A
npx agent-run

# With source folder
npx agent-run -r simple_query_agent -s /path/to/source

# List roles / version
npx agent-run -l
npx agent-run -v
```

---

## Code review

```bash
# Review current project
npx agent-run -r code_reviewer

# Specific directory + JSON report
npx agent-run -r code_reviewer -s /path/to/source -f json -o security_report.json

# Deployment context (helps prioritize findings)
npx agent-run -r code_reviewer -s ./src \
  -c "AWS Lambda in production VPC, handles PII via API Gateway"

npx agent-run -r code_reviewer -s ./payment-service \
  -c "Kubernetes on GKE, PCI-DSS scope, internal mesh only"
```

**What `-c` does:** Tells the agent about your environment so it can focus on relevant threats (e.g. Lambda injection vs K8s secrets) and respect controls already in place.

---

## PR-focused review

Use `-r pr_reviewer` with `--diff-context`.

```bash
npx agent-run -r pr_reviewer --diff-context pr-diff.json

npx agent-run -r pr_reviewer --diff-context pr-diff.json -s ./src

npx agent-run -r pr_reviewer --diff-context pr-diff.json \
  -c "Production API, handles PII" -f json -o report.json
```

Also works with `code_reviewer`:

```bash
npx agent-run -r code_reviewer --diff-context pr-diff.json -s ./src
```

### Diff context JSON shape

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

### PR chunking (large PRs)

When a diff exceeds the model context, **chunking** splits it into batches, reviews each, and merges one report.

**Config** (`conf/appsec_agent.yaml` under `pr_reviewer.options` — on by default for `pr_reviewer` + diff mode):

- `diff_review_max_tokens_per_batch` — e.g. `150000` (0 = disabled)
- `diff_review_max_batches` — e.g. `3`
- `diff_review_max_files` — optional cap
- `diff_review_exclude_paths` — e.g. `["src/analytics/*"]`

**CLI overrides:**

```bash
npx agent-run -r pr_reviewer --diff-context pr-diff.json

npx agent-run -r code_reviewer --diff-context pr-diff.json \
  --diff-max-tokens 150000 --diff-max-batches 3

npx agent-run -r pr_reviewer --diff-context pr-diff.json \
  --diff-max-files 50 --diff-exclude '**/test/**'
```

Merged JSON reports may include a **Skipped** section and `meta.total_cost_usd`.

### Optional enrichment (integrators)

| Flag | Purpose |
|------|---------|
| `--import-graph-context` | Per-file import reachability (`pr_reviewer` + diff only) |
| `--runtime-enrichment-context` | Production incident / hot-file hints |
| `--codebase-graph-context` | Callers/callees / blast radius from codebase graph |
| `--cross-repo-context` | Cross-repo service-topology peers (typed relationship + enforcement note) |
| `--mcp-server-url` | Live MCP queries instead of pre-loaded JSON — now also exposes `queryCrossRepoGraph` (live counterpart to `--cross-repo-context`, optional `peer_name_filter`) alongside `queryFindingsHistory`/`queryImportGraph`/`queryRuntimeEnrichment`/`queryCodebaseGraph` |

---

## Adversarial passes

### `pr_adversary` — filter PR findings

```bash
npx agent-run -r pr_adversary --adversarial-context candidates.json -s ./repo -f json \
  -o adversarial_code_review_report.json

npx agent-run -r pr_adversary --adversarial-context candidates.json \
  --diff-context pr-diff.json -s ./repo -f json
```

**Minimum input per finding:** `id`, `title`, `file`, `description`

```json
{
  "findings": [
    {
      "id": "SEC-001",
      "title": "SQL injection",
      "file": "src/a.ts",
      "description": "User input in query string",
      "severity": "HIGH",
      "confidence": "HIGH",
      "recommendation": "Use parameterized queries"
    }
  ],
  "pr_number": 123,
  "head_sha": "abc123"
}
```

`--experiment-enabled` — stricter false-positive rules (also affects `pr_reviewer` when passed on the first pass).

### `fp_adversary` — full-repo false-positive filter

```bash
npx agent-run -r fp_adversary --adversarial-context fp_in.json -s ./repo -f json \
  -o fp_adversary_report.json
```

**Input (excerpt):**

```json
{
  "findings": [
    {
      "fingerprint": "fp-sha256-of-cwe-file-snippet-line",
      "id": "SEC-001",
      "title": "SQL injection",
      "file": "src/db.ts",
      "description": "…",
      "severity": "HIGH",
      "confidence": "MEDIUM",
      "cwe_id": "CWE-89"
    }
  ],
  "project_summary": "A Next.js SaaS app",
  "security_context": "Prisma ORM with parameterized queries",
  "similar_dismissed": []
}
```

**Output (excerpt):**

```json
{
  "fp_adversary_report": {
    "verdicts": [
      {
        "fingerprint": "fp-sha256-of-cwe-file-snippet-line",
        "verdict": "dismiss",
        "confidence": 0.92,
        "rationale": "Prisma parameterized query mitigates; no concrete bypass path.",
        "cost_usd_estimate": 0.001
      }
    ]
  }
}
```

---

## Code fixer

```bash
npx agent-run -r code_fixer --fix-context fix_context.json
npx agent-run -r code_fixer --fix-context fix_context.json -s ./src
npx agent-run -r code_fixer --fix-context fix_context.json -o my_fix.json
```

**Fix context (excerpt):**

```json
{
  "finding": {
    "title": "SQL Injection",
    "severity": "HIGH",
    "cwe": "CWE-89",
    "file": "src/db.ts",
    "line": 42,
    "description": "User input concatenated into SQL",
    "recommendation": "Use parameterized queries"
  },
  "code_context": {
    "language": "typescript",
    "vulnerable_section": "const result = db.query(`SELECT * FROM users WHERE id = ${userId}`);",
    "vulnerable_section_start": 40,
    "vulnerable_section_end": 44
  }
}
```

**Output (excerpt):**

```json
{
  "fixed_code": "const result = db.query('SELECT * FROM users WHERE id = ?', [userId]);",
  "start_line": 42,
  "end_line": 42,
  "explanation": "Parameterized query prevents SQL injection",
  "confidence": "high",
  "breaking_changes": false
}
```

---

## QA verifier

```bash
npx agent-run -r qa_verifier --qa-context qa_context.json
npx agent-run -r qa_verifier --qa-context qa_context.json -s ./src -o qa_verdict.json
```

**QA context (excerpt):**

```json
{
  "pr_url": "https://github.com/owner/repo/pull/42",
  "test_command": "npm test",
  "test_framework": "jest",
  "setup_commands": "npm ci",
  "timeout_seconds": 120,
  "block_on_failure": true,
  "environment_variables": { "NODE_ENV": "test" }
}
```

**Output (excerpt):**

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

---

## Threat modeling

```bash
npx agent-run -r threat_modeler -s ./src -f json -o threat_model_report.json

npx agent-run -r threat_modeler -s ./api -f json \
  -c "AWS Lambda in VPC, handles PII, SOC2 scope"

npx agent-run -r threat_modeler -s ./src -f json --max-turns 50
```

**Optional `source_locations` on threats (v3.1.0+):**

```json
{
  "threat_model_report": {
    "threat_model": {
      "threats": [
        {
          "id": "THREAT-001",
          "title": "SQL injection in user lookup",
          "source_locations": [
            {
              "file": "src/db/users.ts",
              "line_numbers": "42-44",
              "symbol": "findUserById",
              "snippet": "const q = `SELECT * FROM users WHERE id = ${id}`;"
            }
          ]
        }
      ]
    }
  }
}
```

### `threat_adversary` second pass

```bash
npx agent-run -r threat_adversary --adversarial-context threat_model_report.json \
  -s ./repo -f json -o threat_model_adversary_report.json
```

Wrap the first-pass report:

```json
{
  "threat_model_report": {
    "data_flow_diagram": { "nodes": [], "flows": [], "trust_boundaries": [] },
    "threat_model": { "executive_summary": "…", "threats": [] },
    "risk_registry": { "summary": "…", "risks": [] },
    "metadata": { "total_threats_identified": 0, "total_risks_identified": 0 }
  }
}
```

Empty `threats` arrays skip the LLM and copy input to `-o`.

---

## Codex provider examples

```bash
export CODEX_API_KEY="..."
export AGENT_PROVIDER=codex   # optional if you pass --provider each time

npx agent-run -r threat_modeler -s ./src -f json --provider codex -m gpt-4.1

npx agent-run -r pr_reviewer --diff-context pr-diff.json -s ./repo \
  --provider codex -m gpt-4.1 -f json

npx agent-run -r pr_adversary --adversarial-context candidates.json -s ./repo \
  --provider codex -m o3 -f json -o filtered.json
```

See [Configuration — Model providers](configuration.md#model-providers).

---

## MCP server

```bash
npx agent-run -r pr_reviewer --diff-context pr-diff.json \
  --mcp-server-url http://127.0.0.1:9999/mcp \
  --mcp-server-name appsec-internal \
  -f json
```

Or via environment (common in parent-app integrations):

```bash
export SAST_INTERNAL_TOOLS_MCP_URL="http://127.0.0.1:9999/mcp"
export SAST_INTERNAL_TOOLS_MCP_BEARER="your-token"
```

---

## Global install note

If you ran `npm install -g appsec-agent`, use `agent-run` instead of `npx agent-run` in every command above.
