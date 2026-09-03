/**
 * The X workbench's own-post loop (docs/x-workbench.md, "Writing his own
 * post"): an idea becomes a post through a conversation that answers him,
 * a post is recorded with no source while a reply must have one, and the
 * log tells the two apart.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

import { xReplies } from '../db/schema';
import { draftPost, draftReply, recordReply } from '../services/x-workbench';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

function mockAnthropic(input: unknown) {
  const calls: any[] = [];
  global.fetch = jest.fn(async (_url: any, init: any) => {
    calls.push(JSON.parse(init.body));
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: 'tool_use', name: 'draft', input }],
      }),
    } as any;
  }) as any;
  return calls;
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
    // The request is a forced tool call, and the idea is what it works from.
    expect(calls[0].tool_choice).toEqual({ type: 'tool', name: 'draft' });
    expect(calls[0].messages[0].content).toContain('244 markets and 233 agents');
    expect(calls[0].system).toMatch(/first reply/i);
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
    const sent = calls[0].messages;
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
