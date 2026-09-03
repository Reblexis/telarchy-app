/**
 * The X workbench's pure parts (docs/x-workbench.md). Pure-function tests
 * because every rule here is arithmetic or a regex: they run in milliseconds
 * and fail with the value rather than a status code.
 */

import type { ProposalBody } from '../services/x-workbench';
import {
  disagrees,
  hasNumber,
  POST_RULES,
  parseDraft,
  parsePostId,
  parseSuggestion,
  summarise,
  syndicationToken,
  withoutDashes,
} from '../services/x-workbench';

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
    over: Partial<{
      hasNumber: boolean;
      disagrees: boolean;
      length: number;
    }> = {},
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

describe('parseSuggestion', () => {
  // docs/x-workbench.md, "Get a search prompt": the proposal is a structured
  // field, and a fenced block, a preamble, or a rationale long enough to lose
  // its closing brace is not a reason for the button to fail. Each of the text
  // shapes below is one the model actually returned on 2026-09-03, and the
  // third is the one that produced "Search suggestion came back unparseable".
  const tool = (input: unknown) => ({
    content: [{ type: 'tool_use', name: 'propose_query', input }],
  });
  const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

  test('reads the forced tool call, which is the shape asked for', () => {
    expect(
      parseSuggestion(
        tool({
          query: 'forecasting min_faves:5',
          rationale: 'because',
          answer: '',
        }),
      ),
    ).toEqual({
      query: 'forecasting min_faves:5',
      rationale: 'because',
      answer: '',
    });
  });

  test('trims the query and tolerates a missing rationale', () => {
    expect(parseSuggestion(tool({ query: '  a OR b  ' }))).toEqual({
      query: 'a OR b',
      rationale: '',
      answer: '',
    });
  });

  test('a fenced json block still parses', () => {
    expect(parseSuggestion(text('```json\n{"query": "q1", "rationale": "r1"}\n```'))).toEqual({
      query: 'q1',
      rationale: 'r1',
      answer: '',
    });
  });

  test('a preamble before the object still parses', () => {
    expect(parseSuggestion(text('Here is the query:\n{"query": "q2", "rationale": "r2"}'))).toEqual({
      query: 'q2',
      rationale: 'r2',
      answer: '',
    });
  });

  test('Search suggestion came back unparseable: a reply that lost its closing brace still yields the query', () => {
    const raw =
      '{"query": "(\\"forecasting is useless\\" OR \\"nobody can predict\\") -filter:replies min_faves:5 lang:en", "rationale": "Surfaces original posts where people argue that forecasting does not work."';
    expect(parseSuggestion(text(raw))).toEqual({
      query: '("forecasting is useless" OR "nobody can predict") -filter:replies min_faves:5 lang:en',
      rationale: 'Surfaces original posts where people argue that forecasting does not work.',
      answer: '',
    });
  });

  test('a reply cut off inside the rationale still yields the query', () => {
    const raw = '{"query": "q3", "rationale": "this goes on and on and';
    expect(parseSuggestion(text(raw))).toEqual({
      query: 'q3',
      rationale: 'this goes on and on and',
      answer: '',
    });
  });

  test('reads a gateway reply, and the answer beside the query', () => {
    expect(
      parseSuggestion({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'propose_query',
                    arguments: '{"query":"q9","rationale":"r9","answer":"Narrower, as you asked."}',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toEqual({
      query: 'q9',
      rationale: 'r9',
      answer: 'Narrower, as you asked.',
    });
  });

  test('a reply with no query at all is the one failure, and says so', () => {
    expect(() => parseSuggestion(text('I cannot propose a query.'))).toThrow(/no query/);
    expect(() => parseSuggestion(text('{"rationale": "only this"}'))).toThrow(/no query/);
    expect(() => parseSuggestion(tool({ query: '   ' }))).toThrow(/no query/);
    expect(() => parseSuggestion({ content: [] })).toThrow(/no query/);
  });
});

describe('parseDraft', () => {
  // docs/x-workbench.md, "What the owner does" step 4: every turn comes back
  // as the revised text AND what it says to him. The forced tool call is the
  // shape asked for; a prose answer is still read rather than thrown away.
  const tool = (input: unknown) => ({
    content: [{ type: 'tool_use', name: 'draft', input }],
  });
  const text = (t: string) => ({ content: [{ type: 'text', text: t }] });

  test('reads the forced tool call: text, reason, and its answer to him', () => {
    expect(
      parseDraft(
        tool({
          text: 'A reply.',
          reason: 'number',
          answer: 'Led with the 6 of 8.',
        }),
      ),
    ).toEqual({
      text: 'A reply.',
      reason: 'number',
      answer: 'Led with the 6 of 8.',
    });
  });

  test('an empty text with reason skip is a legitimate answer, not a failure', () => {
    expect(parseDraft(tool({ text: '', reason: 'skip', answer: 'Nothing to add here.' }))).toEqual({
      text: '',
      reason: 'skip',
      answer: 'Nothing to add here.',
    });
  });

  test('a fenced or brace-less json answer still parses', () => {
    expect(parseDraft(text('```json\n{"text": "T", "reason": "test", "answer": "A"}\n```'))).toEqual({
      text: 'T',
      reason: 'test',
      answer: 'A',
    });
    expect(parseDraft(text('{"text": "T2", "reason": "test", "answer": "cut off'))).toEqual({
      text: 'T2',
      reason: 'test',
      answer: 'cut off',
    });
  });

  test('the older reply/note field names are still understood', () => {
    expect(parseDraft(tool({ reply: 'R', reason: 'disagree', note: 'N' }))).toEqual({
      text: 'R',
      reason: 'disagree',
      answer: 'N',
    });
  });

  test('plain prose with no object is taken as its answer, so nothing is lost and no prose lands in the draft', () => {
    expect(parseDraft(text('Just a sentence.'))).toEqual({
      text: '',
      reason: 'draft',
      answer: 'Just a sentence.',
    });
  });

  // docs/x-workbench.md, "Drafting": a slug with a provider prefix goes through
  // the gateway, whose replies have the OpenAI shape.
  test('reads a gateway reply: the tool call arguments, or prose as its answer', () => {
    const gw = (message: NonNullable<ProposalBody['choices']>[number]['message']) => ({ choices: [{ message }] });
    expect(
      parseDraft(
        gw({
          content: null,
          tool_calls: [
            {
              function: {
                name: 'draft',
                arguments: '{"text":"T","reason":"test","answer":"A"}',
              },
            },
          ],
        }),
      ),
    ).toEqual({ text: 'T', reason: 'test', answer: 'A' });
    expect(parseDraft(gw({ content: 'Only prose.' }))).toEqual({
      text: '',
      reason: 'draft',
      answer: 'Only prose.',
    });
  });
});

describe('a draft never carries an em-dash or an en-dash (docs/x-workbench.md, "Drafting")', () => {
  test('one the model wrote becomes a comma before he sees it', () => {
    expect(withoutDashes('Not a chart — an org structure.')).toBe('Not a chart, an org structure.');
    expect(withoutDashes('a—b')).toBe('a, b');
    expect(withoutDashes('2024–2026')).toBe('2024, 2026');
    expect(withoutDashes('a - b and -filter:replies')).toBe('a - b and -filter:replies');
  });
});

describe('the rules a drafted post obeys (docs/x-workbench.md, "Writing his own post")', () => {
  test('say link in the reply, no hashtags, the length band, and never bait', () => {
    expect(POST_RULES).toMatch(/link[\s\S]*first reply/i);
    expect(POST_RULES).toMatch(/hashtag/i);
    expect(POST_RULES).toMatch(/100 to 280/);
    expect(POST_RULES).toMatch(/bait/i);
    expect(POST_RULES).toMatch(/called-it\|test\|milestone\|demo\|quote\|correction\|other/);
  });
});
