import {
  parseCrossRepoContext,
  formatCrossRepoContextForPrompt,
  type CrossRepoContext,
} from '../../schemas/cross_repo';

describe('cross_repo schema (Lane 3 Phase 2/A)', () => {
  describe('parseCrossRepoContext', () => {
    it('parses a minimal valid payload', () => {
      const ctx = parseCrossRepoContext({
        peers: [{ project_name: 'consumer-client-api', peer_graph_status: 'fresh' }],
      });
      expect(ctx.peers).toHaveLength(1);
      expect(ctx.peers[0].project_name).toBe('consumer-client-api');
      expect(ctx.peers[0].peer_graph_status).toBe('fresh');
      // Defaults for omitted fields.
      expect(ctx.peers[0].relationship_type).toBe('service_call');
      expect(ctx.peers[0].direction).toBe('source_calls_target');
      expect(ctx.peers[0].confidence).toBe('medium');
      expect(ctx.peers[0].depth).toBe(1);
      expect(ctx.peers[0].repo_url).toBeNull();
      expect(ctx.peers[0].enforcement_note).toBeNull();
    });

    it('accepts a fully-populated peer entry', () => {
      const ctx = parseCrossRepoContext({
        origin_project_name: 'consumer-web',
        parsed_at: '2026-07-18T12:00:00Z',
        coverage: 'partial',
        max_depth_used: 5,
        max_fanout_used: 10,
        truncated_by_fanout: true,
        peers: [
          {
            project_name: 'consumer-client-api',
            repo_url: 'https://github.com/capsulehealth/consumer-client-api',
            relationship_type: 'bff_client',
            direction: 'source_calls_target',
            confidence: 'high',
            depth: 1,
            enforcement_note: 'AGE_RESTRICTION_FAIL_CLOSED gates non-participating clients.',
            peer_graph_status: 'fresh',
          },
        ],
      });
      expect(ctx.origin_project_name).toBe('consumer-web');
      expect(ctx.parsed_at).toBe('2026-07-18T12:00:00Z');
      expect(ctx.coverage).toBe('partial');
      expect(ctx.max_depth_used).toBe(5);
      expect(ctx.max_fanout_used).toBe(10);
      expect(ctx.truncated_by_fanout).toBe(true);
      const p = ctx.peers[0];
      expect(p.repo_url).toBe('https://github.com/capsulehealth/consumer-client-api');
      expect(p.relationship_type).toBe('bff_client');
      expect(p.confidence).toBe('high');
      expect(p.enforcement_note).toContain('AGE_RESTRICTION_FAIL_CLOSED');
    });

    it('accepts all four relationship_type values', () => {
      for (const relationship_type of [
        'bff_client',
        'service_call',
        'shared_library',
        'deployment_sibling',
      ] as const) {
        const ctx = parseCrossRepoContext({
          peers: [{ project_name: 'p', relationship_type, peer_graph_status: 'fresh' }],
        });
        expect(ctx.peers[0].relationship_type).toBe(relationship_type);
      }
    });

    it('defaults an invalid relationship_type/direction/confidence/peer_graph_status instead of throwing', () => {
      const ctx = parseCrossRepoContext({
        peers: [
          {
            project_name: 'p',
            relationship_type: 'not_a_real_type',
            direction: 'sideways',
            confidence: 'extremely-high',
            peer_graph_status: 'unknown',
          },
        ],
      });
      const p = ctx.peers[0];
      expect(p.relationship_type).toBe('service_call');
      expect(p.direction).toBe('source_calls_target');
      expect(p.confidence).toBe('medium');
      expect(p.peer_graph_status).toBe('no_head');
    });

    it('floors fractional depth and clamps negatives to 0; defaults non-numeric depth to 1', () => {
      const ctx = parseCrossRepoContext({
        peers: [
          { project_name: 'a', depth: 3.7, peer_graph_status: 'fresh' },
          { project_name: 'b', depth: -5, peer_graph_status: 'fresh' },
          { project_name: 'c', depth: 'two', peer_graph_status: 'fresh' },
        ],
      });
      expect(ctx.peers[0].depth).toBe(3);
      expect(ctx.peers[1].depth).toBe(0);
      expect(ctx.peers[2].depth).toBe(1);
    });

    it('collapses empty/whitespace enforcement_note and repo_url to null', () => {
      const ctx = parseCrossRepoContext({
        peers: [
          { project_name: 'a', enforcement_note: '   ', repo_url: '', peer_graph_status: 'fresh' },
        ],
      });
      expect(ctx.peers[0].enforcement_note).toBeNull();
      expect(ctx.peers[0].repo_url).toBeNull();
    });

    it('accepts all four valid coverage values; drops invalid ones to undefined', () => {
      for (const coverage of ['full', 'partial', 'none', 'empty'] as const) {
        const ctx = parseCrossRepoContext({
          coverage,
          peers: [{ project_name: 'a', peer_graph_status: 'fresh' }],
        });
        expect(ctx.coverage).toBe(coverage);
      }
      const bad = parseCrossRepoContext({
        coverage: 'definitely-not-a-coverage-value',
        peers: [{ project_name: 'a', peer_graph_status: 'fresh' }],
      });
      expect(bad.coverage).toBeUndefined();
    });

    it('rejects non-object input', () => {
      expect(() => parseCrossRepoContext(null)).toThrow(/must be a JSON object/);
      expect(() => parseCrossRepoContext('x')).toThrow(/must be a JSON object/);
    });

    it('rejects missing peers array', () => {
      expect(() => parseCrossRepoContext({})).toThrow(/must include a "peers" array/);
    });

    it('rejects peers.length > 50', () => {
      const big = Array.from({ length: 51 }, (_, i) => ({
        project_name: `peer-${i}`,
        peer_graph_status: 'fresh' as const,
      }));
      expect(() => parseCrossRepoContext({ peers: big })).toThrow(/at most 50 peers/);
    });

    it('rejects non-object peer entries', () => {
      expect(() => parseCrossRepoContext({ peers: ['consumer-client-api'] })).toThrow(/must be an object/);
      expect(() => parseCrossRepoContext({ peers: [null] })).toThrow(/must be an object/);
    });

    it('rejects entries without a project_name string', () => {
      expect(() => parseCrossRepoContext({ peers: [{ peer_graph_status: 'fresh' }] })).toThrow(
        /non-empty string "project_name"/,
      );
      expect(() => parseCrossRepoContext({ peers: [{ project_name: '', peer_graph_status: 'fresh' }] })).toThrow(
        /non-empty string "project_name"/,
      );
      expect(() => parseCrossRepoContext({ peers: [{ project_name: '   ' }] })).toThrow(
        /non-empty string "project_name"/,
      );
    });
  });

  describe('formatCrossRepoContextForPrompt', () => {
    it('returns empty string when peers list is empty', () => {
      expect(formatCrossRepoContextForPrompt({ peers: [] })).toBe('');
    });

    it('renders a compact markdown table sorted by depth ascending', () => {
      const ctx: CrossRepoContext = {
        peers: [
          {
            project_name: 'shared-lib-peer',
            repo_url: null,
            relationship_type: 'shared_library',
            direction: 'bidirectional',
            confidence: 'low',
            depth: 3,
            enforcement_note: null,
            peer_graph_status: 'no_head',
          },
          {
            project_name: 'consumer-client-api',
            repo_url: 'https://github.com/capsulehealth/consumer-client-api',
            relationship_type: 'bff_client',
            direction: 'source_calls_target',
            confidence: 'high',
            depth: 1,
            enforcement_note: 'AGE_RESTRICTION_FAIL_CLOSED gates non-participating clients.',
            peer_graph_status: 'fresh',
          },
        ],
      };
      const out = formatCrossRepoContextForPrompt(ctx);
      expect(out).toContain('### Cross-repo service-topology context (Lane 3, plan §Phase 2)');
      const directIdx = out.indexOf('consumer-client-api');
      const transitiveIdx = out.indexOf('shared-lib-peer');
      expect(directIdx).toBeGreaterThan(0);
      expect(directIdx).toBeLessThan(transitiveIdx);
      expect(out).toContain('is a client of (BFF)');
      expect(out).toContain('AGE_RESTRICTION_FAIL_CLOSED');
      // Peer with no enforcement note renders an em-dash.
      expect(out).toContain('| shared-lib-peer | shares a library with | low | 3 | no_head | — |');
    });

    it('escapes pipe characters in enforcement_note so the markdown table does not break', () => {
      const out = formatCrossRepoContextForPrompt({
        peers: [
          {
            project_name: 'peer-a',
            repo_url: null,
            relationship_type: 'service_call',
            direction: 'source_calls_target',
            confidence: 'medium',
            depth: 1,
            enforcement_note: 'note with a | pipe character',
            peer_graph_status: 'fresh',
          },
        ],
      });
      expect(out).toContain('note with a \\| pipe character');
    });

    it('teaches the LLM the advisory / as-of-evidence contract', () => {
      const out = formatCrossRepoContextForPrompt({
        peers: [
          {
            project_name: 'peer-a',
            repo_url: null,
            relationship_type: 'service_call',
            direction: 'source_calls_target',
            confidence: 'medium',
            depth: 1,
            enforcement_note: null,
            peer_graph_status: 'fresh',
          },
        ],
      });
      expect(out).toContain('advisory');
      expect(out).toContain('downrank the client finding');
      expect(out).toContain('no_head');
    });

    it('renders a coverage banner when coverage is non-`full`', () => {
      const peer = {
        project_name: 'peer-a',
        repo_url: null,
        relationship_type: 'service_call' as const,
        direction: 'source_calls_target' as const,
        confidence: 'medium' as const,
        depth: 1,
        enforcement_note: null,
        peer_graph_status: 'stale' as const,
      };
      const out = formatCrossRepoContextForPrompt({ coverage: 'partial', peers: [peer] });
      expect(out).toContain('Coverage: **partial**');
      expect(out).toContain('fail-open');
    });

    it('does not render a coverage banner when coverage is `full` or unset', () => {
      const peer = {
        project_name: 'peer-a',
        repo_url: null,
        relationship_type: 'service_call' as const,
        direction: 'source_calls_target' as const,
        confidence: 'medium' as const,
        depth: 1,
        enforcement_note: null,
        peer_graph_status: 'fresh' as const,
      };
      const fullOut = formatCrossRepoContextForPrompt({ coverage: 'full', peers: [peer] });
      const unsetOut = formatCrossRepoContextForPrompt({ peers: [peer] });
      expect(fullOut).not.toContain('Coverage:');
      expect(unsetOut).not.toContain('Coverage:');
    });
  });
});
