# Configuration

Environment variables, the yaml config file, and model provider options.

[← Back to README](../README.md) · [Getting started](getting-started.md)

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (Claude default) | Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | API endpoint (default: `https://api.anthropic.com`) |
| `AGENT_PROVIDER` | No | `claude` (default) or `codex` |
| `CODEX_API_KEY` | Yes (if Codex) | OpenAI Codex API key |
| `CODEX_BASE_URL` | No | Custom Codex API base URL |
| `SAST_INTERNAL_TOOLS_MCP_URL` | No | MCP server URL (alternative to `--mcp-server-url`) |
| `SAST_INTERNAL_TOOLS_MCP_BEARER` | No | Bearer token for MCP HTTP auth |

CLI flags override env where noted (e.g. `--provider`, `--mcp-server-url`).

---

## Configuration file

Default path: `conf/appsec_agent.yaml` (bundled with the package).

Structure:

```yaml
default:
  threat_modeler:
    options:
      max_turns: 100
  pr_reviewer:
    options:
      diff_review_max_tokens_per_batch: 150000
      diff_review_max_batches: 3
```

- **`environment`** — top-level key (default: `default`); pass `-e` / `--environment` to select
- **`options.max_turns`** — tool-use turn limit per role
- **`pr_reviewer.options`** — PR chunking settings (see [Examples — PR chunking](examples.md#pr-chunking-large-prs))

Override the file path: `-y /path/to/appsec_agent.yaml`

Override turns for any role: `--max-turns <n>`

---

## Model providers

Since v3.0.0, every role uses a provider-neutral **RoleSpec**. Pick the backend at runtime.

### Claude (default)

Uses the Anthropic API via `@anthropic-ai/claude-agent-sdk`.

```bash
npx agent-run -r code_reviewer -s ./src -m sonnet
```

**Model aliases:** `sonnet`, `opus`, `haiku`, or full IDs like `claude-sonnet-4-6`.

### Codex (opt-in)

Uses `@openai/codex-sdk`. Requires `CODEX_API_KEY` (or `--provider codex` with key in env).

```bash
export CODEX_API_KEY="..."
npx agent-run -r pr_reviewer --diff-context pr.json -s ./repo \
  --provider codex -m gpt-4.1 -f json
```

**Model IDs:** `gpt-*`, `o*` (e.g. `gpt-4.1`, `o3`). Claude aliases are mapped automatically (`opus` → `o3`, `sonnet` → `gpt-4.1`).

Set globally:

```bash
export AGENT_PROVIDER=codex
```

### MCP on both providers

When `--mcp-server-url` is set, supported roles attach an HTTP MCP server exposing:

- `queryFindingsHistory`
- `queryImportGraph`
- `queryRuntimeEnrichment`
- `queryCodebaseGraph`

MCP-aware roles: `pr_reviewer`, `code_reviewer`, `pr_adversary`, `fp_adversary`, `finding_validator`, `code_fixer`.

Override server name (affects tool prefix): `--mcp-server-name my-server`

Default name: `appsec-internal` → tools appear as `mcp__appsec-internal__queryFindingsHistory`, etc.

Parent apps can pass URL via env instead of argv:

```bash
export SAST_INTERNAL_TOOLS_MCP_URL="http://127.0.0.1:9999/mcp"
export SAST_INTERNAL_TOOLS_MCP_BEARER="token-if-needed"
```

---

## CLI security notes

- **API keys:** Use env vars, not `-k/--anthropic-api-key`, in production
- **Input files:** Paths are validated against directory traversal before reading
- **Output files:** Validated similarly on write

---

## Per-role output formats

| Role | Default output | Structured schema |
|------|----------------|-------------------|
| `code_reviewer` / `pr_reviewer` | markdown | `security_review_report` (JSON with `-f json`) |
| `pr_adversary` | JSON only | `security_review_report` |
| `fp_adversary` | JSON only | `fp_adversary_report` |
| `threat_modeler` | markdown | `threat_model_report` (JSON with `-f json`) |
| `code_fixer` | JSON | `FixOutput` |
| `qa_verifier` | JSON | `QaVerdict` |

Schema sources live in `src/schemas/`.
