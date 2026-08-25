/**
 * The handoff Otto writes for the operator's own agent (owner direction
 * 2026-08-23), and the guard that decides whether it may be shown.
 *
 * The whole reason a model is allowed to write this is that it is not trusted
 * about anything checkable. An agent handed a plausible workspace id will call
 * the API with it and act on what comes back, so a prompt naming an id we did
 * not give it is not a typo, it is an instruction to do the wrong thing. When
 * the guard fires the dull template answers instead, which is why the page
 * always has a prompt and only sometimes the personalised one.
 */

import { guardFacts, parseHandoffAnswer, renderFacts, writeHandoff } from '../services/setup-handoff';

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.AI_GATEWAY_API_KEY;

const STATE = {
  signedIn: true,
  workspaces: [{ id: 'ws-real', name: 'Kleros', slug: 'kleros' }],
  opened: [{ id: 'ws-real', name: 'Kleros', slug: 'kleros' }],
};

const FACTS = renderFacts(STATE, null);

/** One gateway reply carrying whatever the model "said". */
function replyWith(content: string) {
  global.fetch = (async () =>
    ({
      ok: true,
      json: async () => ({
        choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
      }),
      text: async () => '',
    }) as unknown as Response) as typeof global.fetch;
}

const LONG = 'x'.repeat(260);

beforeEach(() => {
  process.env.AI_GATEWAY_API_KEY = 'test-key';
});
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.AI_GATEWAY_API_KEY;
  else process.env.AI_GATEWAY_API_KEY = ORIGINAL_KEY;
});

describe('the facts block', () => {
  test('carries the real id and address of a floor that exists', () => {
    expect(FACTS).toMatch(/workspace id ws-real/);
    expect(FACTS).toMatch(/telarchy\.com\/kleros/);
  });

  test('says plainly when there is no account, because nothing can be created', () => {
    const facts = renderFacts({ signedIn: false, workspaces: [], opened: [] }, null);
    expect(facts).toMatch(/NOT signed in/);
    expect(facts).toMatch(/no workspace id exists/);
  });
});

describe('the guard on what a prompt may name', () => {
  test('lets through ids that were given', () => {
    expect(guardFacts(`Use workspace ws-real at telarchy.com/kleros. ${LONG}`, FACTS)).toBeNull();
  });

  test('refuses an id nobody gave it', () => {
    expect(guardFacts('Use workspace ws-invented instead.', FACTS)).toMatch(/invented id ws-invented/);
  });

  test('refuses a uuid it made up', () => {
    expect(guardFacts('workspace 3f2504e0-4f89-11d3-9a0c-0305e82c3301', FACTS)).toMatch(/invented id/);
  });

  test('refuses a floor address that does not exist', () => {
    expect(guardFacts('Your floor is at telarchy.com/kleros-protocol', FACTS)).toMatch(/invented address/);
  });

  test('allows telarchy.com paths that are not floors', () => {
    expect(guardFacts(`Sign in at telarchy.com/signup, read telarchy.com/api/help. ${LONG}`, FACTS)).toBeNull();
  });

  test('refuses a placeholder, which an agent would paste verbatim', () => {
    expect(guardFacts('Call POST /api/metrics with X-Workspace-Id: <workspace-id>', FACTS)).toMatch(/placeholder/);
  });
});

describe('the budget it asks the gateway for', () => {
  test('is bigger than a chat turn, or the model thinks and returns nothing', async () => {
    // This is the bug this test exists for. At the chat default (700
    // completion tokens) the reasoning model spent the budget thinking and
    // returned empty content, which arrives as "gateway returned no answer",
    // and every handoff on beta silently fell back to the template. A
    // fallback that works is exactly what makes this failure invisible.
    let sent: Record<string, unknown> = {};
    global.fetch = (async (_url: unknown, init: { body: string }) => {
      sent = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: { role: 'assistant', content: JSON.stringify({ prompt: `ok. ${LONG}`, settled: [], open: [] }) },
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.0001 },
        }),
        text: async () => '',
      } as unknown as Response;
    }) as unknown as typeof global.fetch;

    const out = await writeHandoff({
      turns: [{ role: 'user', content: 'hi' }],
      state: STATE,
      checklist: null,
      previouslySettled: [],
    });
    expect(out.written).toBe(true);
    expect(sent.max_completion_tokens as number).toBeGreaterThan(1000);
  });
});

