# Getting started

This guide walks you through installing AppSec Agent and running your first commands. No prior experience with AI agents is required.

[← Back to README](../README.md)

---

## Prerequisites

| Requirement | Notes |
|-------------|--------|
| **Node.js 18+** | Check with `node -v` |
| **npm** | Usually installed with Node |
| **Anthropic API key** | Required for the default Claude provider — [console.anthropic.com](https://console.anthropic.com/) |
| **Codex API key** (optional) | Only if you use `--provider codex` — see [Configuration](configuration.md) |

> **Claude Code CLI is optional.** This package bundles the Claude Agent SDK binary. You do not need to install `@anthropic-ai/claude-code` separately unless you want the standalone `claude` CLI for manual use.

---

## Installation

### Option A — Use from npm (recommended for beginners)

In any project folder:

```bash
npm install appsec-agent
```

Run commands with `npx agent-run ...`.

### Option B — Global CLI

```bash
npm install -g appsec-agent
agent-run -l
```

### Option C — Clone and develop locally

For contributors or people patching the source:

```bash
git clone <repository-url>
cd appsec-agent
npm install
npm run build
node dist/bin/agent-run.js -l
```

During development you can also run:

```bash
npx ts-node bin/agent-run.ts -l
```

> **Tip:** Do not run `node bin/agent-run.ts` directly — Node’s native TypeScript runner cannot load the full source tree. Use `ts-node` or the compiled `dist/bin/agent-run.js` after `npm run build`.

---

## Set up your API key

The default provider is **Claude**. Export your key in the shell you use to run agents:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Optional — custom API endpoint (rare):

```bash
export ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

Add those lines to `~/.zshrc` or `~/.bashrc`, then **open a new terminal** so the variable is loaded.

**Security:** Prefer environment variables over passing keys on the command line (`-k`). CLI arguments can appear in process lists and shell history.

---

## Your first commands

### Interactive Q&A

```bash
npx agent-run
```

Uses the default role `simple_query_agent`. Type a security question when prompted.

### List all roles

```bash
npx agent-run -l
```

Example output:

```
Available roles:
- simple_query_agent
- code_reviewer
- pr_reviewer
- threat_modeler
...
```

### Review source code

```bash
npx agent-run -r code_reviewer -s ./src
```

`-s` points at the folder to analyze. A markdown report is written based on your config (see [Configuration](configuration.md)).

### Check the version

```bash
npx agent-run -v
```

### See all CLI flags

```bash
npx agent-run --help
```

---

## Understanding the CLI

Every run follows the same pattern:

```bash
npx agent-run -r <role> [options]
```

| Flag | Meaning |
|------|---------|
| `-r`, `--role` | Which agent to run (default: `simple_query_agent`) |
| `-s`, `--src_dir` | Source code directory |
| `-f`, `--output_format` | `markdown`, `json`, `xml`, `csv`, `xlsx` |
| `-o`, `--output_file` | Where to write the report |
| `-c`, `--context` | Free-text deployment/architecture context |
| `-m`, `--model` | Model alias: `sonnet`, `opus`, `haiku` (Claude) |
| `--provider` | `claude` (default) or `codex` |
| `-l`, `--list_roles` | Print roles and exit |
| `-v`, `--version` | Print version and exit |
| `-V`, `--verbose` | More logging |

Role-specific flags (`--diff-context`, `--fix-context`, etc.) are documented in [Examples](examples.md).

---

## Typical workflows

```text
Full repo review     →  code_reviewer  +  -s ./src
PR / diff review     →  pr_reviewer    +  --diff-context pr.json
Filter PR findings   →  pr_adversary   +  --adversarial-context candidates.json
Threat model         →  threat_modeler +  -s ./src -f json
Fix one finding      →  code_fixer     +  --fix-context fix.json
Verify a fix         →  qa_verifier    +  --qa-context qa.json
```

See [Agents](agents.md) for when to use each role and [Examples](examples.md) for full commands.

---

## Troubleshooting

### `require is not defined` or module not found when running `.ts` files

Use one of:

```bash
npx ts-node bin/agent-run.ts -l
npm run build && node dist/bin/agent-run.js -l
```

### `ANTHROPIC_API_KEY` errors

1. Confirm the variable is set: `echo $ANTHROPIC_API_KEY`
2. Open a new terminal after editing your shell profile
3. Do not wrap the key in extra quotes inside the profile file

### Role ignores a flag (warning in output)

Some JSON context files only apply to specific roles (e.g. `--diff-context` → `pr_reviewer` / `code_reviewer`). The CLI prints a warning and continues — see [Examples](examples.md).

### Large PR runs out of context

Use `pr_reviewer` with `--diff-context`; chunking is enabled by default. See [Examples — PR chunking](examples.md#pr-chunking-large-prs).

---

## Next steps

- [Agents guide](agents.md) — pick the right role
- [Examples](examples.md) — copy-paste commands and JSON formats
- [Configuration](configuration.md) — yaml config and Codex provider
- [AI Threat Modeler](https://github.com/yangsec888/ai-threat-modeler/) — web UI powered by this package
