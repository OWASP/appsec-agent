/**
 * Tests for the MCP-server wiring on the four reasoning role builders:
 * - getDiffReviewerOptions     (pr_reviewer / code_reviewer)
 * - getCodeFixerOptions        (code_fixer)
 * - getFindingValidatorOptions (finding_validator)
 * - getPrAdversaryOptions      (pr_adversary)
 *
 * These tests assert the public Options-shape contract a parent app's
 * in-process MCP server depends on. They deliberately do NOT exercise
 * the SDK end-to-end (no model invocation); they pin the wiring step
 * that converts the `mcpServerUrl` (+ optional `mcpServerName`)
 * parameters into:
 *   - top-level `Options.mcpServers[<server-name>]` of type `'http'`
 *     with the supplied URL, AND
 *   - per-subagent `tools` whitelist extension with the SDK-namespaced
 *     `mcp__<server-name>__*` tool names.
 *
 * Default-name path (v2.4.2): when `mcpServerName` is omitted the
 * builders fall back to `DEFAULT_MCP_SERVER_NAME` ("appsec-internal").
 *
 * Override path (v2.4.2): when `mcpServerName` is supplied — typically
 * by a parent app that needs to keep an existing tool-name contract
 * stable — the value flows through to the keys of `Options.mcpServers`
 * and the `mcp__<name>__*` prefix on the subagent's tool whitelist.
 *
 * Fail-shape: when `mcpServerUrl` is omitted (the v2.3.0 default), the
 * Options object must be byte-for-byte identical to the v2.3.0 output
 * for that role — no `mcpServers` key, no extra tool entries.
 */

import {
  AgentOptions,
  DEFAULT_MCP_SERVER_NAME,
  MCP_INTERNAL_SERVER_NAME,
  MCP_INTERNAL_TOOL_NAMES,
  buildMcpInternalToolNames,
  buildPrReviewerMcpNudgeSystemPromptSuffix,
} from '../agent_options';
import { ConfigDict } from '../utils';

const TEST_URL = 'http://localhost:9999/mcp';
const CUSTOM_SERVER_NAME = 'parent-app-internal';

const baseConfDict: ConfigDict = {
  default: {
    pr_reviewer: { options: {} },
    code_reviewer: { options: {} },
    pr_adversary: { options: {} },
    finding_validator: { options: {} },
    code_fixer: { options: {} },
  },
};

const expectedDefaultMcpToolNames = [
  'mcp__appsec-internal__queryFindingsHistory',
  'mcp__appsec-internal__queryImportGraph',
  'mcp__appsec-internal__queryRuntimeEnrichment',
];

const expectedCustomMcpToolNames = [
  `mcp__${CUSTOM_SERVER_NAME}__queryFindingsHistory`,
  `mcp__${CUSTOM_SERVER_NAME}__queryImportGraph`,
  `mcp__${CUSTOM_SERVER_NAME}__queryRuntimeEnrichment`,
];

