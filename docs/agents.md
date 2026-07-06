# Agents guide

Each **role** is a specialized security workflow. Pass the role name with `-r` / `--role`.

[← Back to README](../README.md) · [Examples](examples.md) · [Configuration](configuration.md)

---

## Quick reference

| Role | One-line summary | Typical input |
|------|------------------|---------------|
| `simple_query_agent` | Ask AppSec questions | Your question (+ optional `-s`) |
| `code_reviewer` | Scan a repo for vulnerabilities | `-s` source dir |
| `pr_reviewer` | Review only PR/diff changes | `--diff-context` JSON |
| `pr_adversary` | Filter weak PR findings (2nd pass) | `--adversarial-context` JSON |
| `fp_adversary` | Confirm/dismiss full-repo findings | `--adversarial-context` JSON |
| `code_fixer` | Produce a minimal code fix | `--fix-context` JSON |
| `qa_verifier` | Run tests after a fix | `--qa-context` JSON |
| `finding_validator` | Re-check if a finding still applies | `--retest-context` JSON |
| `threat_modeler` | STRIDE threat model + risks | `-s` source dir, `-f json` |
| `threat_adversary` | Filter weak threats (2nd pass) | `--adversarial-context` JSON |
| `context_extractor` | Extract repo metadata | `--extract-context` JSON |
| `learned_guidance_synthesizer` | Build dismissal guidance rules | `--inputs` JSON |

List roles anytime: `npx agent-run -l`

---

## Core agents

### `simple_query_agent`

**Use when:** You want a conversational AppSec assistant.

- Answers security questions and explains concepts
- Can search a source tree when you pass `-s ./src`

```bash
npx agent-run -r simple_query_agent -s ./my-project
```

---

### `code_reviewer`

**Use when:** You need a security report for an entire repository or folder.

- Detects vulnerabilities and privacy issues
- Output formats: markdown (default), JSON, XML, CSV, XLSX
- Tools: Read, Grep, Write
- Add `-c "..."` for deployment context (AWS, K8s, compliance scope, etc.)
- PR diff mode: pass `--diff-context` (same flag as `pr_reviewer`; `pr_reviewer` is tuned for PR workflows)

```bash
npx agent-run -r code_reviewer -s ./src -f json -o report.json
```

---

### `pr_reviewer`

**Use when:** You are reviewing a **Pull Request** and only want changed files analyzed.

- Same security goals as `code_reviewer`, optimized for diff context
- **Chunking on by default** for large PRs (splits diff into batches, merges reports)
- Supports optional enrichment JSON: import graph, runtime enrichment, codebase graph
- MCP-aware when `--mcp-server-url` is set (live queries for findings history, graphs, etc.)

```bash
npx agent-run -r pr_reviewer --diff-context pr-diff.json -s ./repo -f json
```

Works with **Claude** (default) and **Codex** (`--provider codex`).

---

### `pr_adversary`

**Use when:** A first-pass PR review produced too many findings and you want a **skeptical second pass**.

- Drops findings that lack a concrete exploit or failure path
- Input: JSON list of candidate findings (`--adversarial-context`)
- Output: filtered `security_review_report` JSON (same schema as `pr_reviewer`)
- Optional `--diff-context` for extra PR context
- `--experiment-enabled` applies stricter false-positive rules

```bash
npx agent-run -r pr_adversary --adversarial-context candidates.json -s ./repo -f json -o filtered.json
```

Works with **Claude** and **Codex**.

---

### `fp_adversary`

**Use when:** You ran a full-repo `code_reviewer` scan and need per-finding **confirm/dismiss** verdicts (Lane-2 false-positive filter).

- Output schema: `fp_adversary_report` (not the same as `security_review_report`)
- Each verdict includes confidence (0–1) and rationale
- MCP-aware like `pr_adversary`

---

## Fix and verify pipeline

### `code_fixer`

**Use when:** You have one finding and need a **minimal patch**.

- Input: `--fix-context` JSON (finding + code snippet)
- Output: structured JSON with `fixed_code`, line range, explanation, confidence

### `qa_verifier`

**Use when:** A fix was applied and you need to **run the test suite**.

- Input: `--qa-context` JSON (test command, timeout, env vars)
- Uses a restricted Bash tool to execute tests
- Output: `QaVerdict` JSON (pass/fail, logs, analysis)

### `finding_validator`

**Use when:** You need to **retest** whether an existing finding still reproduces.

- Input: `--retest-context` JSON

---

## Threat modeling

### `threat_modeler`

**Use when:** You need a formal **STRIDE threat model** with DFD and risk registry.

- Recommended output: `-f json` → `threat_model_report`
- Optional `source_locations` on nodes/threats/risks when grounded in code (v3.1.0+)
- Default **100** tool turns (configurable in yaml or `--max-turns`)

```bash
npx agent-run -r threat_modeler -s ./api -f json -o threat_model_report.json
```

### `threat_adversary`

**Use when:** The first threat model has generic or ungrounded threats.

- Input: first-pass `threat_model_report` via `--adversarial-context`
- Output: filtered report (same schema)
- Empty threat lists skip the LLM call

---

## Supporting roles

### `context_extractor`

Extracts repository metadata and file summaries for downstream automation (`--extract-context`).

### `learned_guidance_synthesizer`

Synthesizes class-level dismissal guidance from bucketed signals (`--inputs`). Used by integrators building learned false-positive rules.

---

## Two-pass patterns

Many production pipelines run **two passes**:

```text
pr_reviewer  →  pr_adversary
threat_modeler  →  threat_adversary
code_reviewer  →  fp_adversary   (full-repo FP filter)
```

The first pass finds issues; the second pass removes findings that cannot be grounded in real attack paths.

---

## Model providers

All roles support:

- **Claude** (default) — `ANTHROPIC_API_KEY`, `-m sonnet|opus|haiku`
- **Codex** (opt-in) — `--provider codex`, `CODEX_API_KEY`, `-m gpt-*` or `o*`

Details: [Configuration — Model providers](configuration.md#model-providers)
