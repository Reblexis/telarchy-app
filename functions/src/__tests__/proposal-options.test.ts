/**
 * Proposals with options (docs/guides/proposals.md, "More than two options";
 * docs/vision.md, "Options"; docs/data-room.md, the proposal and decision
 * rows).
 *
 * A proposal may carry two to six options in place of the approve/decline
 * pair. One market per option per priced (metric, date), branch set to the
 * option id, each opening where the approved branch would. Each option's
 * delta is its consensus minus the best of the others, the row's delta is
 * the leader's lead. Approving names the option: its markets stay live,
 * every other option's void and refund at net cash. Decline, spam, remove,
 * withdraw and lapse void every option. The data room records the labels
 * on the posting and the chosen option on the decision.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(['read', 'trade', 'manage', 'manage_workspace']),
    };
    next();
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  notifyOwner: async () => {},
  sendEmail: async () => true,
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import { agents, markets, metrics, proposals, workspaces } from '../db/schema';
import { consensus, initialPool } from '../lib/amm';
import { apiErrorHandler } from '../lib/api-error-handler';
import { branchIsShown } from '../lib/market-pairs';
import { provisionWorkspace } from '../lib/participants';
import { optionDeltas, parseProposalOptions } from '../lib/proposal-options';
import { proposalMetaText } from '../lib/share-meta';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { dataRoomRouter } from '../routes/data-room';
import { marketplaceRouter, resolveProposalShare } from '../routes/marketplace';
import { predictionsRouter } from '../routes/predictions';
import { proposalsRouter } from '../routes/proposals';
import { clearDataRoomCache } from '../services/data-room';
import { voidMarket } from '../services/markets';
import { conditionalBranchToSettle } from '../services/predictions';
import {
  declineProposalAsSpam,
  editProposalDefinition,
  lapseOverdueProposals,
  removeProposal,
  withdrawProposal,
} from '../services/proposals';
import { buildWorkspaceContext, renderContextMarkdown } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/predictions', authMiddleware, predictionsRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/data-room', dataRoomRouter);
app.use(apiErrorHandler);

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
});

const WS = 'ws-options';
const OWNER = 'agent-opt-owner';
const PROPOSER = 'agent-opt-proposer';
const TRADER = 'agent-opt-trader';
const METRIC = 'metric-opt';
const BASE = 'mkt-opt-base';
const TARGET = '2099';
const OPTIONS = [
  { id: 'left', label: 'Turn left' },
  { id: 'right', label: 'Turn right' },
  { id: 'up', label: 'Go up' },
];

let slug = '';

async function seed(metricName = 'Snake length') {
  await db.insert(agents).values([
    { id: OWNER, apiKeyHash: 'h-opt-owner', balance: toUnits(10_000) },
    { id: PROPOSER, apiKeyHash: 'h-opt-proposer', balance: toUnits(1000) },
    { id: TRADER, apiKeyHash: 'h-opt-trader', balance: toUnits(1000) },
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await provisionWorkspace(db as any, {
    wsId: WS,
    name: 'Options floor',
    createdBy: OWNER,
    ownerAgentId: OWNER,
    visibility: 'public',
  });
  const [ws] = await db.select({ slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, WS));
  slug = ws.slug as string;
  await db.insert(metrics).values({
    id: METRIC,
    workspaceId: WS,
    name: metricName,
    value: 40,
    formula: '0',
    marketRangeMax: 100,
  });
  await db.insert(markets).values({
    id: BASE,
    workspaceId: WS,
    metricId: METRIC,
    metricName: metricName,
    targetDate: TARGET,
    rangeMin: 0,
    rangeMax: 100,
    // Off the centre, so an anchored open is distinguishable from a centre open.
    shares: [0, 30],
    liquidity: 100,
    pool: initialPool(100),
    active: true,
    resolved: false,
    voided: false,
    proposalId: null,
    branch: null,
  });
}

const as = (agent: string) => ({ 'x-test-agent-id': agent, 'x-workspace-id': WS });

async function post(body: Record<string, unknown>, agent = PROPOSER) {
  return request(app).post('/api/proposals').set(as(agent)).send(body);
}

async function postOptions(extra: Record<string, unknown> = {}) {
  const res = await post({ title: 'Which way', options: OPTIONS, liquiditySubsidy: 30, ...extra });
  expect(res.status).toBe(201);
  return res.body as { id: string; options: unknown; conditionalMarketIds: string[] };
}

async function marketsOf(proposalId: string) {
  return db
    .select()
    .from(markets)
    .where(and(eq(markets.workspaceId, WS), eq(markets.proposalId, proposalId)));
}

function priceOf(m: { shares: unknown; liquidity: number; rangeMin: number; rangeMax: number }) {
  return consensus((m.shares as [number, number]) || [0, 0], m.liquidity, m.rangeMin, m.rangeMax) ?? null;
}

async function branchRow(proposalId: string, branch: string) {
  const rows = await marketsOf(proposalId);
  const row = rows.find(r => r.branch === branch);
  if (!row) throw new Error(`no ${branch} market`);
  return row;
}

/** Push one option's book up or down by hand, the way a trade would. */
async function setShares(proposalId: string, branch: string, shares: [number, number]) {
  const row = await branchRow(proposalId, branch);
  await db
    .update(markets)
    .set({ shares })
    .where(and(eq(markets.id, row.id), eq(markets.workspaceId, WS)));
}

