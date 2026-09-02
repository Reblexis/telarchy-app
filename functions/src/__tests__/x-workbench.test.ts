/**
 * The X workbench's pure parts (docs/x-workbench.md). Pure-function tests
 * because every rule here is arithmetic or a regex: they run in milliseconds
 * and fail with the value rather than a status code.
 */
import { disagrees, hasNumber, parsePostId, summarise, syndicationToken } from '../services/x-workbench';

describe('parsePostId', () => {
  test('takes a bare id', () => {
    expect(parsePostId('2087609007842177380')).toBe('2087609007842177380');
  });

  test('takes a status URL, which is what he will actually paste', () => {
    expect(parsePostId('https://x.com/viktorci/status/2087609007842177380')).toBe('2087609007842177380');
    expect(parsePostId('https://twitter.com/a/status/123456?s=20&t=abc')).toBe('123456');
  });

  test('refuses anything that is not an id, rather than fetching nonsense', () => {
    expect(() => parsePostId('https://x.com/viktorci')).toThrow();
    expect(() => parsePostId('')).toThrow();
    expect(() => parsePostId('not-a-post')).toThrow();
  });
});

describe('syndicationToken', () => {
  // The token is a deterministic function of the id (that is what makes the
  // read credential-free). Pinned against the value X's own widget computes
  // for this id; if the algorithm drifts, the read 404s and this fails first.
  test('derives the token X expects', () => {
    expect(syndicationToken('2087609007842177380')).toBe('526fl9su7f');
  });

  test('never contains a dot or a zero, which the endpoint rejects', () => {
    for (const id of ['1', '999999999999999999', '2087609007842177380']) {
      expect(syndicationToken(id)).not.toMatch(/[0.]/);
    }
  });
});

describe('reply features', () => {
  test('hasNumber sees a figure anywhere in the text', () => {
    expect(hasNumber('I paid $30 for it')).toBe(true);
    expect(hasNumber('no figures at all here')).toBe(false);
  });

  test('disagrees sees the words an argument starts with', () => {
    expect(disagrees('Not quite, the market priced it differently')).toBe(true);
    expect(disagrees('Agreed, same experience here')).toBe(false);
  });
});

describe('summarise', () => {
  const reply = (
    likes: number | null,
    over: Partial<{ hasNumber: boolean; disagrees: boolean; length: number }> = {},
  ) => ({
    likes,
    hasNumber: false,
    disagrees: false,
    length: 100,
    ...over,
  });

  test('refuses to claim a pattern from too few replies', () => {
    const out = summarise([reply(5), reply(0), reply(9)]);
    expect(out.enough).toBe(false);
    // The point of the refusal is that the UI says how far off it is, so it
    // does not read as an error.
    expect('note' in out && out.note).toContain('3 replies');
  });

  test('ignores replies with no metrics when counting toward the threshold', () => {
    const rows = [...Array(9)].map(() => reply(1)).concat([...Array(5)].map(() => reply(null)));
    expect(summarise(rows).enough).toBe(false);
  });

  test('reports the median and which features track with engagement', () => {
    // Ten replies: the five carrying a number earn far more than the five
    // that do not, which is exactly the shape the summary must surface.
    const rows = [...[...Array(5)].map(() => reply(10, { hasNumber: true })), ...[...Array(5)].map(() => reply(0))];
    const out = summarise(rows);
    expect(out.enough).toBe(true);
    if (!out.enough) return;
    expect(out.median).toBe(10);
    expect(out.anyEngagement).toBe(50);
    const numbers = out.features?.find(f => f.label === 'carries a number');
    expect(numbers).toEqual({ label: 'carries a number', on: 10, off: 0 });
  });
});
