# LLM Failover Implementation Plan (Anthropic → OpenAI)

This document describes the implementation steps for adding failover from Anthropic to the OpenAI API when the primary provider fails (e.g. API outage, rate limits, or task failure). Failover logic lives **inside appsec-agent** so that any caller (CLI or controlling app) gets resilience without implementing provider logic themselves.

---

## Scope and decisions

- **Where failover lives:** In the appsec-agent package (this repo). The controlling app continues to call the worker as today; failover is an internal detail of the worker.
- **Failover is optional, off by default:** Default behavior is **Anthropic only**. Failover (try OpenAI when Anthropic fails) is an optional feature that must be explicitly enabled. When disabled, the agent behaves exactly as today—no OpenAI dependency or calls.
- **OpenAI integration:** Use the OpenAI API via the official `openai` package only (no raw `fetch`). Do not use the Codex SDK (that controls the Codex agent, not raw model calls) or LiteLLM for this minimal implementation.
- **Fallback scope:** Full failover for **all agents** (simple query, code reviewer, threat modeler, diff reviewer). When Anthropic fails, every agent type can fall back to OpenAI so the parent app always sees a single response path—no special handling per agent. For tooled agents, the fallback run uses the same prompt and system message but without tool execution (OpenAI Chat Completions has no Read/Grep/Write); the adapter normalizes the response so the app contract is unchanged.

---

## Implementation steps

### Step 1: Add dependency and config

1. **OpenAI client**
   - Add the official client only: `npm install openai`. Do not use a raw `fetch`-based implementation; the package is maintained by OpenAI and easier to keep up with API changes.

2. **Environment and config**
   - Read all failover-related values from **environment variables** (do not hard-code). Config file (e.g. `conf/appsec_agent.yaml`) may provide defaults, but runtime values come from env when set.
   - **Default:** Failover is **disabled**. No OpenAI calls unless failover is explicitly enabled.
   - Env vars (no hard-coding):
     - `OPENAI_API_KEY`: required for fallback when failover is enabled.
     - `OPENAI_BASE_URL`: optional; for custom/partner endpoints.
     - `FAILOVER_ENABLED`: set to `true` (or equivalent) to enable failover; default is disabled.
     - `OPENAI_FALLBACK_MODEL`: e.g. `gpt-4o`; only used when failover runs.

3. **CLI (mandatory)**
   - In `bin/agent-run.ts`, implement CLI options that **override** config or env when provided:
     - `--failover`: enable failover (overrides `failover_enabled` from config/env).
     - `--openai-api-key`: OpenAI API key (overrides `OPENAI_API_KEY`).
   - Precedence: CLI overrides env overrides config file. Without `--failover` and with `failover_enabled` false in config/env, behavior is Anthropic-only.

---

### Step 2: Implement the adapter module

1. **New module**
   - Add e.g. `src/llm_query.ts` or `src/provider_adapter.ts`.

2. **Contract**
   - Export an async generator that yields the **same** message types the rest of the codebase uses:
     - `stream_event` (with `content_block_delta` / `text_delta`-style payloads for streaming text).
     - `assistant` (full message when stream ends or non-streaming).
     - `result` (final message; e.g. `is_error: false`, optional cost if available).

3. **Primary path**
   - Call `query({ prompt, options })` from `@anthropic-ai/claude-agent-sdk`.
   - Yield each message unchanged to the caller.

4. **Fallback path**
   - On thrown error (network, 5xx, rate limit, etc.):
     - If failover is disabled (default) or `OPENAI_API_KEY` is not set, rethrow immediately—no OpenAI call.
     - Otherwise call the **OpenAI Chat Completions API** with:
       - `messages`: e.g. `[{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]`.
       - Derive `systemPrompt` from `options.systemPrompt` (simple query) or from the main agent’s `prompt` in `options.agents` (tooled agents).
       - `stream: true`, model from config (e.g. `openai_fallback_model`).
     - Normalize the OpenAI stream to the existing shapes:
       - For each text delta: yield a `stream_event`-like object (so existing `content_block_delta` / `text_delta` handling in `agent_actions.ts` still works, or map to that shape).
       - When stream ends: yield one `assistant`-like message with the full text.
       - Yield one `result`-like message (e.g. `is_error: false`; omit or approximate cost if not available).

5. **Scope**
   - Adapter only handles “try Anthropic, on failure call OpenAI and normalize.” No change to tool execution or multi-turn logic in this step; keep single-turn, prompt-in → stream-out behavior.

---

### Step 3: Use the adapter at all query call sites

1. **Replace direct `query()` usage**
   - In `src/agent_actions.ts`, replace all four `query({ prompt, options })` usages with the new adapter (e.g. `llmQuery({ prompt, options })` or `queryWithFailover(...)`):
     - Simple query agent.
     - Code reviewer.
     - Threat modeler.
     - Diff reviewer.
   - Each loop already iterates over the same message types; with the normalized shape, no other changes should be needed in those methods.

2. **Pass failover config**
   - Ensure the adapter receives failover flags and OpenAI model (from env, config file, or CLI) so it can decide whether to fall back and which model to use.

---

### Step 4: Tests

1. **Adapter unit tests**
   - Mock the Claude SDK `query()` to throw (e.g. simulate 503 or network error).
   - Assert that the OpenAI client is called with the expected `messages` and model.
   - Assert that the adapter’s yielded sequence has the expected `stream_event` / `assistant` / `result` shape.
   - Mock the OpenAI client so no real API keys are required.

2. **Success path**
   - When Anthropic succeeds, assert the adapter does **not** call the OpenAI client.

3. **Optional**
   - Integration test with real keys behind a flag or in CI secrets; skip by default.

---

### Step 5: Documentation and CLI

1. **README**
   - State that **failover is off by default**; default behavior is Anthropic only.
   - Document how to enable failover: `failover_enabled: true` (or env) and `OPENAI_API_KEY`; optional `OPENAI_BASE_URL`.
   - Describe failover behavior when enabled: Anthropic first, then OpenAI on failure.
   - Note scope: full failover for all agents (simple query and tooled); tooled agents fall back with prompt + system message only (no tool execution on OpenAI), so the parent app is unaffected.

2. **CLI help**
   - Document the mandatory CLI options: `--failover` enables failover (optional feature, off by default); `--openai-api-key` overrides config/env key. State that CLI overrides env overrides config.

---

## Order of work (summary)

| Order | Task |
|-------|------|
| 1 | Add `openai` dependency and config (env, optional YAML/CLI). |
| 2 | Implement adapter module (try Anthropic → on failure call OpenAI, normalize stream). |
| 3 | Replace all four `query()` call sites in `agent_actions.ts` with the adapter. |
| 4 | Add adapter unit tests (mock both providers). |
| 5 | Update README and CLI help for failover and OpenAI config. |

---

## Reference: why not Codex SDK or LiteLLM

- **Codex SDK** ([developers.openai.com/codex/sdk](https://developers.openai.com/codex/sdk/)): Controls the Codex agent (threads, runs). It is not a low-level “call an OpenAI model and stream text” API. For failover we need Chat Completions, so the **OpenAI API** (e.g. `openai` package) is the correct building block.
- **LiteLLM**: Provides multi-provider and failover as a proxy or SDK; we are keeping this implementation minimal and in-package with the OpenAI API directly.
