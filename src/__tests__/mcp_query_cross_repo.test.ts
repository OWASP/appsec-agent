import { ZodError } from 'zod';
import {
  parseQueryCrossRepoGraphToolArgs,
  queryCrossRepoGraphToolArgsSchema,
} from '../schemas/mcp_query_cross_repo';

describe('mcp_query_cross_repo (queryCrossRepoGraph tool args)', () => {
  it('accepts an empty object (peer_name_filter is optional)', () => {
    const parsed = parseQueryCrossRepoGraphToolArgs({});
    expect(parsed).toEqual({});
  });

  it('accepts a peer_name_filter string', () => {
    const parsed = parseQueryCrossRepoGraphToolArgs({ peer_name_filter: 'consumer-client-api' });
    expect(parsed).toEqual({ peer_name_filter: 'consumer-client-api' });
  });

  it('accepts peer_name_filter at max length 256', () => {
    const peer_name_filter = 'a'.repeat(256);
    const parsed = parseQueryCrossRepoGraphToolArgs({ peer_name_filter });
    expect(parsed.peer_name_filter).toHaveLength(256);
  });

  it('rejects empty peer_name_filter', () => {
    expect(() =>
      parseQueryCrossRepoGraphToolArgs({ peer_name_filter: '' }),
    ).toThrow(ZodError);
  });

  it('rejects peer_name_filter longer than 256', () => {
    expect(() =>
      parseQueryCrossRepoGraphToolArgs({ peer_name_filter: 'a'.repeat(257) }),
    ).toThrow(ZodError);
  });

  it('rejects non-string peer_name_filter', () => {
    expect(() =>
      queryCrossRepoGraphToolArgsSchema.parse({ peer_name_filter: 42 }),
    ).toThrow(ZodError);
  });

  it('rejects extra keys (.strict())', () => {
    expect(() =>
      queryCrossRepoGraphToolArgsSchema.parse({ peer_name_filter: 'x', extra: 1 }),
    ).toThrow(ZodError);
  });
});
