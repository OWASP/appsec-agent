import { ZodError } from 'zod';
import {
  CODEBASE_GRAPH_ADVANCED_QUERY_KINDS,
  CODEBASE_GRAPH_BASE_QUERY_KINDS,
  CODEBASE_GRAPH_QUERY_KINDS,
  parseQueryCodebaseGraphToolArgs,
  queryCodebaseGraphToolArgsSchema,
} from '../schemas/mcp_query_codebase_graph';

describe('mcp_query_codebase_graph (queryCodebaseGraph tool args)', () => {
  it('exposes a closed kind enum', () => {
    expect(CODEBASE_GRAPH_BASE_QUERY_KINDS).toEqual([
      'callers',
      'callees',
      'reachable_from_entry',
      'semantic_search',
    ]);
    expect(CODEBASE_GRAPH_ADVANCED_QUERY_KINDS).toEqual([
      'data_flow',
      'cross_service',
      'code_snippet',
    ]);
    expect(CODEBASE_GRAPH_QUERY_KINDS).toEqual([
      ...CODEBASE_GRAPH_BASE_QUERY_KINDS,
      ...CODEBASE_GRAPH_ADVANCED_QUERY_KINDS,
    ]);
  });

  it.each(CODEBASE_GRAPH_QUERY_KINDS)('parseQueryCodebaseGraphToolArgs accepts kind %s', (kind) => {
    const parsed = parseQueryCodebaseGraphToolArgs({ kind, target: 'Foo.bar' });
    expect(parsed).toEqual({ kind, target: 'Foo.bar' });
  });

  it('accepts optional include_neighbors for code_snippet', () => {
    const parsed = parseQueryCodebaseGraphToolArgs({
      kind: 'code_snippet',
      target: 'proj.src.Foo.bar',
      include_neighbors: true,
    });
    expect(parsed.include_neighbors).toBe(true);
  });

  it('accepts target at max length 512', () => {
    const target = 'a'.repeat(512);
    const parsed = parseQueryCodebaseGraphToolArgs({
      kind: 'semantic_search',
      target,
    });
    expect(parsed.target).toHaveLength(512);
  });

  it('rejects unknown kind', () => {
    expect(() =>
      parseQueryCodebaseGraphToolArgs({ kind: 'raw_cypher', target: 'x' }),
    ).toThrow(ZodError);
  });

  it('rejects empty target', () => {
    expect(() =>
      parseQueryCodebaseGraphToolArgs({ kind: 'callers', target: '' }),
    ).toThrow(ZodError);
  });

  it('rejects target longer than 512', () => {
    expect(() =>
      parseQueryCodebaseGraphToolArgs({
        kind: 'callers',
        target: 'a'.repeat(513),
      }),
    ).toThrow(ZodError);
  });

  it('rejects extra keys (.strict())', () => {
    expect(() =>
      queryCodebaseGraphToolArgsSchema.parse({
        kind: 'callers',
        target: 'x',
        extra: 1,
      }),
    ).toThrow(ZodError);
  });
});