describe('AgentOptions MCP wiring', () => {
  describe('module-level constants', () => {
    it('exposes a generic, parent-app-agnostic default server name', () => {
      expect(DEFAULT_MCP_SERVER_NAME).toBe('appsec-internal');
    });

    it('keeps the legacy MCP_INTERNAL_SERVER_NAME alias in sync with the default', () => {
      expect(MCP_INTERNAL_SERVER_NAME).toBe(DEFAULT_MCP_SERVER_NAME);
    });

    it('lists exactly the three backend-backed tools', () => {
      expect(MCP_INTERNAL_TOOL_NAMES).toEqual([
        'queryFindingsHistory',
        'queryImportGraph',
        'queryRuntimeEnrichment',
      ]);
    });

    it('builds default SDK-namespaced tool names matching the literal contract', () => {
      expect(buildMcpInternalToolNames()).toEqual(expectedDefaultMcpToolNames);
    });

    it('builds SDK-namespaced tool names against an override server name', () => {
      expect(buildMcpInternalToolNames(CUSTOM_SERVER_NAME)).toEqual(
        expectedCustomMcpToolNames,
      );
    });

    it('keeps tool names in lockstep with the supplied server name', () => {
      const namespaced = buildMcpInternalToolNames(CUSTOM_SERVER_NAME);
      for (const tool of namespaced) {
        expect(tool.startsWith(`mcp__${CUSTOM_SERVER_NAME}__`)).toBe(true);
      }
    });
  });

  describe('getDiffReviewerOptions (pr_reviewer / code_reviewer)', () => {
    it('attaches mcpServers under the default name and extends diff-reviewer tools', () => {
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
        [DEFAULT_MCP_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual([
        'Read',
        'Grep',
        'Write',
        ...expectedDefaultMcpToolNames,
      ]);
    });

    it('adds Authorization Bearer on mcpServers when mcpServerBearer is set (v2.4.5+)', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        false,
        false,
        TEST_URL,
        undefined,
        'opaque-per-scan-secret',
      );
      expect(opts.mcpServers).toEqual({
        [DEFAULT_MCP_SERVER_NAME]: {
          type: 'http',
          url: TEST_URL,
          headers: { Authorization: 'Bearer opaque-per-scan-secret' },
        },
      });
    });

    it('honors the mcpServerName override on both mcpServers key and tool prefix', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        false,
        false,
        TEST_URL,
        CUSTOM_SERVER_NAME,
      );
      expect(opts.mcpServers).toEqual({
        [CUSTOM_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual([
        'Read',
        'Grep',
        'Write',
        ...expectedCustomMcpToolNames,
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
      expect(agent.tools).toEqual(['Write', ...expectedDefaultMcpToolNames]);
    });

    it('is a no-op when mcpServerUrl is omitted (v2.3.0 baseline)', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions('pr_reviewer');
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Read', 'Grep', 'Write']);
    });

    it('is a no-op when mcpServerUrl is an empty string (even with a name override)', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getDiffReviewerOptions(
        'pr_reviewer',
        null,
        undefined,
        undefined,
        false,
        false,
        '',
        CUSTOM_SERVER_NAME,
      );
      expect(opts.mcpServers).toBeUndefined();
      const agent = (opts.agents as any)['diff-reviewer'];
      expect(agent.tools).toEqual(['Read', 'Grep', 'Write']);
    });

    describe('pr_reviewer MCP system-prompt nudge (§8.17 phase 3)', () => {
      it('appends findings-history + import-graph + runtime-enrichment nudge when MCP URL is set', () => {
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
        const prompt = (opts.agents as any)['diff-reviewer'].prompt as string;
        expect(prompt).toContain('**Backend-backed MCP tools:**');
        expect(prompt).toContain(
          '`mcp__appsec-internal__queryFindingsHistory`',
        );
        expect(prompt).toContain('`mcp__appsec-internal__queryImportGraph`');
        expect(prompt).toContain(
          '`mcp__appsec-internal__queryRuntimeEnrichment`',
        );
      });

      it('uses mcpServerName in the nudge tool ids', () => {
        const ao = new AgentOptions(baseConfDict, 'default');
        const opts = ao.getDiffReviewerOptions(
          'pr_reviewer',
          null,
          undefined,
          undefined,
          false,
          false,
          TEST_URL,
          CUSTOM_SERVER_NAME,
        );
        const prompt = (opts.agents as any)['diff-reviewer'].prompt as string;
        expect(prompt).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryFindingsHistory\``,
        );
        expect(prompt).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryImportGraph\``,
        );
        expect(prompt).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryRuntimeEnrichment\``,
        );
      });

      it('does not append the pr_reviewer nudge for code_reviewer even when MCP URL is set', () => {
        const ao = new AgentOptions(baseConfDict, 'default');
        const opts = ao.getDiffReviewerOptions(
          'code_reviewer',
          null,
          undefined,
          undefined,
          false,
          false,
          TEST_URL,
        );
        const prompt = (opts.agents as any)['diff-reviewer'].prompt as string;
        expect(prompt).not.toContain('**Backend-backed MCP tools:**');
      });

      it('does not append the nudge when mcpServerUrl is omitted', () => {
        const ao = new AgentOptions(baseConfDict, 'default');
        const opts = ao.getDiffReviewerOptions('pr_reviewer');
        const prompt = (opts.agents as any)['diff-reviewer'].prompt as string;
        expect(prompt).not.toContain('**Backend-backed MCP tools:**');
      });

      it('buildPrReviewerMcpNudgeSystemPromptSuffix is stable for direct callers', () => {
        const suffix = buildPrReviewerMcpNudgeSystemPromptSuffix(CUSTOM_SERVER_NAME);
        expect(suffix).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryFindingsHistory\``,
        );
        expect(suffix).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryImportGraph\``,
        );
        expect(suffix).toContain(
          `\`mcp__${CUSTOM_SERVER_NAME}__queryRuntimeEnrichment\``,
        );
      });
    });
  });

  describe('getCodeFixerOptions (code_fixer)', () => {
    it('attaches mcpServers under the default name and extends code-fixer tools', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getCodeFixerOptions('code_fixer', null, TEST_URL);
      expect(opts.mcpServers).toEqual({
        [DEFAULT_MCP_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['code-fixer'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedDefaultMcpToolNames]);
    });

    it('honors the mcpServerName override', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getCodeFixerOptions(
        'code_fixer',
        null,
        TEST_URL,
        CUSTOM_SERVER_NAME,
      );
      expect(opts.mcpServers).toEqual({
        [CUSTOM_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['code-fixer'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedCustomMcpToolNames]);
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
    it('attaches mcpServers under the default name and extends finding-validator tools', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getFindingValidatorOptions(
        'finding_validator',
        null,
        TEST_URL,
      );
      expect(opts.mcpServers).toEqual({
        [DEFAULT_MCP_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['finding-validator'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedDefaultMcpToolNames]);
    });

    it('honors the mcpServerName override', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getFindingValidatorOptions(
        'finding_validator',
        null,
        TEST_URL,
        CUSTOM_SERVER_NAME,
      );
      expect(opts.mcpServers).toEqual({
        [CUSTOM_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['finding-validator'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedCustomMcpToolNames]);
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
    it('attaches mcpServers under the default name and extends pr-adversary tools', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getPrAdversaryOptions(
        'pr_adversary',
        null,
        undefined,
        false,
        TEST_URL,
      );
      expect(opts.mcpServers).toEqual({
        [DEFAULT_MCP_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['pr-adversary'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedDefaultMcpToolNames]);
    });

    it('honors the mcpServerName override', () => {
      const ao = new AgentOptions(baseConfDict, 'default');
      const opts = ao.getPrAdversaryOptions(
        'pr_adversary',
        null,
        undefined,
        false,
        TEST_URL,
        CUSTOM_SERVER_NAME,
      );
      expect(opts.mcpServers).toEqual({
        [CUSTOM_SERVER_NAME]: { type: 'http', url: TEST_URL },
      });
      const agent = (opts.agents as any)['pr-adversary'];
      expect(agent.tools).toEqual(['Read', 'Grep', ...expectedCustomMcpToolNames]);
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
    it('uses the default server name across all four roles when no override is given', () => {
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
          DEFAULT_MCP_SERVER_NAME,
        ]);
        const cfg = (opts.mcpServers as any)[DEFAULT_MCP_SERVER_NAME];
        expect(cfg.type).toBe('http');
        expect(cfg.url).toBe(TEST_URL);
      }
    });

    it('propagates the mcpServerName override to all four roles consistently', () => {
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
          CUSTOM_SERVER_NAME,
        ),
        ao.getCodeFixerOptions('code_fixer', null, TEST_URL, CUSTOM_SERVER_NAME),
        ao.getFindingValidatorOptions(
          'finding_validator',
          null,
          TEST_URL,
          CUSTOM_SERVER_NAME,
        ),
        ao.getPrAdversaryOptions(
          'pr_adversary',
          null,
          undefined,
          false,
          TEST_URL,
          CUSTOM_SERVER_NAME,
        ),
      ];
      for (const opts of builders) {
        expect(Object.keys(opts.mcpServers ?? {})).toEqual([CUSTOM_SERVER_NAME]);
      }
    });

    it('each role exposes the same tool surface to the model under the default name', () => {
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
        for (const mcpTool of expectedDefaultMcpToolNames) {
          expect(list).toContain(mcpTool);
        }
      }
    });
  });
});