async function setLiquidity(proposalId: string, branch: string, liquidity: number) {
  const row = await branchRow(proposalId, branch);
  await db
    .update(markets)
    .set({ liquidity, pool: liquidity > 0 ? initialPool(liquidity) : 0 })
    .where(and(eq(markets.id, row.id), eq(markets.workspaceId, WS)));
}

async function detail(proposalId: string, agent = OWNER) {
  const res = await request(app).get(`/api/proposals/${proposalId}`).set(as(agent));
  expect(res.status).toBe(200);
  return res.body;
}

async function approve(proposalId: string, body: Record<string, unknown> = {}) {
  return request(app).post(`/api/proposals/${proposalId}/approve`).set(as(OWNER)).send(body);
}

async function balanceOf(agent: string): Promise<number> {
  const [row] = await db.select({ balance: agents.balance }).from(agents).where(eq(agents.id, agent));
  return row.balance as number;
}

async function tradeOn(marketId: string, agent = TRADER, amount = 50) {
  const res = await request(app)
    .post('/api/predictions/trade')
    .set(as(agent))
    .send({ marketId, direction: 'higher', amount });
  expect(res.status).toBe(201);
}

async function proposalRow(proposalId: string) {
  const [row] = await db
    .select()
    .from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, WS)));
  return row;
}

function expectAllVoided(rows: Array<{ voided: boolean; resolved: boolean }>) {
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) {
    expect(r.voided).toBe(true);
    expect(r.resolved).toBe(true);
  }
}

