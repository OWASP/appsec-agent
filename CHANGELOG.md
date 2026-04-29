# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.4.4] - 2026-04-28

### Added
- **`pr_reviewer` MCP system-prompt nudge — §8.17 phase 3:** `buildPrReviewerMcpNudgeSystemPromptSuffix()` / `getDiffReviewerOptions` now also names `mcp__<server>__queryRuntimeEnrichment` and nudges the model to use live runtime-incident / hot-files signal for changed paths. Completes the staged ladder alongside `queryFindingsHistory` and `queryImportGraph` (v2.4.3).
- **Tests:** `agent_options.mcp.test.ts` and `e2e/pr_reviewer_mcp.e2e.test.ts` updated to assert all three tool ids in the system prompt when `--mcp-server-url` is set for `pr_reviewer`.

## [2.4.3] - 2026-04-28

### Added
- **`pr_reviewer` system-prompt nudge for MCP phase 2 (parent-app §8.17 staged ladder):** when `--mcp-server-url` is set, `getDiffReviewerOptions` appends a short instruction block that names the live SDK tools `mcp__<server>__queryFindingsHistory` and `mcp__<server>__queryImportGraph` so the model is steered toward reachability and findings-history lookups instead of guessing. `queryRuntimeEnrichment` is deliberately omitted from the nudge until phase 3. New exported helper `buildPrReviewerMcpNudgeSystemPromptSuffix()` builds the same suffix for tests or downstream snapshot tooling.
- **Tests:** extended `src/__tests__/agent_options.mcp.test.ts` (nudge presence, server-name override, `code_reviewer` role does not get the `pr_reviewer` nudge, no MCP URL → no nudge) and `e2e/pr_reviewer_mcp.e2e.test.ts` (assert system `prompt` contains the phase-2 tool ids when MCP is wired).

## [2.4.2] - 2026-04-28

### Changed
- **MCP server identifier is no longer hardcoded to a specific parent app.** The default value of the constant exported from `src/agent_options.ts` is now the generic `appsec-internal` (was `sast-ai-app-internal` in v2.4.0–v2.4.1). The matching `buildMcpInternalToolNames()` helper now produces `mcp__appsec-internal__queryFindingsHistory` etc. by default, so `appsec-agent` ships as a parent-app-agnostic package out of the box. Counterpart to the v2.4.1 documentation cleanup, which only touched comments / README and missed the runtime constant — closes the genericization properly.
- **Genericized JSDoc on the runtime path.** Removed `sast-ai-app plan §8.17 / v6.0.0` references from `src/agent_options.ts`, `src/agent_actions.ts`, `bin/agent-run.ts`, the `pr_reviewer_mcp.e2e.test.ts` header, and the `agent-run.test.ts` describe block. Comments now consistently say "the parent app's per-scan MCP server" without naming a specific consumer.

### Added
- **`--mcp-server-name <name>` CLI flag (and `mcpServerName` parameter on the four role builders + `mcp_server_name?: string` on `AgentArgs`).** Override the MCP server identifier when registering `--mcp-server-url` with the SDK. Threads through to `Options.mcpServers[<name>]` and the SDK-namespaced tool names (`mcp__<name>__queryFindingsHistory` etc.) on each subagent's whitelist. Defaults to `DEFAULT_MCP_SERVER_NAME` (`appsec-internal`) when omitted; setting `--mcp-server-name` without `--mcp-server-url` warns and is otherwise a no-op.
- **`DEFAULT_MCP_SERVER_NAME` export** from `src/agent_options.ts` (string literal `appsec-internal`). The legacy `MCP_INTERNAL_SERVER_NAME` export is preserved as an alias of `DEFAULT_MCP_SERVER_NAME` so existing imports keep type-checking — but new code should read `DEFAULT_MCP_SERVER_NAME` and pass `mcpServerName` to override.
- **Tests.** Rewrote `src/__tests__/agent_options.mcp.test.ts` to assert (a) the new generic default flows through all four role builders; (b) the `mcpServerName` override propagates to both the `mcpServers` map key and the `mcp__<name>__*` tool prefix consistently; (c) the empty-URL fail-shape is preserved even when an override name is set. Added two new cases under `--mcp-server-name flag (v2.4.2)` in `src/__tests__/agent-run.test.ts` covering CLI plumbing into `args.mcp_server_name`.

### Migration (parent apps)
- **If you depend on the `mcp__sast-ai-app-internal__*` tool-name prefix** (e.g. you have prompt nudges, a counter family, or a server-side `MCP_SERVER_NAME` constant pinned to that string), pass `--mcp-server-name sast-ai-app-internal` when invoking `agent-run`. The agent's tool surface, prompt-nudge target, and SDK registration key all stay byte-for-byte stable.
- **If you don't care about the literal name** (the common case — the tool list is dynamic, you're only checking `result=ok|failed` on a counter that doesn't read the tool name as a label), no change is required. The flag's default identifier is generic and the rest of the wiring is unchanged.
- **No breaking change to the CLI surface.** `--mcp-server-url` keeps the v2.4.0 semantics. `--mcp-server-name` is purely additive.

