# Web integration

Using AppSec Agent as an **npm library** inside a web server or API.

[← Back to README](../README.md) · [Development](development.md)

---

## Install as a library

```bash
npm install appsec-agent
```

```typescript
import { AgentActions, loadYaml, type AgentArgs } from 'appsec-agent';
```

Ensure `ANTHROPIC_API_KEY` is set in the server environment (or `CODEX_API_KEY` when using Codex).

---

## Basic request handler

**Create a new `AgentActions` instance per HTTP request** — do not share one instance across concurrent users.

```typescript
import { AgentActions, loadYaml, type AgentArgs } from 'appsec-agent';

const confDict = loadYaml('conf/appsec_agent.yaml');

app.post('/api/query', async (req, res) => {
  const args: AgentArgs = {
    role: 'simple_query_agent',
    environment: 'default',
    verbose: false,
  };

  const agent = new AgentActions(confDict, 'default', args);
  const result = await agent.simpleQueryClaudeWithOptions(req.body.query);

  res.json({ result });
});
```

Other roles use similarly named methods on `AgentActions`:

| Role | Method |
|------|--------|
| `code_reviewer` | `codeReviewerWithOptions(prompt, srcDir)` |
| `pr_reviewer` | `diffReviewerWithOptions(prompt, srcDir)` |
| `threat_modeler` | `threatModelerAgentWithOptions(prompt, srcDir)` |
| `pr_adversary` | `prAdversaryWithOptions(prompt, srcDir)` |
| `code_fixer` | `codeFixerWithOptions(prompt, srcDir)` |
| `qa_verifier` | `qaVerifierWithOptions(prompt, srcDir)` |

See `src/agent_actions.ts` for the full list.

---

## Thread safety

The package is designed for **concurrent web traffic**:

| Safe | Unsafe |
|------|--------|
| New `AgentActions` per request | Reusing one instance across requests |
| Capture `process.cwd()` once per request | Calling `process.cwd()` repeatedly under load |
| Pass explicit paths to validators | Sharing mutable state between handlers |

### Conversation history

Each `AgentActions` instance keeps its own conversation history — requests do not leak context to each other.

### Tool usage logs

If you reuse `AgentOptions` across requests (unusual), clear logs between uses:

```typescript
agentOptions.clearToolUsageLog();
```

Read-only access:

```typescript
const log = agentOptions.getToolUsageLog();
```

---

## Path validation

Always validate user-supplied paths before read/write:

```typescript
import { validateInputFilePath, validateOutputFilePath } from 'appsec-agent';

const workingDir = process.cwd(); // once per request
const inputPath = validateInputFilePath(userSuppliedPath, workingDir);
const outputPath = validateOutputFilePath('report.json', workingDir);
```

---

## Provider selection

Set `process.env.AGENT_PROVIDER = 'claude' | 'codex'` before creating `AgentActions`, or pass model/provider via `AgentArgs` when your integration supports it.

The library calls `resolveProvider().run({ prompt, roleSpec })` internally — same behavior as the CLI.

---

## Metrics and cost

Result messages may include:

- `total_cost_usd` — estimated API cost
- Token usage (logged to stdout in CLI; available on result objects in library flows)

Threat modeler and chunked PR reviews aggregate cost across batches when applicable.

---

## Prefer a ready-made UI?

If you do not need a custom integration, use **[AI Threat Modeler](https://github.com/yangsec888/ai-threat-modeler/)** — a Dockerized Next.js app that already wraps these agents with auth, dashboards, and exports.
