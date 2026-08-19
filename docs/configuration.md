# Configuration

Environment variables, the yaml config file, and model provider options.

[← Back to README](../README.md) · [Getting started](getting-started.md)

---

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes (Claude default) | Anthropic API key |
| `ANTHROPIC_BASE_URL` | No | API endpoint (default: `https://api.anthropic.com`) |
| `AGENT_PROVIDER` | No | `claude` (default), `codex`, or `deepinfra` |
| `CODEX_API_KEY` | Yes (if Codex) | OpenAI Codex API key |
| `CODEX_BASE_URL` | No | Custom Codex API base URL |
| `DEEPINFRA_API_KEY` | Yes (if DeepInfra) | DeepInfra API key ([deepinfra.com](https://deepinfra.com)) |
| `DEEPINFRA_BASE_URL` | No | DeepInfra API base URL (default: `https://api.deepinfra.com/v1/openai`) |
| `DEEPINFRA_REASONING_EFFORT` | No | `none`, `low`, `medium` (default), or `high` — caps reasoning-model token spend |
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

### DeepInfra (opt-in)

Uses [DeepInfra's](https://docs.deepinfra.com/) OpenAI-compatible API via the `openai` SDK, driven as a full agent loop (local `Read`/`Grep`/`Write`/`Bash` tools plus MCP), so every role works — not just no-tools ones. Requires `DEEPINFRA_API_KEY`.

DeepInfra is a [HIPAA- and SOC 2-certified](https://deepinfra.com) inference cloud hosting open-weight models (Kimi, DeepSeek, GLM, Qwen, gpt-oss, and more) behind a single API.

```bash
export DEEPINFRA_API_KEY="..."
npx agent-run -r code_reviewer -s ./src --provider deepinfra -m kimi-k2.6 -f json
```

**Model IDs:** either a short alias (`kimi-k2.6` (default), `kimi-k3`, `kimi-k2.7-code`, `deepseek-v3.2`, `deepseek-v4-pro`, `glm-4.7`, `glm-5`, `qwen3-coder`, `gpt-oss-120b`, `gpt-oss-20b`) or a raw DeepInfra slug (`vendor/Model`, e.g. `zai-org/GLM-5.2`). Claude aliases map to the default `moonshotai/Kimi-K2.6`. The provider verifies the requested id against `GET /v1/models` at runtime (restricted to chat-capable models) and falls back to the default if it is unavailable.

**Reasoning effort:** DeepInfra's reasoning models (e.g. Kimi) reason heavily by default, which can dominate both cost and latency. This provider sends `reasoning_effort` on every request, defaulting to `medium`. Override with `DEEPINFRA_REASONING_EFFORT` or `--reasoning-effort` (`none` / `low` / `medium` / `high`).

**Cost:** reported cost uses DeepInfra's exact per-request `estimated_cost` when present, falling back to live per-model pricing from `GET /v1/models` — no hardcoded price table to keep in sync.

Set globally:

```bash
export AGENT_PROVIDER=deepinfra
```

### MCP on all providers

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
