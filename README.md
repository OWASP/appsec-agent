# AppSec Agent

AI-powered security agents for code review, PR scanning, threat modeling, fix generation, and more.

You can use **AppSec Agent** in three ways:

| Path | Best for | Get started |
|------|----------|-------------|
| **CLI** (`agent-run`) | Trying agents from your terminal | [Getting started](docs/getting-started.md) |
| **npm library** | Building your own app or pipeline | [Web integration](docs/web-integration.md) · [Development](docs/development.md) |
| **[AI Threat Modeler](https://github.com/yangsec888/ai-threat-modeler/)** | A full web UI with login, dashboards, and exports — no CLI required | [Parent app README](https://github.com/yangsec888/ai-threat-modeler/blob/main/README.md) |

**Install from npm:** `npm install appsec-agent`

---

## What you need first

1. **Node.js 18+** — [nodejs.org](https://nodejs.org/)
2. **An API key** — by default the **Claude** provider uses `ANTHROPIC_API_KEY` ([Anthropic console](https://console.anthropic.com/)). Optional **Codex** provider uses `CODEX_API_KEY` — see [Configuration](docs/configuration.md).
3. **A terminal** — commands below use `npx`; if you installed globally, drop the `npx` prefix.

---

## Quick start (5 minutes)

### 1. Install

```bash
npm install appsec-agent
```

Or install globally so `agent-run` is on your PATH:

```bash
npm install -g appsec-agent
```

### 2. Set your API key

Add to your shell profile (`.zshrc`, `.bashrc`, etc.), then open a new terminal:

```bash
export ANTHROPIC_API_KEY="your-key-here"
```

### 3. Run your first agent

```bash
# Interactive security Q&A (default role)
npx agent-run

# List every available role
npx agent-run -l

# Review code in the current project
npx agent-run -r code_reviewer -s ./src
```

That’s it. For step-by-step setup, troubleshooting, and running from a git clone, see **[Getting started](docs/getting-started.md)**.

---

## Choose an agent

Each **role** is a specialized workflow. Pass it with `-r` / `--role`.

| Role | What it does |
|------|----------------|
| `simple_query_agent` | Ask AppSec questions; optional source folder |
| `code_reviewer` | Full-repo security review; markdown or JSON report |
| `pr_reviewer` | PR/diff-focused review (use with `--diff-context`) |
| `pr_adversary` | Second pass: drop findings without a real exploit path |
| `fp_adversary` | Full-repo false-positive filter (confirm/dismiss verdicts) |
| `code_fixer` | Generate a minimal fix for one finding |
| `qa_verifier` | Run tests to check a fix didn’t break anything |
| `finding_validator` | Re-test whether a finding still applies |
| `threat_modeler` | STRIDE threat model + risk registry (JSON) |
| `threat_adversary` | Second pass: filter ungrounded threats |
| `context_extractor` | Extract repo metadata for downstream tools |
| `learned_guidance_synthesizer` | Synthesize dismissal guidance from signal buckets |

Full descriptions: **[Agents guide](docs/agents.md)**  
Copy-paste commands and JSON file formats: **[Examples](docs/examples.md)**

---

## Common commands

```bash
# PR security review (JSON report)
npx agent-run -r pr_reviewer --diff-context pr-diff.json -s ./repo -f json -o report.json

# Threat model (JSON)
npx agent-run -r threat_modeler -s ./src -f json -o threat_model_report.json

# Use OpenAI Codex instead of Claude (opt-in)
npx agent-run -r threat_modeler -s ./src -f json --provider codex -m gpt-4.1

# Add deployment context (helps prioritize findings)
npx agent-run -r code_reviewer -s ./src -c "Production API on AWS, handles PII"

# Version and help
npx agent-run -v
npx agent-run --help
```

---

## Documentation

| Guide | Contents |
|-------|----------|
| [Getting started](docs/getting-started.md) | Install, API keys, first runs, troubleshooting |
| [Agents](docs/agents.md) | What each role is for and when to use it |
| [Examples](docs/examples.md) | CLI recipes and JSON input shapes |
| [Configuration](docs/configuration.md) | Environment variables, `appsec_agent.yaml`, Claude vs Codex |
| [Web integration](docs/web-integration.md) | Using the library in a server safely |
| [Development](docs/development.md) | Clone, build, test, architecture |

---

## Features at a glance

- Multiple specialized agents (review, PR scan, threat model, fix, QA, adversarial passes)
- **Claude** (default) or **Codex** (`--provider codex`) backends
- Structured JSON outputs with schemas for parent-app integration
- PR diff mode and automatic chunking for large PRs
- Optional MCP tools for live findings history, import graphs, and codebase graphs
- Thread-safe library design for web servers

---

## Related projects

**[AI Threat Modeler](https://github.com/yangsec888/ai-threat-modeler/)** bundles this package into a Dockerized Next.js app with authentication, threat-model canvas, PDF/CSV export, and chat — the easiest path if you don’t want to write integration code.

```bash
git clone https://github.com/yangsec888/ai-threat-modeler.git
cd ai-threat-modeler
docker-compose up -d --build
# Open http://localhost:3000  (default: admin / admin)
```

---

## License & author

Licensed under [Apache 2.0](LICENSE).

**Sam Li** — [yang.li@owasp.org](mailto:yang.li@owasp.org)

**References:** [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk) · [Anthropic API](https://docs.anthropic.com/)