### Why a hotfix
- v2.4.0 published with a parent-app-specific server name baked into the runtime path despite the package being intended as a shared agent. v2.4.1 cleaned up the docs but left the runtime constant in place — every consumer of `appsec-agent` was registering its MCP server under `sast-ai-app-internal` regardless of which parent app it was running under, polluting prompt nudges and any tool-name-keyed telemetry. v2.4.2 closes that gap without altering existing consumers (parent apps that *want* the old name pass it explicitly, parent apps that don't get a clean generic default).

## [2.4.0] - Unreleased

### Added
- **MCP server wiring for backend-backed live tools:** new `--mcp-server-url <url>` CLI flag plus per-role `mcpServerUrl?: string` parameter on `getDiffReviewerOptions` / `getCodeFixerOptions` / `getFindingValidatorOptions` / `getPrAdversaryOptions`. When the flag is set, the role builders attach an `Options.mcpServers` entry of type `http` and extend each subagent's `tools` whitelist with three SDK-namespaced tool names — `queryFindingsHistory`, `queryImportGraph`, `queryRuntimeEnrichment` — so the Claude Agent SDK routes those `tool_use` blocks to the parent app's per-scan in-process MCP server. The server name is intentionally fixed (rather than derived from the URL or environment) so prompt nudges and any cross-cutting `agent_tool_call{tool}` telemetry on the parent-app side reference stable, deterministic tool names.
- **Module-level exports `MCP_INTERNAL_SERVER_NAME`, `MCP_INTERNAL_TOOL_NAMES`, `buildMcpInternalToolNames()` from `agent_options.ts`:** single source of truth for the SDK-namespaced tool names, re-used by the test suite and available to downstream tooling that wants to assert on the agent's tool surface without hardcoding the prefix scheme.
- **Role-compatibility warning in `bin/agent-run.ts`:** `--mcp-server-url` is consumed by `pr_reviewer` / `code_reviewer` / `pr_adversary` / `finding_validator` / `code_fixer` only; other role combinations log a warning and ignore the flag (mirrors `--import-graph-context` / `--runtime-enrichment-context`).
- **Tests:** new unit suite `src/__tests__/agent_options.mcp.test.ts` (MCP server attachment per role, tool whitelist extension, no-op when URL omitted, server name + tool name invariants). Extended `src/__tests__/agent-run.test.ts` to verify `--mcp-server-url` parses into `args.mcp_server_url` and propagates through to `AgentActions`. New e2e suite `e2e/pr_reviewer_mcp.e2e.test.ts` (3 tests) exercises the full `main()` → `AgentActions` → role builder path with: (1) happy-path mcp-server-url propagation + Options shape + tools-whitelist invariant; (2) no-flag baseline (Options unchanged from v2.3.0); (3) role-gate (mcp-server-url ignored on a non-reviewer role).

### Why a coordinated release with the parent app
- Same cross-repo sequencing as v2.2.0 and v2.3.0: the **agent PR lands and publishes first**, then the parent-app PR merges pinning `appsec-agent@^2.4.0`. The parent-app wiring spins up an in-process MCP server per scan and passes its URL via `--mcp-server-url`; shipping the parent app first would degrade every diff-context scan with a flag the agent doesn't recognize (commander would error out before `main()` ran).

### Scope boundaries (explicitly deferred)
- **Per-tool authorization.** All three tools are added to every reasoning role's whitelist — there is no per-role tool subsetting. The model still has to explicitly decide to call them, and the parent app is expected to enforce a per-scan tool-call budget. A v2.5.x release can split the lists (e.g. `code_fixer` should not need `queryImportGraph`) once we have observability data on per-tool usefulness.
- **Stderr tool-call telemetry shim.** Any cross-cutting `agent_tool_call{tool, role, result, reason}` counter family lives on the parent-app side (it parses agent stderr / structured assistant-message blocks). The agent itself does not emit telemetry directly; this keeps v2.4.0 a pure wiring change with no new observability dependencies.
- **Removal of the front-loaded JSON paths.** `--import-graph-context` and `--runtime-enrichment-context` remain fully supported in v2.4.0 — they're the always-available fallback for scans where the MCP server is unreachable, and they let the parent app A/B-compare the live-tool path against the front-loaded path during a staged rollout.

## [2.3.0] - 2026-04-25

### Added
- **Runtime-enrichment context for `pr_reviewer`:** new `--runtime-enrichment-context <file.json>` CLI flag accepts a per-file production-incident summary from the parent app's runtime-enrichment service and injects it into the diff-review user prompt so the LLM can factor incident history into its severity + confidence calls. Shape: `{ default_branch_sha?, parsed_at?, files: [{ file, incident_count, last_seen_at? }], metadata? }` with a max of 500 files (matches the import-graph cap; the parent-app contract is expected to cap the source list at 10k rows but only files-overlapping-the-PR are passed in). Fail-open on any parse/IO error — the authoritative gate override is expected to live in the parent app (partition findings into hot/cold and apply `medium → low / 0.6 → 0.4` per file), so a bad payload only suppresses the LLM-side advisory hint.
- **Schema module `schemas/runtime_enrichment.ts`:** `parseRuntimeEnrichmentContext` (throws on structural errors; silently strips unknown extra fields as a PHI-minimization gate so a future buggy backend revision can't leak incident bodies / stack traces / request payloads to the LLM) + `formatRuntimeEnrichmentContextForPrompt` (compact markdown table, sorted by `incident_count` desc to anchor the LLM's attention on the strongest-signal files when the prompt is truncated; advisory line surfaces both halves of the transform — `medium → low` AND `0.6 → 0.4` — so the LLM and the post-LLM gate apply consistent thresholds) + `RuntimeEnrichmentContext` / `RuntimeEnrichmentFileEntry` types re-exported from the package entry.
- **Role/flag compatibility check in `bin/agent-run.ts`:** `--runtime-enrichment-context` only takes effect for `-r pr_reviewer --diff-context <file>`; other role combinations log a warning and ignore the flag (mirrors `--import-graph-context`).
- **Tests:** 16 unit tests in `src/__tests__/schemas/runtime_enrichment.test.ts` covering parse happy-path, last_seen_at inclusion + drop-on-empty/whitespace/non-string, fractional/negative count handling, the PHI-minimization invariant (extra fields silently dropped), metadata round-trip, structural error paths (non-object input, missing files array, 501-file cap, missing/empty/whitespace file string, non-numeric/NaN/Infinity count, non-object entries), and prompt formatter output (empty-list short-circuit, sort-order, transform numbers surfaced, SHA omitted when absent). Plus 3 e2e tests in `e2e/pr_reviewer_runtime_enrichment.e2e.test.ts` exercising the full `main()` path: happy-path injection, fail-open on bad payload, and empty-files short-circuit. Total tests: 410 → 432.

### Why a coordinated release with the parent app
- Same cross-repo sequencing as v2.2.0: the **agent PR lands and publishes first**, then the parent-app PR merges pinning `appsec-agent@^2.3.0`. The parent-app wiring writes a `.runtime-enrichment-context.json` file and passes its path via `--runtime-enrichment-context`; shipping the parent app first would degrade every diff-context scan with a flag the agent doesn't recognize (commander would error out before `main()` ran).

### Scope boundaries (explicitly deferred)
- A live MCP-tool variant of the runtime-enrichment lookup (agent calls `GET /api/projects/:id/hot-files` during a turn rather than consuming a pre-computed summary) remains out of scope for the same reason as the import-graph variant: the Claude Agent SDK doesn't expose a clean custom-tool channel for HTTP calls today; the v1.x `findings-history` pattern (parent-app-composed narrative injected via env/CLI) is the ready-today mechanism.
- Auto-population of the parent app's hot-file list from production logs remains a parent-app concern; this release accepts whatever the parent app emits.

## [2.2.0] - 2026-04-24

### Added
- **Import-graph context for `pr_reviewer`:** new `--import-graph-context <file.json>` CLI flag accepts a per-file reachability summary from the parent app's import-graph builder and injects it into the diff-review user prompt so the LLM can factor inbound-caller counts into its confidence calls. Shape: `{ default_branch_sha?, coverage?, files: [{ file, inbound_prod_import_count, callers?, is_entry_point?, graph_status? }] }` with a max of 500 files and 20 callers per file (caller lists are truncated beyond that for prompt-budget reasons). Fail-open on any parse/IO error — the authoritative confidence downrank is expected to live in the parent app, so a bad payload only suppresses the LLM-side hint.
- **Schema module `schemas/import_graph.ts`:** `parseImportGraphContext` (throws on structural errors) + `formatImportGraphContextForPrompt` (compact markdown table, only top-3 callers surfaced) + `ImportGraphContext` / `ImportGraphFileEntry` types re-exported from the package entry.
- **Role/flag compatibility check in `bin/agent-run.ts`:** `--import-graph-context` only takes effect for `-r pr_reviewer --diff-context <file>`; other role combinations log a warning and ignore the flag.
- **Tests:** 13 unit tests in `src/__tests__/schemas/import_graph.test.ts` covering parse happy-path, metadata round-trip, cap enforcement (500 files / 20 callers), structural error paths (non-object, missing files array, non-numeric count, unknown graph_status), and prompt formatter output (empty list short-circuit, caller truncation, coverage-banner toggle).

### Why a coordinated release with the parent app
- Same cross-repo sequencing as previous releases: the **agent PR lands and publishes first**, then the parent-app PR merges pinning `appsec-agent@^2.2.0`. The parent-app downrank logic and the import-graph injection both assume the agent can accept `--import-graph-context`; shipping them in the other order would degrade every diff-context scan until the agent updates.

### Scope boundaries (explicitly deferred to v2.3.0)
- A live MCP-tool variant of the import-graph lookup (agent calls `GET /api/internal/import-graph` during a turn rather than consuming a pre-computed summary) remains out of scope. The Claude Agent SDK doesn't expose a clean custom-tool channel for HTTP calls today; the existing `findings-history` pattern (parent-app-composed narrative injected via env/CLI) is the ready-today mechanism.

## [2.1.8] - 2026-04-23

### Added
- **`pr_adversary` role:** second pass over candidate PR findings. CLI: `--adversarial-context <file.json>` (required) with `{ "findings": [ { id, title, file, description, ... } ] }`; optional `-d/--diff-context` (truncated excerpt for grounding); output is always structured JSON (`adversarial_code_review_report.json` by default). Uses Read/Grep + `SECURITY_REPORT_SCHEMA`; empty `findings` writes an empty report without calling the model.
- **`--experiment-enabled`:** when set, appends stricter false-positive instructions for **`pr_reviewer`** diff mode and optional experiment variant for **`pr_adversary`** (the parent app is expected to gate this behind its own feature flag when passing the flag from the backend).
- **Exports:** `parseAdversarialPassContext`, `buildAdversarialUserPrompt`, `toSecurityFindings`, `emptySecurityReport`, `AdversarialPassContext` from package entry.
- **Tests:** unit tests for schema and options; `main` tests for `pr_adversary`; E2E under `e2e/pr_adversary.e2e.test.ts` (mocked LLM, full `main()` path).

## [2.1.7] - 2026-04-18

### Changed
- **`@anthropic-ai/claude-agent-sdk` pin tightened** from `^0.2.112` to exact `0.2.112`. The agent SDK's native-binary resolver is version-coupled to the bundled `claude` binary, so patch drift from a `^` range can silently change runtime behavior. Pin is now explicit; bumps require a package-level change.
- **`@anthropic-ai/claude-code` peer dependency removed.** Nothing in `appsec-agent` imports from `@anthropic-ai/claude-code`, and the agent SDK already ships the `claude` binary it spawns. Installing the standalone CLI globally was cosmetic at best and a version-drift foot‑gun at worst. Consumers who want the `claude` CLI on `PATH` for manual use can install it themselves.
- **README Step 1 rewritten** to remove the misleading `npm install -g @anthropic-ai/claude-code@2.0.58` instruction.

## [2.1.6] - 2026-04-15

### Added
- **Test coverage for `agent_actions.ts`**: 29 new tests covering `codeFixerWithOptions`, `qaVerifierWithOptions`, `contextExtractorWithOptions`, `findingValidatorWithOptions`, and `diffReviewerWithOptions` (including fallback report generation, `onResult` callback, `is_error` warning path, stream-event accumulation, verbose turn count, `tool_progress` logging, and `noTools` flag passthrough). Coverage rose from **34.31% → 87.99%** statements.
- **Test coverage for `schemas/context_extraction.ts`**: 12 new tests in `src/__tests__/context_extraction.test.ts` for `loadExtractionContext` (absolute/relative paths, `tree_summary` passthrough, missing file, owner/repo/files validation, malformed JSON) plus schema invariants. Coverage rose from **25% → 100%**.
- Total tests: 339 → 380.

### Changed
- **Refined `suggested_exclusions` guidance**: Both the context-extractor system prompt and the user prompt now instruct the agent to study the tree at ALL nesting depths and use specific paths (e.g., `backend/scripts/**`, `packages/*/resources/**`) rather than generic globs. Standard preset documentation expanded to include `coverage`, `__fixtures__`, `__mocks__`, `__snapshots__`, log/temp/runtime dirs, and IDE config dirs.
- **`@anthropic-ai/claude-agent-sdk`** bumped from `^0.2.74` to `^0.2.112`.
- **`@anthropic-ai/claude-code`** peer dependency bumped from `2.1.74` to `2.1.112`.
- `.gitignore` now excludes the `/docs/` folder (internal-only documentation).
- Version bump to 2.1.6.

## [2.1.5] - 2026-04-15

### Added
- **`suggested_exclusions` field in context extraction**: New `suggested_exclusions` string on `ExtractionResult` for the context extractor to recommend project-specific glob patterns that should be excluded from security scans. Only suggests patterns not already covered by the standard preset (node_modules, vendor, dist, tests, etc.). Added to schema, system prompt, and user prompt with detailed guidance.
- **`tree_summary` support in `ExtractionContext`**: Optional `tree_summary` field on `ExtractionContext` is now rendered as a "Repository Tree Structure" section in the context extractor prompt, giving the agent visibility into the full directory layout for better exclusion analysis.
- **Tests for `suggested_exclusions`**: Two new tests verifying the schema includes `suggested_exclusions` as a required field and the default system prompt references it.

### Changed
- Version bump to 2.1.5.

## [2.1.4] - 2026-04-14

### Added
- **`fix_options` field in SecurityFinding schema**: New `fix_options` array on findings for cases where a direct code fix requires architectural decisions or domain-specific knowledge. Each option has an `id`, `title`, and `description`. Complements the existing `fixed_code` field — a finding should provide one or the other, not both.
- **`FixOption` TypeScript interface**: Exported from `src/schemas/security_report.ts`.

### Changed
- **System prompt guidance for `fixed_code` vs `fix_options`**: When output format is JSON, the code reviewer and diff reviewer system prompts now include explicit instructions distinguishing executable `fixed_code` (compilable drop-in replacement) from structured `fix_options` (multiple remediation approaches). Prevents non-code content from being placed in `fixed_code`.
- **`fixed_code` schema description tightened**: Updated to clarify it must be executable, compilable code — not comments or recommendations.
- Version bump to 2.1.4.

## [2.1.2] - 2026-04-02

### Fixed
- **Fallback report when structured output is missing**: When the Claude Agent SDK completes successfully but doesn't return `structured_output`, the agent now generates an empty fallback report (with zeroed severity counts and an explanatory summary) instead of returning nothing. This prevents "No report generated" errors in downstream consumers.
  - Tracks successful API runs via `hadSuccessfulRun` and `apiCostUsd` from the result message.
  - Applies to both `codeReviewerWithOptions` (Full Code Review) and `diffReviewerWithOptions` (PR Diff Review) when `--output-format json` is active.
- Version bump to 2.1.2.

## [2.1.1] - 2026-03-13

### Added
- **Comprehensive test coverage for `--no-tools` mode**: 9 new tests in `agent_options.test.ts` covering the `noTools` parameter for `getDiffReviewerOptions` — tool restriction (`Write`-only vs `Read`/`Grep`/`Write`), focused-context prompt vs tool-verification prompt, `srcDir` appending, `maxTurns` passthrough, JSON schema output with `noTools`, and config override behavior. Total tests: 326 across 14 suites.
- Version bump to 2.1.1.

## [2.1.0] - 2026-03-13

### Added
- **`--no-tools` CLI flag**: Disables Read/Grep tools for the PR diff reviewer, enabling single-turn focused-context analysis mode. When combined with `--diff-context`, this is the fastest review mode — the agent produces a complete report directly from the provided diff context without making tool calls.
- **Agent stats logging**: The diff reviewer now logs turn count, wall-clock duration, and API time at the end of each run (e.g., `[Agent Stats] turns=1, duration=12s, api_time=10s`).
- **Verbose turn/tool progress logging**: When `--verbose` is enabled, the diff reviewer logs `[Turn N]` markers and `[Tool Progress]` events with tool names and elapsed time.

### Changed
- **No-tools system prompt for diff reviewer**: When `--no-tools` is active, uses a streamlined prompt that instructs the agent to produce a complete review directly from the provided diff context (imports, function signatures, surrounding code) without searching the codebase.
- **Diff reviewer tool list**: With `--no-tools`, the agent only has access to the `Write` tool (for report output); otherwise uses `Read`, `Grep`, and `Write` as before.
- `diffReviewerWithOptions()` and `getDiffReviewerOptions()` now accept a `noTools` parameter.
- `no_tools` passed through from CLI args to `main()` for both single-file and batched PR review paths.
- Version bump to 2.1.0.

## [2.0.1] - 2026-03-13

### Changed
- **Flexible `--model` validation**: The `-m`/`--model` CLI flag now accepts three formats: family aliases (`sonnet`, `opus`, `haiku`), full SDK model IDs (`claude-sonnet-4-6`), and version prefixes (`sonnet-4-6`). Input is normalized to lowercase before validation and passed through to the SDK.
- Version bump to 2.0.1.

## [2.0.0] - 2026-03-13

### Added
- **Context Extractor agent (`context_extractor`)**: New agent role that analyzes repository metadata and files to extract structured project intelligence for improving SAST accuracy. Receives repo metadata and file contents via `--extract-context <file>` and returns a structured JSON report with `project_summary`, `security_context`, `deployment_context`, and `developer_context`.
  - New `ExtractionContext` / `ContextExtractionOutput` TypeScript interfaces and `CONTEXT_EXTRACTION_SCHEMA` JSON schema in `src/schemas/context_extraction.ts`.
  - New `getContextExtractorOptions()` in `AgentOptions`: configures the `context-extractor` agent with no tools (pure analysis), `maxTurns: 1`, and JSON schema output enforcement.
  - New `contextExtractorWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadExtractionContext()` in `src/schemas/context_extraction.ts`: reads/validates extraction context JSON with required field checks.
  - New `buildContextExtractorPrompt()` in `main.ts`: builds a detailed prompt with repo metadata, file contents, and analysis instructions.
  - New `--extract-context <file>` CLI option in `agent-run`.
  - `context_extractor` role configuration added to `conf/appsec_agent.yaml`.
  - 4 new tests in `agent_options.test.ts` covering agent config, default/custom system prompts, and JSON schema enforcement. Total tests: 317 across 14 suites.

## [1.9.0] - 2026-03-12

### Added
- **`--max-turns <n>` CLI option**: Allows overriding the per-role default `maxTurns` (agent tool-use iterations) from the command line. New `max_turns` field in `AgentArgs`.
- **Per-role `maxTurns` defaults**: Each agent role now has a tuned default turn budget — `code_reviewer`: 30, `threat_modeler`: 20, `qa_verifier`: 15, `diff_reviewer` (PR reviewer): 10, `code_fixer`: 10, `finding_validator`: 5. Configurable via `max_turns` in YAML or `--max-turns` CLI flag.
- **`Grep` tool for diff reviewer**: The PR reviewer (`diff-reviewer`) agent now has access to the `Grep` tool alongside `Read` and `Write`, enabling codebase-wide pattern searches to verify findings before reporting.

### Changed
- **Enhanced diff reviewer system prompt**: Rewrote the PR reviewer prompt to actively reduce false positives. The agent is now instructed to verify findings by searching for sanitization functions, middleware, validation logic, ORM usage, and security configurations before reporting issues. Includes a confidence rating (`high`/`medium`/`low`) requirement for each finding.
- **"Project Intelligence" context section**: Renamed "Additional Context" to "Project Intelligence" in code reviewer prompts, with explicit instructions to use developer-provided context to eliminate false positives — while trusting code evidence over stated practices when they conflict.
- **YAML config**: Replaced `pr_reviewer.system_prompt` with `diff_reviewer_system_prompt: null` to use the enhanced hardcoded prompt by default.
- Version bump to 1.9.0.

## [1.8.4] - 2026-03-12

### Changed
- **Flatten `RETEST_VERDICT_SCHEMA`**: Removed the `name`/`strict`/`schema` wrapper from `RETEST_VERDICT_SCHEMA` in `src/schemas/finding_validator.ts`, aligning it with the flat `Record<string, unknown>` pattern used by the other schemas (`SECURITY_REPORT_SCHEMA`, `THREAT_MODEL_REPORT_SCHEMA`, `FIX_OUTPUT_SCHEMA`).
- Updated tests in `finding_validator.test.ts` and `agent_options.test.ts` to match the new flat schema structure.
- Version bump to 1.8.4.

## [1.8.3] - 2026-03-12

### Added
- **Finding Validator agent (`finding_validator`)**: New agent role that validates whether a previously detected security vulnerability is still present in code. Receives a finding with code snippet via `--retest-context <file>` and returns a structured JSON verdict (`RetestVerdict`) with `still_present`, `confidence`, `reasoning`, and `current_line`.
  - New `RetestContext` / `RetestContextFinding` / `RetestVerdict` TypeScript interfaces and `RETEST_VERDICT_SCHEMA` JSON schema in `src/schemas/finding_validator.ts`.
  - New `getFindingValidatorOptions()` in `AgentOptions`: configures the `finding-validator` agent with `Read`/`Grep` tools and JSON schema output enforcement.
  - New `findingValidatorWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadRetestContext()` in `src/schemas/finding_validator.ts`: reads/validates retest context JSON with required field checks.
  - New `buildFindingValidatorPrompt()` in `main.ts`: builds a prompt with finding metadata, code snippet, and analysis instructions.
  - New `--retest-context <file>` CLI option in `agent-run`.
  - `finding_validator` role configuration added to `conf/appsec_agent.yaml`.
  - Public exports for `RetestContext`, `RetestContextFinding`, `RetestVerdict`, and `RETEST_VERDICT_SCHEMA` from the package index.
- **Comprehensive test coverage for finding validator**: 16 tests in `finding_validator.test.ts` (context loading, validation branches, schema structure), 6 tests in `agent_options.test.ts` (agent config, default prompt, srcDir, JSON schema, model), 5 tests in `main.test.ts` (missing context error, full run, prompt content, src_dir passthrough, null field handling). Total tests: 313 across 14 suites.

### Changed
- Version bump to 1.8.3.

## [1.8.2] - 2026-03-11

### Changed
- **Default model changed to opus**: The default Claude model is now `opus` instead of `sonnet` for all agent roles. Users can still override with `-m sonnet` or `-m haiku` via the CLI.
- Version bump to 1.8.2.

## [1.8.1] - 2026-03-02

### Added
- **Test coverage for Bash tool**: 20 new tests in `bash_tool.test.ts` covering tool definition, safe command execution, working directory isolation, environment variables, all dangerous pattern blocks (rm -rf, sudo, eval, curl|sh, etc.), error handling, timeout enforcement, and output truncation.
- **Test coverage for QA context**: 18 new tests in `qa_context.test.ts` covering `loadQaContext` validation (missing/invalid `pr_url`, missing/invalid `test_command`, default coercion for `timeout_seconds` and `block_on_failure`, optional fields, invalid JSON, path resolution) and `QA_VERDICT_SCHEMA` structure.
- **Test coverage for getDiffReviewerOptions**: 7 new tests covering agent config, source directory injection, JSON schema enforcement, markdown mode, config override via `diff_reviewer_system_prompt`, and defaults.
- **Test coverage for getQaVerifierOptions**: 6 new tests covering agent config with structured output, default prompt, source directory injection, null srcDir, JSON schema enforcement, and model selection.

### Changed
- Version bump to 1.8.1.
- Total tests: 286 (up from 235). Test suites: 13 (up from 11).
- Coverage improvements: `bash_tool.ts` 0% → 100% stmts, `qa_context.ts` 72% → 100% stmts, `agent_options.ts` 66% → 93% stmts. All schemas at 100%.

## [1.8.0] - 2026-03-02

### Added
- **QA Verifier agent (`qa_verifier`)**: New agent role that verifies security fixes by running the project's test suite and analyzing results. Receives test configuration via `--qa-context <file>` and returns a structured JSON verdict (`QaVerdict`) with pass/fail status, exit code, failure descriptions, logs, analysis, and actionable suggestions.
  - New `QaContext` / `QaVerdict` TypeScript interfaces and `QA_VERDICT_SCHEMA` JSON schema in `src/schemas/qa_context.ts`.
  - New `getQaVerifierOptions()` in `AgentOptions`: configures the `qa-verifier` agent with `Read`, `Grep`, and `Bash` tools and JSON schema output enforcement.
  - New `qaVerifierWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadQaContext()` in `src/schemas/qa_context.ts`: reads/validates QA context JSON with required field checks and defaults.
  - New `buildQaVerifierPrompt()` in `main.ts`: builds a prompt with PR URL, test configuration, deployment context, environment variables, and step-by-step instructions.
  - New `--qa-context <file>` CLI option in `agent-run`.
  - `qa_verifier` role configuration added to `conf/appsec_agent.yaml`.
- **Restricted Bash tool (`src/tools/bash_tool.ts`)**: Controlled shell access for the QA verifier agent with command validation (blocks dangerous patterns like `rm -rf /`, `sudo`, `eval`), timeout enforcement, working directory isolation, and output size limits.
- **Companion test generation for code fixer**: `FixContext` now supports an optional `generate_companion_test` flag. When true, the code fixer prompt includes instructions to generate a companion unit test verifying the fix. `FixOutput` schema extended with optional `test_code`, `test_file`, and `test_framework` fields.
- **New tests**: 5 new QA verifier tests in `main.test.ts` (missing qa-context error, full run, deployment context, test configuration in prompt, src_dir passthrough). Total tests: 235.

### Changed
- Version bump to 1.8.0.

## [1.7.1] - 2026-03-02

### Added
- **Deployment context for threat modeler**: The `threat_modeler` role now accepts `-c/--context` to provide deployment and environment information (e.g., cloud provider, compliance requirements). Context is injected into both JSON and non-JSON prompts so the model can tailor threats, attack vectors, and risk assessments to the actual deployment environment.
- **Deployment context for code fixer**: `FixContext` now supports an optional `deployment_context` field. When present, the code fixer prompt includes a "Deployment & Environment Context" section so fixes consider environment-specific security practices.
- **New tests**: 5 new tests covering context injection for threat modeler (JSON and non-JSON modes, absence case) and code fixer (presence and absence of `deployment_context`).

### Changed
- Version bump to 1.7.1.

## [1.7.0] - 2026-03-02

### Added
- **Code Fixer agent (`code_fixer`)**: New agent role that generates precise, minimal security fixes for code vulnerabilities. Receives a finding with full code context via `--fix-context <file>` and returns a structured JSON fix (`FixOutput`) with `fixed_code`, `start_line`, `end_line`, `explanation`, `confidence`, and `breaking_changes`.
  - New `FixContext` / `FixOutput` TypeScript interfaces and `FIX_OUTPUT_SCHEMA` JSON schema in `src/schemas/security_fix.ts`.
  - New `getCodeFixerOptions()` in `AgentOptions`: configures the `code-fixer` agent with `Read`/`Grep` tools and always-on JSON schema output enforcement.
  - New `codeFixerWithOptions()` in `AgentActions`: runs the LLM query, collects structured output, and reports cost.
  - New `loadFixContext()` and `buildCodeFixerPrompt()` in `main.ts`: reads/validates fix context JSON, builds a detailed prompt including finding metadata, code context, indentation rules, line number constraints, and retry support for failed validations.
  - New `--fix-context <file>` CLI option in `agent-run`.
  - `code_fixer` role configuration added to `conf/appsec_agent.yaml`.
  - Public exports for `FixContext`, `FixContextFinding`, `FixContextCodeContext`, `FixOutput`, and `FIX_OUTPUT_SCHEMA` from the package index.
- **Retry support for code fixer**: When a previous fix fails validation, the caller can pass `previous_fix_code` and `validation_errors` in the fix context; the prompt includes a retry section so the model corrects its output.
- **Comprehensive test coverage for code fixer**: 5 new tests in `main.test.ts` (missing fix-context error, full run, prompt content, src_dir passthrough, retry context) and 4 new tests in `agent_options.test.ts` (agent config, default prompt, src_dir in prompt, JSON schema enforcement). Total tests: 225.

### Changed
- Version bump to 1.7.0.

## [1.6.1] - 2026-02-28

### Changed
- **Enable PR diff chunking for `code_reviewer`**: Added `diff_review_max_tokens_per_batch`, `diff_review_max_batches`, and `diff_review_max_files` to `code_reviewer` config, matching `pr_reviewer` defaults (150K tokens/batch, 3 batches, 80 files). Previously `code_reviewer` with `--diff-context` had no chunking, limiting it to a single context window.
- Version bump to 1.6.1.

## [1.6.0] - 2026-02-28

### Added
- **Structured JSON output for threat modeler**: When using `--output-format json`, the threat modeler now enforces a JSON schema (`THREAT_MODEL_REPORT_SCHEMA`) so model output conforms to a defined structure covering Data Flow Diagram (nodes, flows, trust boundaries), STRIDE threat model, and risk registry. Schema and TypeScript types live in `src/schemas/threat_model_report.ts`.
- **Threat model report schema exports**: New public exports for `DFDNode`, `DFDDataFlow`, `DFDTrustBoundary`, `Threat`, `Risk`, `ThreatModelReport`, and `THREAT_MODEL_REPORT_SCHEMA` from the package index.

### Changed
- **Threat modeler agent refactor**: `threatModelerAgentWithOptions` now returns the structured JSON string (instead of empty string) when structured output is available. `main.ts` writes the schema-constrained result to the output file, matching the pattern used by the code reviewer.
- **Threat modeler prompt split**: JSON mode uses a structured analysis prompt (no file writes by the model); non-JSON mode preserves the original ASCII DFD + file-writing behavior.
- **`getThreatModelerOptions` accepts `outputFormat`**: When format is JSON, tools are restricted to read-only (`Read`, `Grep`) and `outputFormat` is set with the threat model schema.
- Removed redundant comments from `agent_actions.ts`.
- Version bump to 1.6.0.

## [1.4.0] - 2026-02-25

### Changed
- **Flatten SecurityFinding schema**: Replaced nested `affected_files` array and complex `remediation` object with flat `file`, `line_numbers`, and `recommendation` fields for simpler report structure.
- **New finding fields**: Added `confidence` (HIGH/MEDIUM/LOW), `code_snippet`, `fixed_code`, `cwe`, and `owasp` fields for richer finding metadata.
- Version bump to 1.4.0.

## [1.3.5] - 2026-02-23

### Fixed
- **JSON report schema conformance**: When output format is JSON, the prompt now instructs the model to provide the report as a structured response (follow the required schema) and not to write the file; the system writes the schema-constrained `structured_output` to the report file. This ensures the root `security_review_report` wrapper and full schema compliance. Applied to both code reviewer and PR diff reviewer (single and batched). When `structuredResult` is present, it is always written to the output file (overwriting any file the model may have written via the Write tool).
- **Version and author in `agent-run -v`**: `getProjectRoot()` now locates the directory containing `package.json` by walking up from `__dirname`, so version and author display correctly when running the compiled CLI (e.g. `node dist/bin/agent-run.js -v` or after `npm install`).

## [1.3.4] - 2026-02-23

### Fixed
- **Write structured output to report file**: `codeReviewerWithOptions` and `diffReviewerWithOptions` now return the structured JSON string. `main.ts` writes it to the output file (e.g., `code_review_report.json`) if Claude didn't use the Write tool. With `outputFormat: { type: 'json_schema' }`, Claude produces the report as `structured_output` on the SDK result and may skip the Write tool entirely. The caller (`main.ts`) knows the correct output path and writes the file, so downstream consumers find it as expected.

## [1.3.3] - 2026-02-23

### Fixed
- **Write structured output to report file** (incomplete): Attempted to write via `this.args.output_file` in `agent_actions.ts`, but the backend doesn't pass `-o` to the CLI, so `output_file` was always undefined. Superseded by v1.3.4.

## [1.3.2] - 2026-02-23

### Fixed
- **Structured output extraction**: When using JSON schema output format (`-f json`), the agent now correctly extracts `structured_output` from the result message. Previously, the structured JSON was returned in `result.structured_output` per Claude SDK spec, but the code only captured conversational text from `assistant.message.content`, causing "No report generated" errors in downstream parsers.

## [1.3.1] - 2026-02-23

### Changed
- Release patch for JSON schema enforcement feature
- Schema enforces `affected_files[].lines` as string format (e.g., `"8-10"`) for compatibility with downstream report parsers

## [1.3.0] - 2026-02-12

### Added
- **Structured JSON output for security reports**: When using `--output-format json`, code reviewer and PR diff reviewer now enforce a JSON schema so model output conforms to a defined structure (metadata, executive_summary, findings with severity/category/affected_files/remediation, etc.). Ensures compatibility with downstream report parsers. Schema and TypeScript types live in `src/schemas/security_report.ts`.

## [1.2.1] - 2026-02-12

### Changed
- **Claude Agent SDK**: Upgraded to `@anthropic-ai/claude-agent-sdk@^0.2.39` (parity with Claude Code 2.1.39); peer `@anthropic-ai/claude-code` set to `2.1.39`
- **Dependencies**: Added `zod@^4.0.0` for SDK peer; added `.npmrc` with `legacy-peer-deps=true` to resolve openai optional peer conflict

## [1.2.0] - 2026-02-11

### Added
- **PR diff chunking**: For large PRs that exceed the model context limit, the agent can split the diff into batches, review each batch, and merge reports into a single output file.
  - Config: `diff_review_max_tokens_per_batch`, `diff_review_max_batches`, `diff_review_max_files`, `diff_review_exclude_paths` under **`pr_reviewer.options`** (chunking is **on by default** for `pr_reviewer` when using `-d/--diff-context`). For `code_reviewer`, chunking is off unless set in config or CLI.
  - CLI: `--diff-max-tokens`, `--diff-max-batches`, `--diff-max-files`, `--diff-exclude` (repeatable). Bounded by `max_batches` (e.g. 3) so PR mode does not become a full-repo review.
  - Cost tracking: per-batch and total API cost are logged and (for JSON) included in merged report `meta.total_cost_usd`.
  - New modules: `src/diff_chunking.ts` (token estimation, filtering, batching), `src/diff_report_merge.ts` (merge JSON/Markdown batch reports). Main orchestrates only; feature can be reworked or disabled via config.
  - Merged report may include a **Skipped** section when files are excluded or the batch limit is reached.

## [1.1.0] - 2026-02-11

### Added
- **OpenAI fallback write tool**: When using OpenAI failover (e.g. code review with `-F`), the model can now write the report to a file via a `write_file` tool, matching Anthropic behavior. Tool definition and execution live in `src/openai_tools.ts` for easy maintenance. Writes are restricted to the current working directory via existing path validation.

## [1.0.5] - 2026-02-11

### Added
- **pr_reviewer role**: New role listed in `agent-run -l` for PR-focused security review. Use `-r pr_reviewer` with `-d/--diff-context <file>` for PR diff mode, or without `-d` for full-repo review with PR-focused prompt. Main and CLI treat `pr_reviewer` like `code_reviewer` for routing and diff-context warning.

## [1.0.4] - 2026-02-11

### Added
- **Cost display in failover mode**: When using OpenAI fallback (e.g. simple query with `-F`), the end-of-turn cost is now shown. The adapter requests `stream_options: { include_usage: true }`, captures token usage from the stream, estimates USD from a per-model table (gpt-4o, gpt-4o-mini, etc.), and sets `total_cost_usd` on the result message.

## [1.0.3] - 2026-02-11

### Fixed
- **Failover when primary returns error result**: When Anthropic yields a result with `is_error: true` (e.g. invalid API key) instead of throwing, the adapter now treats it as failure and runs OpenAI fallback when enabled, without yielding the primary error message first. The caller now only sees the fallback response.

## [1.0.2] - 2026-02-11

### Added
- **Short options for failover**: `-F` for `--failover`, `-K` for `--openai-api-key`
- **OpenAI base URL CLI option**: `-U, --openai-base-url <url>` to override OPENAI_BASE_URL (for custom/partner endpoints when failover is enabled)

## [1.0.1] - 2026-02-11

### Added
- **Test coverage for LLM failover**: New tests for `llm_query` adapter
  - Default system prompt when options have no systemPrompt and no valid agents
  - OPENAI_BASE_URL passed to OpenAI client when set in env
- **Test coverage for failover CLI**: New tests for agent-run CLI
  - FAILOVER_ENABLED set when `--failover` is provided (true/false)
  - OPENAI_API_KEY set when `--openai-api-key` is provided
  - Both options applied when both are provided

## [0.3.7] - 2026-02-10

### Added
- **Model Selection CLI Option**: New `-m/--model` CLI option to select Claude model
  - Supports `sonnet` (default), `opus`, and `haiku` models
  - Allows users to choose between speed, cost, and capability trade-offs
  - Validation ensures only valid model names are accepted
  - Model selection applies to all agent roles (code_reviewer, threat_modeler, diff_reviewer)

## [0.3.6] - 2026-01-21

### Fixed
- **Build Script**: Added execute permission (`chmod +x`) to CLI script in build process
  - Fixes "permission denied" errors when running `agent-run` after npm install

### Changed
- **SDK Version**: Bumped `@anthropic-ai/claude-agent-sdk` from `^0.1.58` to `^0.1.76`

## [0.3.5] - 2026-01-21

### Added
- **PR Diff Context Mode**: New `-d/--diff-context` CLI option for code_reviewer role
  - Enables focused security review of Pull Request changes only
  - Significantly reduces token usage by analyzing only changed code
  - Supports JSON file input with PR metadata, file changes, and diff hunks
  - Includes `DiffContext`, `DiffContextFile`, and `DiffHunk` TypeScript interfaces
  - New `formatDiffContextForPrompt()` function to format diff context for AI analysis
  - New `getDiffReviewerOptions()` method in AgentOptions for diff-focused reviews
  - New `diffReviewerWithOptions()` method in AgentActions for PR-focused code review
- **Input File Path Validation**: New `validateInputFilePath()` function
  - Validates input file paths for security concerns
  - Allows absolute paths while validating relative paths for directory traversal
  - Prevents null bytes and control characters in paths
- **Comprehensive Test Coverage**: 67 new tests (120 → 187 total)
  - 51 tests for `validateDiffContext` covering all field types and edge cases
  - 9 tests for `validateInputFilePath` covering path validation scenarios
  - 7 tests for diff context code review flow in main.ts

### Changed
- **Enhanced `validateDiffContext`**: Stricter validation for diff context JSON
  - Required string fields now reject empty strings
  - Line numbers (`startLine`, `endLine`) must be non-negative
  - Added validation that `startLine <= endLine`
  - Optional fields (`imports`, `beforeContext`, `afterContext`, `containingFunction`, `previousFilename`, `deploymentContext`) now validated for correct types
  - `fullFileAvailable` validated as boolean when present

### Fixed
- **Silent Ignore of `--diff-context`**: Now displays warning when `--diff-context` is used without `code_reviewer` role
  - Previously the option was silently ignored with other roles
  - Now warns users and suggests using `-r code_reviewer`
- **Diff Context Validation Error Handling**: Fixed error handling in `loadDiffContext()`
  - Validation errors no longer get caught by JSON parsing try-catch block
  - Proper error messages displayed for invalid diff context format

## [0.3.0] - 2025-12-22

### Added
- **Context Parameter for Code Reviews**: New `-c/--context` CLI option for code_reviewer role
  - Allows users to provide deployment and environment context for more targeted security analysis
  - Supports describing deployment type (AWS Lambda, Kubernetes, Docker, etc.)
  - Supports specifying compliance requirements (SOC2, HIPAA, PCI-DSS, GDPR)
  - Supports describing data sensitivity (PII, PHI, payment data)
  - Context is injected into the user prompt to help the agent focus on environment-specific vulnerabilities
  - Fully backward compatible - context is optional

### Changed
- **Enhanced Code Review Prompts**: Code reviewer now generates more comprehensive prompts
  - When context is provided, prompts include guidance to focus on environment-specific issues
  - Prompts encourage consideration of infrastructure mitigations and threat models

## [0.2.1] - 2025-12-18

### Added
- **Multiple Output Formats**: Support for additional output formats beyond markdown
  - Added `json`, `xml`, `csv`, and `xlsx` format options via `-f/--output_format` flag
  - New `getExtensionForFormat()` utility function to map formats to file extensions
  - New `FORMAT_TO_EXTENSION` mapping for extensible format support

### Changed
- **Dynamic Output File Naming**: Output files now default based on role and format
  - `code_reviewer` defaults to `code_review_report.<ext>` where `<ext>` matches the output format
  - `threat_modeler` defaults to `threat_model_report.<ext>` where `<ext>` matches the output format
  - Removed hardcoded `.md` extension default from `-o/--output_file` option
- **CLI Help Text**: Updated to show all available output formats (markdown, json, xml, csv, xlsx)

## [0.1.0] - 2025-12-10

### Added
- **simple_query_agent**: Added `--src_dir` command line argument support
  - Allows copying source code directories to a hidden folder for agent context
  - Agent can search and read files within the copied directory to answer questions
  - Automatically cleans up temporary directory when user exits
  - Works similarly to `code_reviewer` role's `--src_dir` functionality
  - Updated CLI help text to indicate `--src_dir` works with both `simple_query_agent` and `code_reviewer`

### Changed
- **Path Validation**: Enhanced `validateDirectoryPath()` to allow relative paths with directory traversal sequences
  - Relative paths like `../some-app/backend/` are now allowed and get resolved to absolute paths
  - Maintains security by resolving paths before validation
  - Updated `copyProjectSrcDir()` to handle relative paths properly
- **Documentation**: Updated README with `--src_dir` usage examples for `simple_query_agent`

## [0.0.8] - 2025-12-10

### Added
- Peer dependency `@anthropic-ai/claude-code@2.0.58` for compatibility with Claude Code integration
- Update claude-agent-sdk to latest stable version 0.1.58

## [0.0.6] - 2025-11-24

### Added
- **Thread-Safety for Web Applications**: Comprehensive improvements for safe concurrent usage
  - `getToolUsageLog()` method in `AgentOptions` to provide read-only access to tool usage logs
  - `clearToolUsageLog()` method in `AgentOptions` to clear logs between requests
  - Comprehensive concurrency test suite (11 new tests) covering:
    - Conversation history isolation across multiple instances
    - Tool usage log isolation
    - Concurrent file operations
    - Race condition prevention
    - Memory leak prevention
- **Documentation**: Added "Web Application Usage" section to README with best practices and code examples

### Changed
- **Thread-Safety**: Made `toolUsageLog` private in `AgentOptions` class
  - Changed from `public toolUsageLog` to `private toolUsageLog` to prevent external mutation
  - Added `getToolUsageLog()` method that returns a copy for safe read-only access
  - Added `clearToolUsageLog()` method for clearing logs between requests
- **Thread-Safety**: Enhanced `validateOutputFilePath()` function
  - Removed default parameter `baseDir: string = process.cwd()` to require explicit working directory
  - Prevents race conditions from concurrent `process.cwd()` calls in web applications
  - Updated all call sites to pass working directory explicitly
- **Thread-Safety**: Improved `main()` function
  - Captures `process.cwd()` once at the start of the function
  - Passes captured working directory to all file operations
  - Eliminates race conditions from concurrent directory changes
- **Testing**: Enhanced test suite with comprehensive concurrency tests
  - All console output suppressed in concurrency tests for cleaner test output
  - Tests verify isolation of conversation history and tool usage logs
  - Tests verify safe concurrent file operations
  - Tests verify race condition prevention

### Fixed
- **Thread-Safety**: Fixed potential race conditions in concurrent web application usage
  - Previously, multiple concurrent requests could interfere with each other's working directory
  - Now captures working directory once per request to prevent race conditions
- **Thread-Safety**: Fixed tool usage log accumulation in web applications
  - Previously, `toolUsageLog` was public and could accumulate unbounded data
  - Now private with controlled access and clear method for memory management

## [0.0.4] - 2025-11-13

### Added
- Command-line arguments `-k/--anthropic-api-key` and `-u/--anthropic-base-url` to pass Anthropic API credentials via the command line
- Tests for CLI environment variable handling
- **Security**: Comprehensive security validation utilities
  - `isSafePath()` function to detect dangerous path patterns (directory traversal, null bytes, control characters)
  - `validateAndSanitizePath()` function to normalize and validate file paths against base directories
  - `validateDirectoryPath()` function to validate source directory inputs
  - `validateOutputFilePath()` function to ensure output files are written only within intended directories
  - Path validation for all user-provided file and directory inputs
  - Command injection protection in `runCommand()` function with pattern detection and timeout limits
  - API key security warnings when credentials are passed via command-line arguments
- **Security Tests**: 26 new test cases covering all security validation functions
  - Path traversal attack prevention tests
  - Command injection detection tests
  - Input validation edge case tests
  - Directory and file path security tests

### Changed
- **simple_query_agent**: 
  - Added conversation history tracking to maintain context across multiple queries
  - Implemented continuous conversation loop with `/end` command to exit
  - Improved stream event handling to properly process all messages including tool results
  - Fixed cost display timing to only show after stream completely finishes (including tool execution)
  - Enhanced assistant message processing to handle content that arrives after tools complete
  - Added proper stdout flushing to ensure all streaming output is displayed before showing cost and next prompt
- **Security**: Enhanced `copyProjectSrcDir()` function with comprehensive path validation
  - Validates source directory paths to prevent directory traversal attacks
  - Ensures temporary directories are created only within the working directory
  - Sanitizes directory names to prevent path injection
  - Improved error handling with clear security-focused error messages
- **Security**: Enhanced `runCommand()` function with security hardening
  - Added validation to detect command injection patterns (`;`, `&`, `|`, backticks, etc.)
  - Added timeout protection (30 second default)
  - Added max buffer limit (1MB default) to prevent resource exhaustion
  - Improved error messages for security violations
- **Security**: Added input validation in `main()` function
  - Validates `src_dir` parameter before use in code_reviewer and threat_modeler roles
  - Validates `output_file` parameter to prevent writing outside intended directories
  - Ensures all file operations are restricted to safe paths
- **Security**: Improved temporary file cleanup
  - Added cleanup for temporary directories in code_reviewer role
  - Enhanced error handling for cleanup operations in threat_modeler role
  - Better resource management to prevent temporary file accumulation

### Security
- **Fixed**: Path traversal vulnerability in `copyProjectSrcDir()` function
  - Previously allowed directory traversal sequences that could access files outside intended directories
  - Now validates and sanitizes all paths before file operations
- **Fixed**: Command injection risk in `runCommand()` function
  - Previously executed commands without validation
  - Now validates commands for dangerous patterns before execution
- **Fixed**: Unvalidated file path inputs
  - Previously used user-provided paths without validation
  - Now validates all file and directory paths before use
- **Fixed**: Output file path security
  - Previously allowed writing files outside the working directory
  - Now restricts all output files to the current working directory
- **Improved**: API key security awareness
  - Added warnings when API keys are passed via command-line (visible in process lists)
  - Recommends using environment variables for better security

## [0.0.2] - 2024-11-10

### Added
- Initial publishing of the AppSec Agent TypeScript package
- Support for multiple agent types: simple query agent, code review agent, and threat modeler
- Tool permission management with advanced callbacks and bypass mode
- Code review capabilities for automated security and privacy issue detection
- Threat modeling with STRIDE methodology and Data Flow Diagrams (DFD)
- Command-line interface (`agent-run`) for running agents
- Configuration support via YAML files and environment variables
- Comprehensive test suite


## [0.0.1] - 2024-11-04

### Added
- Initial project setup
- Core agent architecture and infrastructure
- Basic agent interaction capabilities

[Unreleased]: https://github.com/yourusername/appsec-agent/compare/v0.3.5...HEAD
[0.3.5]: https://github.com/yourusername/appsec-agent/compare/v0.3.0...v0.3.5
[0.3.0]: https://github.com/yourusername/appsec-agent/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/yourusername/appsec-agent/compare/v0.1.0...v0.2.1
[0.1.0]: https://github.com/yourusername/appsec-agent/compare/v0.0.8...v0.1.0
[0.0.8]: https://github.com/yourusername/appsec-agent/compare/v0.0.6...v0.0.8
[0.0.6]: https://github.com/yourusername/appsec-agent/compare/v0.0.4...v0.0.6
[0.0.4]: https://github.com/yourusername/appsec-agent/compare/v0.0.2...v0.0.4
[0.0.2]: https://github.com/yourusername/appsec-agent/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/yourusername/appsec-agent/compare/v0.0.0...v0.0.1

