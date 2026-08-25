/**
 * The workspace brief (GET /api/marketplace/:id/context) and the Ask door on
 * top of it.
 *
 * Two things this pins, both of which are promises to somebody:
 *  - a document the owner has NOT published is not in the brief, however
 *    convenient it would be for the answer;
 *  - the brief's contract impact is the same number the floor's ballot
 *    shows, because it comes from the same function.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (_req: any, _res: any, next: any) => next(),
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import {
  agents,
  floorQuestions,
  markets,
  metricLogs,
  metrics,
  permissionGroups,
  proposals,
  sources,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { buildWorkspaceContext, renderContextMarkdown } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-ctx';

async function seed(opts: { publicCaps?: string[]; publishDocument?: boolean } = {}) {
  const { publicCaps = ['read', 'trade'], publishDocument = true } = opts;
  await db.insert(agents).values({ id: 'owner', apiKeyHash: 'h-owner', balance: 0, nickname: 'owner' });
  await db.insert(workspaces).values({
    id: WS,
    name: 'LookPilot',
    createdBy: 'owner',
    visibility: 'public',
    slug: 'lookpilot',
    description: 'Webcam head tracking for simulator games.',
    charter: 'I ship what the market ranks highest, or I say why not.',
  });
  await db.insert(sources).values([
    {
      id: 'src-room',
      workspaceId: WS,
      name: 'Data room',
      description: 'The numbers behind the numbers',
      type: 'text',
      content: 'Revenue is Steam developer share plus Stripe. 17 languages.',
    },
    { id: 'src-private', workspaceId: WS, name: 'Payroll', description: '', type: 'text', content: 'SECRET SALARIES' },
  ]);
  await db.insert(permissionGroups).values({
    id: 'grp-pub',
    workspaceId: WS,
    name: 'Public',
    type: 'public',
    capabilities: publicCaps,
    memberIds: [],
    // Only the data room is published; payroll is not.
    sourcePermissions: publishDocument ? { 'src-room': { read: true } } : {},
  });
  await db.insert(metrics).values({
    id: 'metric-1',
    workspaceId: WS,
    name: 'Revenue this week',
    description: 'Steam plus Stripe, gross.',
    value: 1234,
    marketRangeMax: 5000,
  });
  await db.insert(metricLogs).values({
    id: 'log-1',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Revenue this week',
    value: 1000,
    timestamp: new Date('2026-08-01'),
  });
  await db.insert(markets).values({
    id: 'mkt-hero',
    workspaceId: WS,
    metricId: 'metric-1',
    metricName: 'Revenue this week',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 5000,
    shares: [0, 0],
    liquidity: 50,
    pool: initialPool(50),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
  await db.insert(proposals).values({
    id: 'prop-1',
    workspaceId: WS,
    proposedBy: 'owner',
    title: '$200: rewrite the store page',
    description: 'Better copy, better conversion.',
    askUsd: 200,
    status: 'pending',
  });
}

describe('the workspace brief', () => {
  test('carries the company, its numbers, its markets and its contracts', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('LookPilot');
    expect(res.body.charter).toContain('ship what the market ranks highest');
    expect(res.body.metrics[0].name).toBe('Revenue this week');
    expect(res.body.metrics[0].history).toEqual([{ at: '2026-08-01', value: 1000 }]);
    expect(res.body.markets[0].metricName).toBe('Revenue this week');
    expect(res.body.contracts[0].title).toContain('rewrite the store page');
    expect(res.body.contracts[0].askUsd).toBe(200);
  });

  test('includes a PUBLISHED document and never an unpublished one', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    const names = res.body.documents.map((d: { name: string }) => d.name);
    expect(names).toEqual(['Data room']);
    expect(JSON.stringify(res.body)).not.toContain('SECRET SALARIES');
  });

  test('a source nobody published stays out even when it is the only one', async () => {
    await seed({ publishDocument: false });
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.body.documents).toEqual([]);
  });

  test('a workspace whose Public group cannot read is refused, not summarised', async () => {
    await seed({ publicCaps: [] });
    const res = await request(app).get(`/api/marketplace/${WS}/context`);
    expect(res.status).toBe(403);
  });

  test('?format=md is the same facts as one readable brief', async () => {
    await seed();
    const res = await request(app).get(`/api/marketplace/${WS}/context?format=md`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('markdown');
    expect(res.text).toContain('# LookPilot');
    expect(res.text).toContain('Revenue this week');
    expect(res.text).toContain('rewrite the store page');
    expect(res.text).toContain('Data room');
    expect(res.text).not.toContain('SECRET SALARIES');
  });
});

describe('asking the floor', () => {
  test('is off, and says so, when no model is configured', async () => {
    await seed();
    delete process.env.AI_GATEWAY_API_KEY;
    const res = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'What do you sell?' });
    expect(res.status).toBe(503);
  });

  test('refuses an empty or oversized question before spending anything', async () => {
    await seed();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const empty = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: '   ' });
    expect(empty.status).toBe(400);
    const huge = await request(app)
      .post(`/api/marketplace/${WS}/ask`)
      .send({ question: 'x'.repeat(501) });
    expect(huge.status).toBe(400);
    delete process.env.AI_GATEWAY_API_KEY;
  });
});

describe('every question is kept', () => {
  test('a failed answer is logged with its reason, not dropped', async () => {
    await seed();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const realFetch = global.fetch;
    // The gateway is down (or the budget is spent): the visitor gets a 502,
    // and the row survives, because a question nobody could answer is the
    // most interesting row in the table.
    global.fetch = jest.fn(async () => new Response('no budget', { status: 402 })) as any;

    const res = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'What do you sell?' });
    expect(res.status).toBe(502);

    const rows = await db.select().from(floorQuestions);
    expect(rows).toHaveLength(1);
    expect(rows[0].question).toBe('What do you sell?');
    expect(rows[0].error).toContain('402');
    expect(rows[0].answer).toBe('');
    // Anonymous is the normal case: the field exists for visitors with no
    // account yet.
    expect(rows[0].askedBy).toBeNull();

    global.fetch = realFetch;
    delete process.env.AI_GATEWAY_API_KEY;
  });

  test('an answered question is kept with its answer and its cost', async () => {
    await seed();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const realFetch = global.fetch;
    global.fetch = jest.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'Webcam head tracking, $14.99 on Steam.' } }],
            usage: { prompt_tokens: 4000, completion_tokens: 40, cost: 0.0009 },
          }),
          { status: 200 },
        ),
    ) as any;

    const res = await request(app).post(`/api/marketplace/${WS}/ask`).send({ question: 'What do you sell?' });
    expect(res.status).toBe(200);
    expect(res.body.answer).toContain('Webcam head tracking');

    const [row] = await db.select().from(floorQuestions);
    expect(row.answer).toContain('Webcam head tracking');
    expect(row.costUsd).toBeCloseTo(0.0009);
    expect(row.error).toBeNull();

    global.fetch = realFetch;
    delete process.env.AI_GATEWAY_API_KEY;
  });
});

describe('a conversation, not a lookup', () => {
  test('the turns so far are sent, so a follow-up means something', async () => {
    await seed();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const realFetch = global.fetch;
    let sent: any = null;
    global.fetch = jest.fn(async (_u: any, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Both, but Steam is most of it.' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0.00001 },
        }),
        { status: 200 },
      );
    }) as any;

    const res = await request(app)
      .post(`/api/marketplace/${WS}/ask`)
      .send({
        messages: [
          { role: 'user', content: 'How do you make money?' },
          { role: 'assistant', content: 'Steam sales and Stripe.' },
          { role: 'user', content: 'Which one is bigger?' },
        ],
      });
    expect(res.status).toBe(200);

    // System turn plus the three, in order: without the assistant turn the
    // follow-up is a question about nothing.
    expect(sent.messages.map((m: any) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(sent.messages[3].content).toBe('Which one is bigger?');
    // The row logs the question actually asked, which is the last user turn.
    const [row] = await db.select().from(floorQuestions);
    expect(row.question).toBe('Which one is bigger?');

    global.fetch = realFetch;
    delete process.env.AI_GATEWAY_API_KEY;
  });

  test('a conversation that does not end on a question is refused', async () => {
    await seed();
    process.env.AI_GATEWAY_API_KEY = 'test-key';
    const res = await request(app)
      .post(`/api/marketplace/${WS}/ask`)
      .send({
        messages: [{ role: 'assistant', content: 'Anything else?' }],
      });
    expect(res.status).toBe(400);
    delete process.env.AI_GATEWAY_API_KEY;
  });
});

describe('the answer prompt', () => {
  test('is a person with opinions, not a support agent', async () => {
    // Owner direction 2026-08-20: "it should be just a guy with personality"
    // and "it should not be so restricted it should give advice". The two
    // halves that must survive a later edit: he is allowed to have a view,
    // and he is never allowed to invent a number.
    const { readFileSync } = await import('fs');
    const prompt = readFileSync(`${__dirname}/../lib/ask.ts`, 'utf8');
    expect(prompt).toContain('You are Otto');
    expect(prompt).toContain('what you would do');
    expect(prompt).toContain('Never invent a number');
  });

  test('bans markdown, which the floor would print as asterisks', async () => {
    // The first live answer came back with **bold** in it, and .askfloor-a
    // renders text, not markdown, so the reader saw the asterisks.
    const { readFileSync } = await import('fs');
    expect(readFileSync(`${__dirname}/../lib/ask.ts`, 'utf8')).toContain('Never markdown');
  });

  test('bans the dash the house style bans', async () => {
    // The answer is user-facing copy on the owner's own site, and the one
    // typographic rule this repo has is no em dashes. A model writes them by
    // default, so the prompt has to say so.
    const { readFileSync } = await import('fs');
    const prompt = readFileSync(`${__dirname}/../lib/ask.ts`, 'utf8');
    expect(prompt).toContain('Never an em dash');
  });
});

describe('the brief and the floor agree', () => {
  test('an unpriced contract reports no delta rather than zero', async () => {
    await seed();
    const ctx = (await buildWorkspaceContext(WS))!;
    // No conditional markets exist, so there is nothing priced yet. Zero
    // would read as "the market says this changes nothing", which is a
    // different and much stronger claim than "nobody has priced it".
    expect(ctx.contracts[0].impact).toEqual([]);
    expect(renderContextMarkdown(ctx)).not.toContain('difference 0');
  });
});
