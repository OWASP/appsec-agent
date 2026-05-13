import { ZodError } from 'zod';
import {
  CODEBASE_GRAPH_QUERY_KINDS,
  parseQueryCodebaseGraphToolArgs,
  queryCodebaseGraphToolArgsSchema,
} from '../schemas/mcp_query_codebase_graph';

describe('mcp_query_codebase_graph (queryCodebaseGraph tool args)', () => {
  it('exposes a closed kind enum', () => {
    expect(CODEBASE_GRAPH_QUERY_KINDS).toEqual([
      'callers',
      'callees',
      'reachable_from_entry',
      'semantic_search',
    ]);
  });

  it.each(CODEBASE_GRAPH_QUERY_KINDS)('parseQueryCodebaseGraphToolArgs accepts kind %s', (kind) => {
    const parsed = parseQueryCodebaseGraphToolArgs({ kind, target: 'Foo.bar' });
    expect(parsed).toEqual({ kind, target: 'Foo.bar' });
  });

  it('accepts target at max length 256', () => {
    const target = 'a'.repeat(256);
    const parsed = parseQueryCodebaseGraphToolArgs({
      kind: 'semantic_search',
      target,
    });
    expect(parsed.target).toHaveLength(256);
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

  it('rejects target longer than 256', () => {
    expect(() =>
      parseQueryCodebaseGraphToolArgs({
        kind: 'callers',
        target: 'a'.repeat(257),
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
