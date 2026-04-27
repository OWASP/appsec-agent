/**
 * v2.4.0 / sast-ai-app plan §8.17 (v6.0.0).
 *
 * Tests for the MCP-server wiring on the four reasoning role builders:
 * - getDiffReviewerOptions     (pr_reviewer / code_reviewer)
 * - getCodeFixerOptions        (code_fixer)
 * - getFindingValidatorOptions (finding_validator)
 * - getPrAdversaryOptions      (pr_adversary)
 *
 * These tests assert the public Options-shape contract the parent app's
 * §8.17 in-process MCP server depends on. They deliberately do NOT
 * exercise the SDK end-to-end (no model invocation); they pin the wiring
 * step that converts the new `mcpServerUrl` parameter into:
 *   - top-level `Options.mcpServers['sast-ai-app-internal']` of type
 *     `'http'` with the supplied URL, AND
 *   - per-subagent `tools` whitelist extension with the three v6.0.0
 *     `mcp__sast-ai-app-internal__*` tool names.
 *
 * Fail-shape: when `mcpServerUrl` is omitted (the v2.3.0 default), the
 * Options object must be byte-for-byte identical to the v2.3.0 output
 * for that role — no `mcpServers` key, no extra tool entries.
 */

import {
  AgentOptions,
  MCP_INTERNAL_SERVER_NAME,
  MCP_INTERNAL_TOOL_NAMES,
  buildMcpInternalToolNames,
} from '../agent_options';
import { ConfigDict } from '../utils';

const TEST_URL = 'http://localhost:9999/mcp';

const baseConfDict: ConfigDict = {
  default: {
    pr_reviewer: { options: {} },
    code_reviewer: { options: {} },
    pr_adversary: { options: {} },
    finding_validator: { options: {} },
    code_fixer: { options: {} },
  },
};

const expectedMcpToolNames = [
  'mcp__sast-ai-app-internal__queryFindingsHistory',
  'mcp__sast-ai-app-internal__queryImportGraph',
  'mcp__sast-ai-app-internal__queryRuntimeEnrichment',
];

describe('AgentOptions MCP wiring (v2.4.0 / §8.17)', () => {
  describe('module-level constants', () => {
    it('exposes a stable server name (deterministic prompt-nudge target)', () => {
      expect(MCP_INTERNAL_SERVER_NAME).toBe('sast-ai-app-internal');
    });

    it('lists exactly the three v6.0.0 backend-backed tools', () => {
      expect(MCP_INTERNAL_TOOL_NAMES).toEqual([
        'queryFindingsHistory',
        'queryImportGraph',
        'queryRuntimeEnrichment',
      ]);
    });

    it('builds SDK-namespaced tool names matching the literal contract', () => {
      expect(buildMcpInternalToolNames()).toEqual(expectedMcpToolNames);
    });

    it('keeps tool names in lockstep with the server name', () => {
      const namespaced = buildMcpInternalToolNames();
      for (const tool of namespaced) {
        expect(tool.startsWith(`mcp__${MCP_INTERNAL_SERVER_NAME}__`)).toBe(true);
      }
    });
  });

  describe('getDiffReviewerOptions (pr_reviewer / code_reviewer)', () => {
    it('attaches mcpServers and extends diff-reviewer tools when URL is set', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        false,
        false,
        TEST_URL,
      );
      expect(opts.mcpServers).toEqual({
        [MCP_INTERNAL_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual([
        'Read',
        'Grep',
        'Write',
        ...expectedMcpToolNames,
      ]);
    });

    it('preserves --no-tools posture (Write only) and still attaches MCP tools', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        true,
        false,
        TEST_URL,
      );
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Write', ...expectedMcpToolNames]);
    });

    it('is a no-op when mcpServerUrl is omitted (v2.3.0 baseline)', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions('pr_reviewer');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Read', 'Grep', 'Write']);
    });

    it('is a no-op when mcpServerUrl is an empty string', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        false,
        false,
        '',
      );
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Read', 'Grep', 'Write']);
    });
  });

  describe('getCodeFixerOptions (code_fixer)', () => {
    it('attaches mcpServers and extends code-fixer tools when URL is set', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getCodeFixerOptions('code_fixer', null, TEST_URL);
      expect(opts.mcpServers).toEqual({
        [MCP_INTERNAL_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['code-fixer'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedMcpToolNames]);
    });

    it('is a no-op when mcpServerUrl is omitted', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getCodeFixerOptions('code_fixer');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['code-fixer'];
      expect(agent.tools).toEqual(['Read', 'Grep']);
    });
  });

  describe('getFindingValidatorOptions (finding_validator)', () => {
    it('attaches mcpServers and extends finding-validator tools when URL is set', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getFindingValidatorOptions(
        'finding_validator',
        null,
        TEST_URL,
      );
      expect(opts.mcpServers).toEqual({
        [MCP_INTERNAL_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['finding-validator'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedMcpToolNames]);
    });

    it('is a no-op when mcpServerUrl is omitted', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getFindingValidatorOptions('finding_validator');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['finding-validator'];
      expect(agent.tools).toEqual(['Read', 'Grep']);
    });
  });

  describe('getPrAdversaryOptions (pr_adversary)', () => {
    it('attaches mcpServers and extends pr-adversary tools when URL is set', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getPrAdversaryOptions(
        'pr_adversary',
        null,
        undefined,
        false,
        TEST_URL,
      );
      expect(opts.mcpServers).toEqual({
        [MCP_INTERNAL_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['pr-adversary'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedMcpToolNames]);
    });

    it('is a no-op when mcpServerUrl is omitted', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getPrAdversaryOptions('pr_adversary');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['pr-adversary'];
      expect(agent.tools).toEqual(['Read', 'Grep']);
    });
  });

  describe('cross-role invariants', () => {
    it('uses the same server name across all four roles (deterministic identifier)', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const builders = [
        ao.getDiffReviewerOptions(
          'pr_reviewer',
          null,
          undefined,
          undefined,
          false,
          false,
          TEST_URL,
        ),
        ao.getCodeFixerOptions('code_fixer', null, TEST_URL),
        ao.getFindingValidatorOptions('finding_validator', null, TEST_URL),
        ao.getPrAdversaryOptions(
          'pr_adversary',
          null,
          undefined,
          false,
          TEST_URL,
        ),
      ];
      for (const opts of builders) {
        expect(Object.keys(opts.mcpServers ?? {})).toEqual([
          MCP_INTERNAL_SERVER_NAME,
        ]);
        const cfg = (opts.mcpServers as any)[MCP_INTERNAL_SERVER_NAME];
        expect(cfg.type).toBe('http');
        expect(cfg.url).toBe(TEST_URL);
      }
    });

    it('each role exposes the same v6.0.0 tool surface to the model', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const tools: string[][] = [
        ((ao.getDiffReviewerOptions(
          'pr_reviewer',
          null,
          undefined,
          undefined,
          false,
          false,
          TEST_URL,
        ).agents as any)['diff-reviewer'].tools as string[]),
        ((ao.getCodeFixerOptions('code_fixer', null, TEST_URL)
          .agents as any)['code-fixer'].tools as string[]),
        ((ao.getFindingValidatorOptions('finding_validator', null, TEST_URL)
          .agents as any)['finding-validator'].tools as string[]),
        ((ao.getPrAdversaryOptions(
          'pr_adversary',
          null,
          undefined,
          false,
          TEST_URL,
        ).agents as any)['pr-adversary'].tools as string[]),
      ];
      for (const list of tools) {
        for (const mcpTool of expectedMcpToolNames) {
          expect(list).toContain(mcpTool);
        }
      }
    });
  });
});