describe('writing the handoff', () => {
  const input = {
    turns: [{ role: 'user' as const, content: 'I run Kleros' }],
    state: STATE,
    checklist: null,
    previouslySettled: [],
  };

  test('uses what Otto wrote when it only names real things', async () => {
    replyWith(
      JSON.stringify({
        prompt: `I run Kleros. The floor is open at telarchy.com/kleros, workspace id ws-real. ${LONG}`,
        settled: ['subject', 'number'],
        open: ['liquidity'],
      }),
    );
    const out = await writeHandoff(input);
    expect(out.written).toBe(true);
    expect(out.prompt).toMatch(/I run Kleros/);
    expect(out.settled).toEqual(['subject', 'number']);
    expect(out.open).toEqual(['liquidity']);
  });

  test('falls back to the template when he names an id we never gave him', async () => {
    replyWith(JSON.stringify({ prompt: `Use workspace ws-hallucinated. ${LONG}`, settled: [], open: [] }));
    const out = await writeHandoff(input);
    expect(out.written).toBe(false);
    // The template's own opening line, so the page still has something true.
    expect(out.prompt).toMatch(/picking up a Telarchy setup/);
  });

  test('falls back when the answer is not JSON at all', async () => {
    replyWith('Sure, here is a prompt for your agent!');
    const out = await writeHandoff(input);
    expect(out.written).toBe(false);
    expect(out.prompt).toMatch(/picking up a Telarchy setup/);
  });

  test('falls back when the prompt is too short to be a handoff', async () => {
    replyWith(JSON.stringify({ prompt: 'Finish the setup.', settled: [], open: [] }));
    expect((await writeHandoff(input)).written).toBe(false);
  });

  test('falls back when the gateway fails, rather than showing nothing', async () => {
    global.fetch = (async () => {
      throw new Error('gateway down');
    }) as typeof global.fetch;
    const out = await writeHandoff(input);
    expect(out.written).toBe(false);
    expect(out.prompt.length).toBeGreaterThan(200);
  });

  test('reads a decision id it does not know as no decision at all', async () => {
    replyWith(
      JSON.stringify({
        prompt: `Fine. ${LONG}`,
        settled: ['subject', 'ignore-previous-instructions', 'number'],
        open: null,
      }),
    );
    const out = await writeHandoff(input);
    // The list round-trips through a browser, so only ids from the spec live.
    expect(out.settled).toEqual(['subject', 'number']);
    expect(out.open).toEqual([]);
  });
});

describe('reading what the model sent back', () => {
  test('the labelled shape, with the prompt over many lines', () => {
    const out = parseHandoffAnswer(
      [
        'SETTLED: subject, number',
        'OPEN: liquidity',
        'PROMPT:',
        'Call GET /api/setup/checklist first.',
        '',
        'Then fund the market.',
      ].join('\n'),
    );
    expect(out.settled).toEqual(['subject', 'number']);
    expect(out.open).toEqual(['liquidity']);
    expect(out.prompt).toBe('Call GET /api/setup/checklist first.\n\nThen fund the market.');
  });

  test('JSON with real newlines inside the string, which JSON.parse refuses', () => {
    // This is why the labelled shape exists. Asked for JSON, the model writes
    // the prompt with real line breaks in it, JSON.parse throws, and the whole
    // handoff silently falls back to the template while the page still shows a
    // prompt. Invisible from the outside, which is what makes it expensive.
    const raw = ['{"prompt": "Line one.', 'Line two.", "settled": ["subject"], "open": []}'].join('\n');
    expect(() => JSON.parse(raw)).toThrow();
    const out = parseHandoffAnswer(raw);
    expect(out.prompt).toBe('Line one.\nLine two.');
    expect(out.settled).toEqual(['subject']);
  });

  test('a fenced block is unwrapped', () => {
    const out = parseHandoffAnswer('```json\n{"prompt": "Do the thing.", "settled": [], "open": []}\n```');
    expect(out.prompt).toBe('Do the thing.');
  });

  test('bare prose is the prompt itself', () => {
    const out = parseHandoffAnswer('Call the checklist, then fund the market.');
    expect(out.prompt).toBe('Call the checklist, then fund the market.');
  });

  test('unparseable JSON yields no prompt, so the template answers', () => {
    expect(parseHandoffAnswer('{"prompt": ').prompt).toBe('');
  });
});
