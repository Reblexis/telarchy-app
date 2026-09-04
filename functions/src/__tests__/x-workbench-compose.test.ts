/**
 * The X workbench's own-post loop (docs/x-workbench.md, "Writing his own
 * post"): an idea becomes a post through a conversation that answers him,
 * a post is recorded with no source while a reply must have one, and the
 * log tells the two apart.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { xReplies } from '../db/schema';
import {
  askWorkbench,
  draftingConfigured,
  draftPost,
  draftReply,
  recordReply,
  saveSearch,
  suggestSearch,
} from '../services/x-workbench';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

function mockFetch(reply: (url: string) => unknown) {
  const calls: { url: string; headers: Record<string, string>; body: any }[] = [];
  global.fetch = jest.fn(async (url: any, init: any) => {
    calls.push({
      url: String(url),
      headers: init.headers,
      body: JSON.parse(init.body),
    });
    return {
      ok: true,
      status: 200,
      json: async () => reply(String(url)),
    } as any;
  }) as any;
  return calls;
}

function mockAnthropic(input: unknown, name = 'draft') {
  return mockFetch(() => ({ content: [{ type: 'tool_use', name, input }] }));
}

describe('draftPost', () => {
  const key = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = key;
  });

  test('an idea becomes a post, with the reason and its answer to him', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const calls = mockAnthropic({
      text: 'Season 0, week 2: 244 markets, 233 agents, 4 humans.\nThe humans are the hard part.',
      reason: 'milestone',
      answer: 'Led with the numbers you gave; the last line is the hook.',
    });
    const draft = await draftPost('we have 244 markets and 233 agents but only 4 humans', []);
    expect(draft).toEqual({
      post: 'Season 0, week 2: 244 markets, 233 agents, 4 humans.\nThe humans are the hard part.',
      reason: 'milestone',
      answer: 'Led with the numbers you gave; the last line is the hook.',
    });
    // The draft tool is offered and the idea is what it works from.
    expect(calls[0].body.tools[0].name).toBe('draft');
    expect(calls[0].body.messages[0].content).toContain('244 markets and 233 agents');
    expect(calls[0].body.system).toMatch(/first reply/i);
  });

  test('the whole argument is sent back, bounded, so "shorter" means shorter than the last one', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    const calls = mockAnthropic({
      text: 'Shorter.',
      reason: 'milestone',
      answer: 'Cut the second line.',
    });
    const turns = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));
    await draftPost('idea', turns);
    const sent = calls[0].body.messages;
    expect(sent[0].role).toBe('user');
    expect(sent).toHaveLength(13); // the opening plus the last twelve turns
    expect(sent[sent.length - 1].content).toBe('turn 19');
  });

  test('without a key it says so with 503 rather than calling nothing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(draftPost('idea', [])).rejects.toMatchObject({ status: 503 });
  });

  test('a reply draft also answers him', async () => {
    process.env.ANTHROPIC_API_KEY = 'test';
    mockAnthropic({
      text: 'HP beat its own forecasts in 6 of 8 cases.',
      reason: 'number',
      answer: 'You asked for the number first.',
    });
    const draft = await draftReply({ id: '1', text: 'Forecasting inside companies never works.' }, []);
    expect(draft).toEqual({
      reply: 'HP beat its own forecasts in 6 of 8 cases.',
      reason: 'number',
      answer: 'You asked for the number first.',
    });
  });
});

describe('the model and its effort (docs/x-workbench.md, "Drafting")', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('by default the draft goes to the Anthropic API as Opus 5, thinking adaptively at high effort', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    delete process.env.X_DRAFT_MODEL;
    delete process.env.X_DRAFT_EFFORT;
    const calls = mockAnthropic({ text: 'T', reason: 'test', answer: 'A' });
    await draftPost('idea', []);
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe('anth');
    expect(calls[0].body.model).toBe('claude-opus-5');
    expect(calls[0].body.thinking).toEqual({ type: 'adaptive' });
    expect(calls[0].body.output_config).toEqual({ effort: 'high' });
    // Fable refuses a forced tool choice, so the tool is offered, not forced.
    expect(calls[0].body.tool_choice).toBeUndefined();
  });

  test('X_DRAFT_EFFORT changes the effort without a deploy', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    process.env.X_DRAFT_EFFORT = 'max';
    const calls = mockAnthropic({ text: 'T', reason: 'test', answer: 'A' });
    await draftPost('idea', []);
    expect(calls[0].body.output_config).toEqual({ effort: 'max' });
  });

  test('a slug with a provider prefix goes through the gateway on the floor key, at the same effort', async () => {
    process.env.X_DRAFT_MODEL = 'openai/gpt-5.6-luna';
    process.env.AI_GATEWAY_API_KEY = 'gw';
    delete process.env.ANTHROPIC_API_KEY;
    const calls = mockFetch(() => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                function: {
                  name: 'draft',
                  arguments: '{"text":"L","reason":"test","answer":"From luna."}',
                },
              },
            ],
          },
        },
      ],
    }));
    const draft = await draftPost('idea', [
      { role: 'assistant', content: '{}' },
      { role: 'user', content: 'shorter' },
    ]);
    expect(draft).toEqual({ post: 'L', reason: 'test', answer: 'From luna.' });
    expect(calls[0].url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(calls[0].headers.Authorization).toBe('Bearer gw');
    expect(calls[0].body.model).toBe('openai/gpt-5.6-luna');
    expect(calls[0].body.reasoning_effort).toBe('high');
    expect(calls[0].body.tool_choice).toEqual({
      type: 'function',
      function: { name: 'draft' },
    });
    // The system prompt travels as the first message, then the conversation.
    expect(calls[0].body.messages[0].role).toBe('system');
    expect(calls[0].body.messages[calls[0].body.messages.length - 1]).toEqual({
      role: 'user',
      content: 'shorter',
    });
  });

  test("draftingConfigured follows the chosen transport's key", () => {
    delete process.env.X_DRAFT_MODEL;
    delete process.env.ANTHROPIC_API_KEY;
    process.env.AI_GATEWAY_API_KEY = 'gw';
    expect(draftingConfigured()).toBe(false);
    process.env.X_DRAFT_MODEL = 'openai/gpt-5.6-luna';
    expect(draftingConfigured()).toBe(true);
    delete process.env.AI_GATEWAY_API_KEY;
    expect(draftingConfigured()).toBe(false);
  });

  test('an em-dash the model wrote becomes a comma before he sees it', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    mockAnthropic({
      text: 'Not a chart — an org structure.',
      reason: 'test',
      answer: 'A — B',
    });
    const draft = await draftPost('idea', []);
    expect(draft.post).toBe('Not a chart, an org structure.');
    expect(draft.answer).toBe('A — B');
  });
});

describe('a refusal never reaches him as an empty draft (docs/x-workbench.md, "Drafting")', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const refusal = { stop_reason: 'refusal', content: [] };
  const drafted = {
    content: [
      {
        type: 'tool_use',
        name: 'draft',
        input: { text: 'T', reason: 'test', answer: 'A' },
      },
    ],
  };

  test('the model that refuses is retried once on the fallback, whose draft is what he gets', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    process.env.X_DRAFT_MODEL = 'claude-fable-5-1';
    delete process.env.X_DRAFT_FALLBACK;
    let n = 0;
    const calls = mockFetch(() => (n++ === 0 ? refusal : drafted));
    const draft = await draftPost('idea', []);
    expect(draft).toEqual({ post: 'T', reason: 'test', answer: 'A' });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.model).toBe('claude-fable-5-1');
    expect(calls[1].body.model).toBe('claude-opus-5');
  });

  test('X_DRAFT_FALLBACK names the second model, on its own transport', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    process.env.AI_GATEWAY_API_KEY = 'gw';
    process.env.X_DRAFT_MODEL = 'claude-fable-5-1';
    process.env.X_DRAFT_FALLBACK = 'openai/gpt-5.6-luna';
    let n = 0;
    const calls = mockFetch(() =>
      n++ === 0
        ? refusal
        : {
            choices: [
              {
                message: {
                  tool_calls: [
                    {
                      function: {
                        name: 'draft',
                        arguments: '{"text":"L","reason":"test","answer":"A"}',
                      },
                    },
                  ],
                },
              },
            ],
          },
    );
    const draft = await draftPost('idea', []);
    expect(draft.post).toBe('L');
    expect(calls[1].url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions');
    expect(calls[1].body.model).toBe('openai/gpt-5.6-luna');
  });

  test('when the fallback refuses too, it is an error he sees, not an empty draft', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    process.env.X_DRAFT_MODEL = 'claude-fable-5-1';
    const calls = mockFetch(() => refusal);
    await expect(draftPost('idea', [])).rejects.toMatchObject({
      status: 502,
      message: expect.stringMatching(/declined/),
    });
    expect(calls).toHaveLength(2);
  });

  test('a primary that is the fallback is not retried on itself', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    delete process.env.X_DRAFT_MODEL;
    const calls = mockFetch(() => refusal);
    await expect(draftReply({ id: '1', text: 'A claim.' }, [])).rejects.toMatchObject({ status: 502 });
    expect(calls).toHaveLength(1);
  });

  test('a reply with no content at all counts as a refusal, whatever the stop reason says', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    process.env.X_DRAFT_MODEL = 'claude-fable-5-1';
    let n = 0;
    const calls = mockFetch(() => (n++ === 0 ? { stop_reason: 'end_turn', content: [] } : drafted));
    const draft = await draftPost('idea', []);
    expect(draft.post).toBe('T');
    expect(calls).toHaveLength(2);
  });

  test('a skip is not a refusal: an empty text with reason skip and an answer comes through as is', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    delete process.env.X_DRAFT_MODEL;
    const calls = mockAnthropic({
      text: '',
      reason: 'skip',
      answer: 'Nothing to add.',
    });
    const draft = await draftReply({ id: '1', text: 'A claim.' }, []);
    expect(draft).toEqual({
      reply: '',
      reason: 'skip',
      answer: 'Nothing to add.',
    });
    expect(calls).toHaveLength(1);
  });
});

describe('arguing with a search suggestion', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('the turns go back after the record, and the answer comes with the query', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    const calls = mockAnthropic(
      {
        query: 'forecasting -filter:replies min_faves:20',
        rationale: 'Narrower.',
        answer: 'Raised min_faves, as you asked.',
      },
      'propose_query',
    );
    const s = await suggestSearch(
      ['old query'],
      [
        { role: 'assistant', content: '{"query":"forecasting"}' },
        { role: 'user', content: 'narrower' },
      ],
    );
    expect(s).toEqual({
      query: 'forecasting -filter:replies min_faves:20',
      rationale: 'Narrower.',
      answer: 'Raised min_faves, as you asked.',
    });
    const sent = calls[0].body.messages;
    expect(sent).toHaveLength(3);
    expect(sent[0].content).toMatch(/old query/);
    expect(sent[2]).toEqual({ role: 'user', content: 'narrower' });
    expect(calls[0].body.thinking).toEqual({ type: 'adaptive' });
  });
});

describe('recording a post of his own', () => {
  test('a post is recorded with no source and read back as kind post', async () => {
    const row = await recordReply({
      kind: 'post',
      text: 'Season 0, week 2: 244 markets.',
    });
    expect(row.kind).toBe('post');
    expect(row.sourcePostId).toBeNull();
    const [stored] = await db.select().from(xReplies);
    expect(stored.kind).toBe('post');
    expect(stored.sourcePostId).toBeNull();
    expect(stored.hasNumber).toBe(true);
  });

  test('a reply must have the post it answers', async () => {
    await expect(recordReply({ kind: 'reply', text: 'A reply.' })).rejects.toMatchObject({ status: 400 });
    await expect(recordReply({ text: 'A reply.' })).rejects.toMatchObject({
      status: 400,
    });
  });

  test('a reply is still recorded as before, kind reply by default', async () => {
    const row = await recordReply({ sourcePostId: '42', text: 'A reply.' });
    expect(row.kind).toBe('reply');
    expect(row.sourcePostId).toBe('42');
  });
});

describe('asking it what to post (docs/x-workbench.md, "Asking it what to post")', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  test('the answer rests on the playbook and his own record, and the question is the last turn', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    await saveSearch('forecasting -filter:replies', 'why');
    await recordReply({
      sourcePostId: '42',
      sourceAuthor: 'someone',
      text: 'HP beat its forecasts in 6 of 8.',
    });
    await recordReply({
      kind: 'post',
      text: '244 markets, 233 agents, 4 humans.',
    });
    const calls = mockAnthropic({ answer: 'Phase 1 is replies; your one reply has no metrics yet.' }, 'answer');
    const r = await askWorkbench([{ role: 'user', content: 'what should i post this week?' }]);
    expect(r.answer).toBe('Phase 1 is replies; your one reply has no metrics yet.');
    const body = calls[0].body;
    expect(body.system).toMatch(/PLAYBOOK/);
    expect(body.system).toMatch(/link[^\n]*first reply/i);
    expect(body.system).toContain('forecasting -filter:replies');
    expect(body.system).toContain('HP beat its forecasts in 6 of 8.');
    expect(body.system).toContain('244 markets, 233 agents, 4 humans.');
    expect(body.messages[body.messages.length - 1]).toEqual({
      role: 'user',
      content: 'what should i post this week?',
    });
    expect(body.tools[0].name).toBe('answer');
  });

  test('prose instead of the tool is still the answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    mockFetch(() => ({ content: [{ type: 'text', text: 'Just prose.' }] }));
    const r = await askWorkbench([{ role: 'user', content: 'q' }]);
    expect(r.answer).toBe('Just prose.');
  });

  test('the conversation is bounded to the last twenty turns', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    const calls = mockAnthropic({ answer: 'A' }, 'answer');
    const turns = Array.from({ length: 30 }, (_, i) => ({
      role: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
      content: `turn ${i}`,
    }));
    await askWorkbench(turns);
    expect(calls[0].body.messages).toHaveLength(20);
    expect(calls[0].body.messages[19].content).toBe('turn 29');
  });

  test('without a question there is nothing to answer', async () => {
    process.env.ANTHROPIC_API_KEY = 'anth';
    await expect(askWorkbench([])).rejects.toMatchObject({ status: 400 });
  });

  test('without a key it says so with 503', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(askWorkbench([{ role: 'user', content: 'q' }])).rejects.toMatchObject({ status: 503 });
  });
});