describe('the option list is validated at the door', () => {
  test('the parser accepts two to six well-formed options and refuses everything else', () => {
    expect(parseProposalOptions(undefined)).toEqual({ ok: true, options: null });
    expect(parseProposalOptions(null)).toEqual({ ok: true, options: null });
    const two = parseProposalOptions([
      { id: 'a', label: 'A' },
      { id: 'b-2', label: 'B' },
    ]);
    expect(two).toEqual({
      ok: true,
      options: [
        { id: 'a', label: 'A' },
        { id: 'b-2', label: 'B' },
      ],
    });
    const bad = (raw: unknown) => {
      const r = parseProposalOptions(raw);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.error;
    };
    expect(bad([{ id: 'a', label: 'A' }])).toMatch(/two/i);
    expect(bad('left,right')).toMatch(/options/i);
    expect(bad(Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `O ${i}` })))).toMatch(/six/i);
    expect(
      bad([
        { id: 'a', label: 'A' },
        { id: 'a', label: 'B' },
      ]),
    ).toMatch(/unique|twice|duplicate/i);
    expect(
      bad([
        { id: 'approved', label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/approved/);
    expect(
      bad([
        { id: 'declined', label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/declined/);
    expect(
      bad([
        { id: 'Left', label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/id/);
    expect(
      bad([
        { id: 'a'.repeat(25), label: 'A' },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/id/);
    expect(
      bad([
        { id: 'a', label: '' },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/label/);
    expect(
      bad([
        { id: 'a', label: 'x'.repeat(41) },
        { id: 'b', label: 'B' },
      ]),
    ).toMatch(/label|40/);
  });

  test.each([
    ['one option', [OPTIONS[0]]],
    ['seven options', Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, label: `Option ${i}` }))],
    ['a duplicate id', [OPTIONS[0], OPTIONS[0]]],
    ['the id approved', [{ id: 'approved', label: 'Yes' }, OPTIONS[1]]],
    ['the id declined', [{ id: 'declined', label: 'No' }, OPTIONS[1]]],
    ['an id with capitals', [{ id: 'Left', label: 'Left' }, OPTIONS[1]]],
    ['an empty label', [{ id: 'a', label: '' }, OPTIONS[1]]],
    ['a 41-character label', [{ id: 'a', label: 'x'.repeat(41) }, OPTIONS[1]]],
    ['options that are not a list', 'left,right'],
  ])('POST /api/proposals with %s is a 400 that leaves no proposal behind', async (_name, options) => {
    await seed();
    const res = await post({ title: 'Which way', options });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    const rows = await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.workspaceId, WS));
    expect(rows).toEqual([]);
  });
});

describe('one world per option', () => {
  test('spawns one market per option per date, branch set to the option id, and no approved or declined world', async () => {
    await seed();
    const body = await postOptions();
    expect(body.options).toEqual(OPTIONS);
    const rows = await marketsOf(body.id);
    expect(rows.map(r => r.branch).sort()).toEqual(['left', 'right', 'up']);
    expect(rows.every(r => r.targetDate === TARGET && r.metricId === METRIC)).toBe(true);
    expect(body.conditionalMarketIds.sort()).toEqual(rows.map(r => r.id).sort());
    const stored = await proposalRow(body.id);
    expect(stored.options).toEqual(OPTIONS);
    expect(stored.decidedOption).toBeNull();
  });

  test('every option opens where the approved branch of a two-branch proposal with the same ask would', async () => {
    // A metric the ask burns out of, so the approved-like anchor differs
    // from the declined one and the rule is observable.
    await seed('Net revenue (USD)');
    const plain = await post({
      title: '$10: plain',
      askUsd: 10,
      payoutHandle: 'pay@example.com',
      liquiditySubsidy: 30,
    });
    expect(plain.status).toBe(201);
    const withOptions = await postOptions({ title: '$10: which', askUsd: 10, payoutHandle: 'pay@example.com' });
    const approved = priceOf(await branchRow(plain.body.id, 'approved'));
    const declined = priceOf(await branchRow(plain.body.id, 'declined'));
    expect(approved).not.toBeNull();
    expect(approved).not.toBeCloseTo(declined as number, 6);
    for (const row of await marketsOf(withOptions.id)) {
      expect(priceOf(row)).toBeCloseTo(approved as number, 6);
    }
  });

  test('the proposer is charged the subsidy once per option market, not once per pair', async () => {
    await seed();
    const before = await balanceOf(PROPOSER);
    await postOptions({ liquiditySubsidy: 30 });
    expect(before - (await balanceOf(PROPOSER))).toBe(toUnits(90));
  });

  test('POST /api/predictions/markets/liquidity/bulk with proposalId funds every option market', async () => {
    await seed();
    const { id } = await postOptions();
    const before = new Map((await marketsOf(id)).map(m => [m.id, m.pool]));
    const res = await request(app)
      .post('/api/predictions/markets/liquidity/bulk')
      .set(as(OWNER))
      .send({ amount: 10, proposalId: id });
    expect(res.status).toBe(200);
    const after = await marketsOf(id);
    expect(after).toHaveLength(3);
    for (const m of after) expect(m.pool - (before.get(m.id) ?? 0)).toBeCloseTo(10, 6);
  });

  test('changing the ask while nobody has traded re-anchors every option, not just two', async () => {
    await seed('Net revenue (USD)');
    const { id } = await postOptions({ title: '$10: which', askUsd: 10, payoutHandle: 'pay@example.com' });
    const before = priceOf(await branchRow(id, 'left'));
    const result = await editProposalDefinition(
      id,
      WS,
      { title: '$40: which', askUsd: 40 },
      { agentId: PROPOSER, canManage: false },
    );
    expect(result.reanchored).toBe(true);
    const live = (await marketsOf(id)).filter(m => !m.voided);
    expect(live.map(m => m.branch).sort()).toEqual(['left', 'right', 'up']);
    for (const m of live) expect(priceOf(m)).toBeCloseTo((before as number) - 30, 6);
  });
});

describe('the number you are reading', () => {
  test('the pure rule: an option delta is its consensus minus the best other, the row delta is the leader lead', () => {
    const r = optionDeltas([
      { id: 'a', consensus: 50 },
      { id: 'b', consensus: 42 },
      { id: 'c', consensus: 30 },
    ]);
    expect(r.leaderId).toBe('a');
    expect(r.rowDelta).toBeCloseTo(8, 9);
    expect(r.deltas.get('a')).toBeCloseTo(8, 9);
    expect(r.deltas.get('b')).toBeCloseTo(-8, 9);
    expect(r.deltas.get('c')).toBeCloseTo(-20, 9);
  });

  test('the pure rule: an unpriced option has no delta, and fewer than two priced options means no leader', () => {
    const one = optionDeltas([
      { id: 'a', consensus: 50 },
      { id: 'b', consensus: null },
      { id: 'c', consensus: 30 },
    ]);
    expect(one.deltas.get('b')).toBeNull();
    expect(one.deltas.get('a')).toBeCloseTo(20, 9);
    expect(one.rowDelta).toBeCloseTo(20, 9);
    const none = optionDeltas([
      { id: 'a', consensus: 50 },
      { id: 'b', consensus: null },
      { id: 'c', consensus: null },
    ]);
    expect(none.leaderId).toBeNull();
    expect(none.rowDelta).toBeNull();
    expect(none.deltas.get('a')).toBeNull();
    expect(optionDeltas([]).rowDelta).toBeNull();
  });

  test('a tie at the top has no leader: the row delta is 0 and every option delta is its gap to that shared top', () => {
    const two = optionDeltas([
      { id: 'a', consensus: 50 },
      { id: 'b', consensus: 50 },
      { id: 'c', consensus: 30 },
    ]);
    expect(two.leaderId).toBeNull();
    expect(two.rowDelta).toBe(0);
    expect(two.deltas.get('a')).toBe(0);
    expect(two.deltas.get('b')).toBe(0);
    expect(two.deltas.get('c')).toBeCloseTo(-20, 9);
    const three = optionDeltas([
      { id: 'a', consensus: 7 },
      { id: 'b', consensus: 7 },
      { id: 'c', consensus: 7 },
    ]);
    expect(three.leaderId).toBeNull();
    expect(three.rowDelta).toBe(0);
    for (const id of ['a', 'b', 'c']) expect(three.deltas.get(id)).toBe(0);
  });

  test('a tie at the top has no leader even through float noise: a gap under 1e-9 is a tie, and reads exactly 0', () => {
    const r = optionDeltas([
      { id: 'a', consensus: 30 },
      { id: 'b', consensus: 50 },
      { id: 'c', consensus: 50 + 1e-12 },
    ]);
    expect(r.leaderId).toBeNull();
    expect(r.rowDelta).toBe(0);
    expect(r.deltas.get('b')).toBe(0);
    expect(r.deltas.get('c')).toBe(0);
    expect(r.deltas.get('a')).toBeCloseTo(-20, 9);
    // A real lead, however small, is still a lead.
    const led = optionDeltas([
      { id: 'a', consensus: 50 },
      { id: 'b', consensus: 50.001 },
    ]);
    expect(led.leaderId).toBe('b');
    expect(led.rowDelta).toBeCloseTo(0.001, 9);
  });

  test('GET /api/proposals/:id rows carry options with per-option delta and the leader lead, approved and declined null', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    await setShares(id, 'up', [20, 0]);
    const body = await detail(id);
    expect(body.options).toEqual(OPTIONS);
    expect(body.decidedOption).toBeNull();
    expect(body.markets).toHaveLength(1);
    expect(body.branchMarketCount).toBe(3);
    const row = body.markets[0];
    expect(row.approved).toBeNull();
    expect(row.declined).toBeNull();
    expect(row.options.map((o: { id: string }) => o.id)).toEqual(['left', 'right', 'up']);
    const byId = Object.fromEntries(row.options.map((o: { id: string }) => [o.id, o]));
    expect(byId.left.label).toBe('Turn left');
    expect(typeof byId.left.marketId).toBe('string');
    expect(byId.left.liquidity).toBeGreaterThan(0);
    expect(byId.left.tradeCount).toBe(0);
    expect(byId.left.voided).toBe(false);
    expect(byId.left.resolved).toBe(false);
    expect(byId.left.actualValue).toBeNull();
    const cl = byId.left.consensus,
      cr = byId.right.consensus,
      cu = byId.up.consensus;
    expect(cl).toBeGreaterThan(cr);
    expect(cr).toBeGreaterThan(cu);
    expect(byId.left.delta).toBeCloseTo(cl - cr, 9);
    expect(byId.right.delta).toBeCloseTo(cr - cl, 9);
    expect(byId.up.delta).toBeCloseTo(cu - cl, 9);
    expect(row.delta).toBeCloseTo(cl - cr, 9);
    expect(row.delta).toBeGreaterThan(0);
  });

  test('an option with no liquidity has null consensus and null delta while the others still price', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    await setLiquidity(id, 'up', 0);
    const row = (await detail(id)).markets[0];
    const byId = Object.fromEntries(row.options.map((o: { id: string }) => [o.id, o]));
    expect(byId.up.consensus).toBeNull();
    expect(byId.up.delta).toBeNull();
    expect(byId.left.delta).toBeCloseTo(byId.left.consensus - byId.right.consensus, 9);
    expect(row.delta).toBeCloseTo(byId.left.delta, 9);
  });

  test('a row where fewer than two options are priced has no delta', async () => {
    await seed();
    const { id } = await postOptions();
    await setLiquidity(id, 'up', 0);
    await setLiquidity(id, 'right', 0);
    const row = (await detail(id)).markets[0];
    expect(row.delta).toBeNull();
    for (const o of row.options) expect(o.delta).toBeNull();
    const left = row.options.find((o: { id: string }) => o.id === 'left');
    expect(left.consensus).not.toBeNull();
  });

  test('a two-branch proposal still reads approved and declined, with options null', async () => {
    await seed();
    const plain = await post({ title: 'plain', liquiditySubsidy: 30 });
    expect(plain.status).toBe(201);
    expect(plain.body.options).toBeNull();
    const body = await detail(plain.body.id);
    expect(body.options).toBeNull();
    expect(body.markets[0].options).toBeNull();
    expect(body.markets[0].approved).not.toBeNull();
    expect(body.markets[0].declined).not.toBeNull();
  });
});

describe('deciding is choosing', () => {
  test('approving an option proposal without an option is 400 option_required and changes nothing', async () => {
    await seed();
    const { id } = await postOptions();
    const res = await approve(id);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('option_required');
    expect((await proposalRow(id)).status).toBe('pending');
    expect((await marketsOf(id)).every(m => !m.voided && !m.resolved)).toBe(true);
  });

  test('approving with an id that is not one of the options is 400 unknown_option', async () => {
    await seed();
    const { id } = await postOptions();
    const res = await approve(id, { option: 'down' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('unknown_option');
    expect((await proposalRow(id)).status).toBe('pending');
  });

  test('naming an option on a two-branch proposal is 400 no_options', async () => {
    await seed();
    const plain = await post({ title: 'plain', liquiditySubsidy: 30 });
    const res = await approve(plain.body.id, { option: 'left' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('no_options');
    expect((await proposalRow(plain.body.id)).status).toBe('pending');
  });

  test('an option that is not a string is a plain 400', async () => {
    await seed();
    const { id } = await postOptions();
    const res = await approve(id, { option: 3 });
    expect(res.status).toBe(400);
  });

  test('choosing an option keeps only its markets open and refunds every stake in the others at net cash', async () => {
    await seed();
    const { id } = await postOptions();
    const right = await branchRow(id, 'right');
    const up = await branchRow(id, 'up');
    const left = await branchRow(id, 'left');
    const before = await balanceOf(TRADER);
    await tradeOn(right.id, TRADER, 50);
    await tradeOn(up.id, TRADER, 20);
    await tradeOn(left.id, TRADER, 10);
    const afterTrades = await balanceOf(TRADER);
    expect(afterTrades).toBe(before - toUnits(80));

    const res = await approve(id, { option: 'left' });
    expect(res.status).toBe(200);

    const rows = await marketsOf(id);
    const byBranch = Object.fromEntries(rows.map(r => [r.branch as string, r]));
    expect(byBranch.left.voided).toBe(false);
    expect(byBranch.left.resolved).toBe(false);
    expect(byBranch.right.voided).toBe(true);
    expect(byBranch.up.voided).toBe(true);
    // The 70 credits in right and up come back; the 10 in left stay in the
    // world that was chosen and settle at the date.
    expect(await balanceOf(TRADER)).toBe(before - toUnits(10));

    const p = await proposalRow(id);
    expect(p.status).toBe('approved');
    expect(p.decidedOption).toBe('left');
    expect(p.closedAt).not.toBeNull();
  });

  test('decidedPricing records every option consensus at the moment of the choice and no approved or declined side', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const priced = Object.fromEntries((await marketsOf(id)).map(m => [m.branch as string, priceOf(m)]));
    const res = await approve(id, { option: 'right' });
    expect(res.status).toBe(200);
    const p = await proposalRow(id);
    expect(p.decidedPricing).toHaveLength(1);
    const d = p.decidedPricing![0];
    expect(d.metricId).toBe(METRIC);
    expect(d.targetDate).toBe(TARGET);
    expect(d.approvedConsensus).toBeNull();
    expect(d.declinedConsensus).toBeNull();
    expect(Object.keys(d.options ?? {}).sort()).toEqual(['left', 'right', 'up']);
    for (const k of ['left', 'right', 'up']) expect(d.options![k]).toBeCloseTo(priced[k] as number, 9);
  });

  test('a decided option proposal is read on its record: the detail shows every option, voided ones struck, and the leader lead as recorded', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    await approve(id, { option: 'up' });
    // The surviving book moves afterwards; the record must not.
    await setShares(id, 'up', [0, 60]);
    const body = await detail(id);
    expect(body.decidedOption).toBe('up');
    const row = body.markets[0];
    expect(row.options).toHaveLength(3);
    const byId = Object.fromEntries(row.options.map((o: { id: string }) => [o.id, o]));
    expect(byId.left.voided).toBe(true);
    expect(byId.right.voided).toBe(true);
    expect(byId.up.voided).toBe(false);
    const p = await proposalRow(id);
    const rec = p.decidedPricing![0].options!;
    expect(byId.up.consensus).toBeCloseTo(rec.up as number, 9);
    expect(byId.left.consensus).toBeCloseTo(rec.left as number, 9);
    const r = optionDeltas(Object.entries(rec).map(([k, v]) => ({ id: k, consensus: v })));
    expect(row.delta).toBeCloseTo(r.rowDelta as number, 9);
  });

  test('the chosen option settles at the date and the others were never a world (settlement rule)', () => {
    expect(conditionalBranchToSettle('approved', 'left')).toBe('left');
    expect(conditionalBranchToSettle('approved', null)).toBe('approved');
    expect(conditionalBranchToSettle('approved')).toBe('approved');
    expect(conditionalBranchToSettle('declined', 'left')).toBe('declined');
    expect(conditionalBranchToSettle('pending', 'left')).toBeNull();
  });

  test('everything else approving does still happens: the reward is paid and checked first, the proposer stake is bought out', async () => {
    await seed();
    await db.update(workspaces).set({ proposalReward: 25 }).where(eq(workspaces.id, WS));
    const { id } = await postOptions({ liquiditySubsidy: 30 });
    const proposerBefore = await balanceOf(PROPOSER);
    const res = await approve(id, { option: 'left' });
    expect(res.status).toBe(200);
    expect(res.body.rewardPaid).toBe(25);
    // 60 back from the two voided options, 30 bought out of the chosen one, 25 reward.
    expect(await balanceOf(PROPOSER)).toBe(proposerBefore + toUnits(90 + 25));
  });

  test('a broke owner is refused before anything moves, all three options still open', async () => {
    await seed();
    await db.update(workspaces).set({ proposalReward: 25 }).where(eq(workspaces.id, WS));
    await db
      .update(agents)
      .set({ balance: toUnits(0) })
      .where(eq(agents.id, OWNER));
    const { id } = await postOptions();
    const res = await approve(id, { option: 'left' });
    expect(res.status).toBe(409);
    expect((await marketsOf(id)).every(m => !m.voided)).toBe(true);
    expect((await proposalRow(id)).status).toBe('pending');
  });
});

describe('none of these', () => {
  test('decline voids every option and refunds, whatever refund says', async () => {
    await seed();
    const { id } = await postOptions();
    const right = await branchRow(id, 'right');
    const before = await balanceOf(TRADER);
    await tradeOn(right.id, TRADER, 50);
    const res = await request(app)
      .post(`/api/proposals/${id}/decline`)
      .set(as(OWNER))
      .send({ declineReason: 'None of these' });
    expect(res.status).toBe(200);
    expectAllVoided(await marketsOf(id));
    expect(await balanceOf(TRADER)).toBe(before);
    const p = await proposalRow(id);
    expect(p.status).toBe('declined');
    expect(p.decidedOption).toBeNull();
    expect(p.decidedPricing![0].options).toBeDefined();
  });

  test('a charter still demands a written reason on decline', async () => {
    await seed();
    await db.update(workspaces).set({ charter: 'We answer every proposal.' }).where(eq(workspaces.id, WS));
    const { id } = await postOptions();
    const res = await request(app).post(`/api/proposals/${id}/decline`).set(as(OWNER)).send({});
    expect(res.status).toBe(400);
    expect((await marketsOf(id)).every(m => !m.voided)).toBe(true);
  });

  test('decline as spam voids every option', async () => {
    await seed();
    const { id } = await postOptions();
    await declineProposalAsSpam(id, WS, OWNER);
    expectAllVoided(await marketsOf(id));
  });

  test('withdraw voids every option and refunds the proposer', async () => {
    await seed();
    const { id } = await postOptions({ liquiditySubsidy: 30 });
    const before = await balanceOf(PROPOSER);
    await withdrawProposal(id, WS, PROPOSER);
    expectAllVoided(await marketsOf(id));
    expect(await balanceOf(PROPOSER)).toBe(before + toUnits(90));
  });

  test('remove voids every option', async () => {
    await seed();
    const { id } = await postOptions();
    await removeProposal(id, WS, OWNER);
    expectAllVoided(await marketsOf(id));
  });

  test('the lapse at the deadline voids every option and records what each was priced at', async () => {
    await seed();
    const { id } = await postOptions();
    await db
      .update(proposals)
      .set({ decideBy: new Date(Date.now() - 60_000) })
      .where(and(eq(proposals.id, id), eq(proposals.workspaceId, WS)));
    expect(await lapseOverdueProposals(WS)).toBe(1);
    expectAllVoided(await marketsOf(id));
    const p = await proposalRow(id);
    expect(p.status).toBe('lapsed');
    expect(Object.keys(p.decidedPricing![0].options ?? {}).sort()).toEqual(['left', 'right', 'up']);
  });
});

describe('what a reader is shown', () => {
  test('a voided option is hidden on a pending proposal and shown on a decided one (lib/market-pairs.ts)', async () => {
    await seed();
    const { id } = await postOptions();
    const up = await branchRow(id, 'up');
    await voidMarket(up, WS);
    const pending = (await detail(id)).markets[0];
    expect(pending.options.map((o: { id: string }) => o.id)).toEqual(['left', 'right']);
    expect(branchIsShown('pending', true)).toBe(false);
    await approve(id, { option: 'left' });
    const decided = (await detail(id)).markets[0];
    expect(decided.options.map((o: { id: string }) => o.id)).toEqual(['left', 'right', 'up']);
    expect(decided.options.filter((o: { voided: boolean }) => o.voided).map((o: { id: string }) => o.id)).toEqual([
      'right',
      'up',
    ]);
  });

  test('a row whose every option is voided on a pending proposal is not a row', async () => {
    await seed();
    const { id } = await postOptions();
    for (const m of await marketsOf(id)) await voidMarket(m, WS);
    const body = await detail(id);
    expect(body.markets).toEqual([]);
  });

  test('GET /api/proposals lists options and decidedOption', async () => {
    await seed();
    const { id } = await postOptions();
    await approve(id, { option: 'right' });
    const res = await request(app).get('/api/proposals').set(as(OWNER));
    expect(res.status).toBe(200);
    const row = res.body.find((p: { id: string }) => p.id === id);
    expect(row.options).toEqual(OPTIONS);
    expect(row.decidedOption).toBe('right');
  });

  test('the marketplace payload rows carry options, null approved fields, and the leader lead as delta', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const p = res.body.proposals.find((x: { id: string }) => x.id === id);
    expect(p.options).toEqual(OPTIONS);
    expect(p.decidedOption).toBeNull();
    expect(p.marketPairCount).toBe(1);
    const pair = p.markets[0];
    expect(pair.approvedConsensus).toBeNull();
    expect(pair.declinedConsensus).toBeNull();
    expect(pair.approvedMarketId).toBeNull();
    expect(pair.approvedLiquidity).toBeNull();
    expect(pair.options.map((o: { id: string }) => o.id)).toEqual(['left', 'right', 'up']);
    const left = pair.options[0];
    expect(left.label).toBe('Turn left');
    expect(typeof left.marketId).toBe('string');
    expect(left.consensus).not.toBeNull();
    expect(left.probability).toBeGreaterThan(0);
    expect(left.liquidity).toBeGreaterThan(0);
    expect(left.pool).toBeGreaterThan(0);
    expect(left.traders).toBe(0);
    expect(left.volume).toBe(0);
    const right = pair.options[1];
    expect(left.delta).toBeCloseTo(left.consensus - right.consensus, 9);
    expect(pair.delta).toBeCloseTo(left.delta, 9);
    expect(pair.delta).toBeGreaterThan(0);
  });

  test('the marketplace payload prints a decided option proposal on its record, not its books', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    await approve(id, { option: 'up' });
    await setShares(id, 'up', [0, 60]);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    const p = res.body.proposals.find((x: { id: string }) => x.id === id);
    expect(p.decidedOption).toBe('up');
    const rec = (await proposalRow(id)).decidedPricing![0].options!;
    const pair = p.markets[0];
    expect(pair.options).toHaveLength(3);
    const up = pair.options.find((o: { id: string }) => o.id === 'up');
    expect(up.consensus).toBeCloseTo(rec.up as number, 9);
    const r = optionDeltas(Object.entries(rec).map(([k, v]) => ({ id: k, consensus: v })));
    expect(pair.delta).toBeCloseTo(r.rowDelta as number, 9);
  });

  test('the contractor rail scores an option proposal on the leader lead and does not crash', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const res = await request(app).get(`/api/marketplace/${WS}`);
    expect(res.status).toBe(200);
    const poster = res.body.topContractors.find((c: { id: string }) => c.id === PROPOSER);
    expect(poster).toBeDefined();
    expect(poster.pricedJobs).toBe(1);
    const pair = res.body.proposals.find((x: { id: string }) => x.id === id).markets[0];
    expect(poster.impact).toBeCloseTo(pair.delta, 9);
  });

  test('the brief and the contracts read carry the options and say who leads', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const ctx = await buildWorkspaceContext(WS);
    const c = ctx!.contracts.find(x => x.id === id)!;
    expect(c.options).toEqual(OPTIONS);
    const i = c.impact[0];
    expect(i.approved).toBeNull();
    expect(i.declined).toBeNull();
    expect(i.options!.map(o => o.id)).toEqual(['left', 'right', 'up']);
    expect(i.options![0].label).toBe('Turn left');
    expect(i.options![0].delta).toBeCloseTo(i.delta as number, 9);
    expect(i.options![0].trades).toBe(0);
    const md = renderContextMarkdown(ctx!);
    expect(md).toMatch(/Turn left/);
    expect(md).toMatch(/leads by/);
    const res = await request(app).get(`/api/marketplace/${WS}/contracts`);
    expect(res.status).toBe(200);
    const read = res.body.contracts.find((x: { id: string }) => x.id === id);
    expect(read.impact[0].options.map((o: { id: string }) => o.id)).toEqual(['left', 'right', 'up']);
    expect(read.impact[0].approved).toBeNull();
  });

  test('the share card and the proposal link price an option proposal on the leader lead and do not crash', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const p = await proposalRow(id);
    const share = await resolveProposalShare(slug, p.number as number);
    expect(share).not.toBeNull();
    const pair = (await detail(id)).markets[0];
    expect(share!.impact).toBeCloseTo(pair.delta, 9);
    expect(share!.impact).toBeGreaterThan(0);
    expect(share!.options).toBe(true);
    expect(share!.leaderLabel).toBe('Turn left');
    expect(share!.chosenLabel).toBeNull();
    const res = await request(app).get(`/api/marketplace/${slug}/card.png`);
    expect(res.status).toBe(200);
  });

  test('a tie at the top has no leader on the link: an untraded proposal names no leader, reads 0, and says tied', async () => {
    await seed();
    const { id } = await postOptions();
    const pair = (await detail(id)).markets[0];
    // Every option untraded: one price, so the row's lead is zero and nobody leads.
    expect(pair.delta).toBe(0);
    for (const o of pair.options) expect(o.delta).toBe(0);
    const p = await proposalRow(id);
    const share = await resolveProposalShare(slug, p.number as number);
    expect(share!.leaderLabel).toBeNull();
    expect(share!.impact).toBe(0);
    expect(share!.tied).toBe(true);
    expect(proposalMetaText(share!).title).toMatch(/The market has the options tied\.$/);
  });

  test('a clear leader on the link is not tied', async () => {
    await seed();
    const { id } = await postOptions();
    await setShares(id, 'left', [0, 25]);
    const p = await proposalRow(id);
    const share = await resolveProposalShare(slug, p.number as number);
    expect(share!.tied).toBe(false);
  });

  test('a tie at the top has no leader in the brief: it says the options are tied at the top, never who leads', async () => {
    await seed();
    const { id } = await postOptions();
    const md = renderContextMarkdown((await buildWorkspaceContext(WS))!);
    const block = md.slice(md.indexOf('Priced impact on'));
    expect(block).toMatch(/tied at the top/);
    expect(block).not.toMatch(/leads by|Leader:/);
    expect(id).toBeTruthy();
  });

  test('the proposal link names no leader while fewer than two options are priced', async () => {
    await seed();
    const { id } = await postOptions();
    await setLiquidity(id, 'right', 0);
    await setLiquidity(id, 'up', 0);
    const p = await proposalRow(id);
    const share = await resolveProposalShare(slug, p.number as number);
    expect(share!.leaderLabel).toBeNull();
    expect(share!.impact).toBeNull();
  });

  test('the proposal link of a chosen option proposal names the chosen option', async () => {
    await seed();
    const { id } = await postOptions();
    expect((await approve(id, { option: 'right' })).status).toBe(200);
    const p = await proposalRow(id);
    const share = await resolveProposalShare(slug, p.number as number);
    expect(share!.decided).toBe('approved');
    expect(share!.chosenLabel).toBe('Turn right');
  });
});

