/**
 * Tests for CodexProvider stream adapter and structured output validation.
 */

import { CodexProvider, roleSpecToCodexThreadOptions } from '../providers/codex_provider';
import type { RoleSpec } from '../providers/role_spec';
import { THREAT_MODEL_REPORT_SCHEMA } from '../schemas/threat_model_report';
import { DEFAULT_MCP_SERVER_NAME } from '../mcp_internal';

const validReport = {
  threat_model_report: {
    metadata: {
      project_name: 'demo',
      scan_date: '2026-01-01',
      methodology: 'STRIDE',
      total_threats_identified: 0,
      total_risks_identified: 0,
    },
    data_flow_diagram: {
      description: 'dfd',
      nodes: [],
      data_flows: [],
      trust_boundaries: [],
    },
    threat_model: { executive_summary: 'summary', threats: [] },
    risk_registry: { summary: 'risks', risks: [] },
  },
};

function threatModelerSpec(overrides: Partial<RoleSpec> = {}): RoleSpec {
  return {
    roleId: 'threat_modeler',
    systemPrompt: 'You are a threat modeler.',
    maxTurns: 20,
    agentName: 'threat-modeler',
    agentDescription: 'Performs threat modeling',
    capabilities: { read: true, grep: true },
    permissionMode: 'bypassPermissions',
    outputSchema: THREAT_MODEL_REPORT_SCHEMA,
    model: 'opus',
    workingDirectory: '/tmp/scan',
    ...overrides,
  };
}

describe('CodexProvider', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('has provider id codex', () => {
    expect(new CodexProvider().provider).toBe('codex');
  });

  it('roleSpecToCodexThreadOptions sets skipGitRepoCheck and read-only sandbox for json threat modeler', () => {
    const opts = roleSpecToCodexThreadOptions(threatModelerSpec());
    expect(opts.skipGitRepoCheck).toBe(true);
    expect(opts.sandboxMode).toBe('read-only');
    expect(opts.approvalPolicy).toBe('never');
    expect(opts.workingDirectory).toBe('/tmp/scan');
    expect(opts.model).toBe('o3');
  });

  it('uses workspace-write when MCP is attached', () => {
    const opts = roleSpecToCodexThreadOptions(
      threatModelerSpec({
        mcp: {
          url: 'http://127.0.0.1:9999/mcp',
          name: DEFAULT_MCP_SERVER_NAME,
          toolNames: ['queryFindingsHistory'],
        },
      }),
    );
    expect(opts.sandboxMode).toBe('workspace-write');
  });

  it('adapts runStreamed events to QueryMessage with structured_output', async () => {
    const mockRunStreamed = jest.fn().mockResolvedValue({
      events: (async function* () {
        yield {
          type: 'item.completed',
          item: {
            id: '1',
            type: 'agent_message',
            text: JSON.stringify(validReport),
          },
        };
        yield {
          type: 'turn.completed',
          usage: { input_tokens: 100, output_tokens: 50, cached_input_tokens: 0, reasoning_output_tokens: 0 },
        };
      })(),
    });

    const mockStartThread = jest.fn().mockReturnValue({ runStreamed: mockRunStreamed });
    const provider = new CodexProvider((_spec, _home) => ({ startThread: mockStartThread }));

    const messages: unknown[] = [];
    for await (const msg of provider.run({ prompt: 'Analyze repo', roleSpec: threatModelerSpec() })) {
      messages.push(msg);
    }

    expect(mockStartThread).toHaveBeenCalledWith(
      expect.objectContaining({ skipGitRepoCheck: true, sandboxMode: 'read-only' }),
    );

    const result = messages.find((m) => (m as { type: string }).type === 'result') as {
      structured_output?: unknown;
      usage?: { input_tokens: number; output_tokens: number };
      total_cost_usd?: number;
    };
    expect(result?.structured_output).toEqual(validReport);
    expect(result?.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
    expect(result?.total_cost_usd).toBeGreaterThan(0);
  });

  it('isolates CODEX_HOME per run', async () => {
    const codexHomes: string[] = [];
    const mockRunStreamed = jest.fn().mockResolvedValue({
      events: (async function* () {
        yield {
          type: 'turn.completed',
          usage: { input_tokens: 1, output_tokens: 1, cached_input_tokens: 0, reasoning_output_tokens: 0 },
        };
      })(),
    });
    const mockStartThread = jest.fn().mockReturnValue({ runStreamed: mockRunStreamed });

    const provider = new CodexProvider((_spec, codexHome) => {
      codexHomes.push(codexHome);
      return { startThread: mockStartThread };
    });

    for await (const _ of provider.run({ prompt: 'x', roleSpec: threatModelerSpec() })) {
      // drain
    }
    for await (const _ of provider.run({ prompt: 'y', roleSpec: threatModelerSpec() })) {
      // drain
    }

    expect(codexHomes).toHaveLength(2);
    expect(codexHomes[0]).not.toBe(codexHomes[1]);
  });
});