describe('the data room', () => {
  const rowsOf = async (query: string) => {
    const res = await request(app).get(`/api/data-room/actions${query}`);
    expect(res.status).toBe(200);
    return res.body.rows as Array<{ id: string; kind: string; text: string; detail: Record<string, unknown> }>;
  };

  test('the posting records the option labels', async () => {
    await seed();
    const { id } = await postOptions();
    const rows = await rowsOf('?kinds=proposal');
    const posted = rows.find(r => r.id === `proposal:${id}`)!;
    expect(posted).toBeDefined();
    expect(posted.detail.options).toEqual(['Turn left', 'Turn right', 'Go up']);
    expect(posted.text).toMatch(/^proposed "Which way"/);
  });

  test('a two-branch posting records no options', async () => {
    await seed();
    const plain = await post({ title: 'plain' });
    const rows = await rowsOf('?kinds=proposal');
    const posted = rows.find(r => r.id === `proposal:${plain.body.id}`)!;
    expect(posted.detail.options ?? null).toBeNull();
  });

  test('the decision records the chosen option', async () => {
    await seed();
    const { id } = await postOptions();
    await approve(id, { option: 'right' });
    clearDataRoomCache();
    const rows = await rowsOf('?kinds=decision');
    const decided = rows.find(r => r.id === `decision:${id}`)!;
    expect(decided).toBeDefined();
    expect(decided.detail.option).toEqual({ id: 'right', label: 'Turn right' });
    expect(decided.text).toMatch(/^approved "Which way"/);
    expect(decided.text).toMatch(/Turn right/);
  });

  test('a decline on an option proposal records no chosen option', async () => {
    await seed();
    const { id } = await postOptions();
    await request(app).post(`/api/proposals/${id}/decline`).set(as(OWNER)).send({ declineReason: 'No' });
    clearDataRoomCache();
    const rows = await rowsOf('?kinds=decision');
    const decided = rows.find(r => r.id === `decision:${id}`)!;
    expect(decided.detail.option ?? null).toBeNull();
  });
});
