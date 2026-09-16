/**
 * THE RULE: credits transferred between participants count in the season
 * score (docs/seasons.md, "Credits transferred between participants count";
 * rules amended 2026-09-16). Credits another participant sent you inside the
 * window are profit, credits you sent are loss, at the transfer instant.
 *
 * Why it exists: a second account could lose to the first on purpose on a
 * market that resolves inside the season, be refunded by transfer, and
 * repeat without bound, because transfers were not scored (reported by a
 * trader 2026-09-16, owner decision the same day).
 *
 * Against a real database, because the rule is the SQL side of the season
 * score (lib/board.ts loadSeasonSettled): which transfers fall in the window,
 * that a deposit written with the transfer ledger reason is not one, and that
 * settlement writes the same number the standings showed.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../middleware/consent', () => ({
  requireConsentIfUser: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { and, eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import {
  agents,
  creditLedger,
  creditTransfers,
  markets,
  metrics,
  prizeSeasons,
  seasonEntries,
  trades,
  workspaces,
} from '../db/schema';
import { loadSeasonMarked, loadSeasonSettled } from '../lib/board';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { clearBoardCache } from '../routes/leaderboard';
import { seasonsRouter } from '../routes/seasons';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const WS = 'ws-transfers';
const A = 'agent-a-xfer';
const B = 'agent-b-xfer';
const C = 'agent-c-xfer';

const START = new Date('2026-06-01T00:00:00Z');
const END = new Date('2026-07-01T00:00:00Z');
const MID = new Date('2026-06-15T12:00:00Z');

let caller: { agentId?: string; isMasterKey?: boolean } = { isMasterKey: true };
const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  (req as unknown as { auth: typeof caller }).auth = caller;
  next();
});
app.use('/api/seasons', seasonsRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(500).json({ error: (err as Error).message ?? 'Internal error' });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  clearBoardCache();
  caller = { isMasterKey: true };
  await db.insert(agents).values(
    [A, B, C].map(id => ({
      id,
      apiKeyHash: `h-${id}`,
      balance: toUnits(1000),
      nickname: id,
      payoutMethod: { provider: 'paypal', email: `${id}@example.com` },
    })),
  );
  await db.insert(workspaces).values({ id: WS, name: 'Floor', slug: 'xfer-floor', createdBy: A, visibility: 'public' });
  await db.insert(metrics).values({
    id: 'metric-x',
    workspaceId: WS,
    name: 'Revenue',
    value: 50,
    formula: '0',
    marketRangeMax: 100,
  });
});

let seq = 0;
async function transfer(from: string, to: string, credits: number, at: Date, memo = '') {
  seq += 1;
  await db
    .insert(creditTransfers)
    .values({ id: `xfer-${seq}`, fromAgentId: from, toAgentId: to, credits, memo, createdAt: at });
  clearBoardCache();
}

/** `loser` pays `amount` for shares that pay nothing, on a market that
 *  resolves inside the window; `winner` holds shares that pay `amount`. The
 *  settled-window formula then scores winner +amount and loser -amount. */
async function loserPaysWinner(loser: string, winner: string, amount: number, tag: string) {
  const marketId = `mkt-${tag}`;
  await db.insert(markets).values({
    id: marketId,
    workspaceId: WS,
    metricId: 'metric-x',
    metricName: 'Revenue',
    targetDate: `res-${tag}`,
    rangeMin: 0,
    rangeMax: 100,
    shares: [amount, amount],
    liquidity: 200,
    pool: 0,
    active: false,
    resolved: true,
    actualValue: 100,
    resolvedAt: MID,
    voided: false,
    proposalId: null,
    tradedVolume: 1,
  });
  // Resolved at the top of the range: 'higher' pays 1 a share, 'lower' pays 0.
  await db.insert(trades).values([
    {
      id: `trade-${tag}-w`,
      workspaceId: WS,
      agentId: winner,
      marketId,
      direction: 'higher',
      shares: amount,
      cost: 0,
      createdAt: new Date(MID.getTime() - 3600_000),
    },
    {
      id: `trade-${tag}-l`,
      workspaceId: WS,
      agentId: loser,
      marketId,
      direction: 'lower',
      shares: amount,
      cost: amount,
      createdAt: new Date(MID.getTime() - 3600_000),
    },
  ]);
  clearBoardCache();
}

describe('credits transferred between participants count in the season score', () => {
  test('credits another participant sent you are profit, credits you sent are loss', async () => {
    await transfer(B, A, 100, MID);
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(A)).toBe(100);
    expect(score.get(B)).toBe(-100);
  });

  test('a participant who only transferred, on a floor with nothing resolved, still has a score', async () => {
    // No market at all: the settled half used to answer "nobody" before it
    // looked at anything else.
    await transfer(A, C, 40, MID);
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(C)).toBe(40);
    expect(score.get(A)).toBe(-40);
  });

  test('the two-account loop nets to zero: lose on purpose, get refunded by transfer, repeat', async () => {
    // B loses 30 to A on a resolved market, A sends the 30 back, twice over.
    await loserPaysWinner(B, A, 30, 'loop-1');
    await transfer(A, B, 30, new Date(MID.getTime() + 3600_000));
    await loserPaysWinner(B, A, 30, 'loop-2');
    await transfer(A, B, 30, new Date(MID.getTime() + 2 * 3600_000));
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(A)).toBe(0);
    expect(score.get(B)).toBe(0);
  });

  test('the window is (start, end] on the transfer instant, like resolutions', async () => {
    await transfer(B, A, 1, new Date(START.getTime() - 1)); // before
    await transfer(B, A, 2, START); // at the start instant: out
    await transfer(B, A, 4, END); // at the end instant: in
    await transfer(B, A, 8, new Date(END.getTime() + 1)); // after
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(A)).toBe(4);
    expect(score.get(B)).toBe(-4);
  });

  test('a deposit is written with the transfer ledger reason but is not a transfer and never counts', async () => {
    await db.insert(creditLedger).values({
      id: 'ledger-deposit-1',
      workspaceId: 'platform',
      agentId: A,
      deltaUnits: toUnits(500),
      balanceAfterUnits: toUnits(1500),
      reason: 'transfer_in',
      refType: 'transfer',
      refId: '0xdeadbeef',
      createdAt: MID,
    });
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(A) ?? 0).toBe(0);
  });

  test('transfers add to trading profit on the same account, rounded to two decimals', async () => {
    await loserPaysWinner(B, A, 30, 'add');
    await transfer(A, C, 10.1, MID);
    await transfer(A, C, 0.2, MID);
    const score = await loadSeasonSettled([WS], START, END);
    expect(score.get(A)).toBe(19.7);
    expect(score.get(C)).toBe(10.3);
  });

  test('the marked column ("Total if prices hold") carries the transfer too', async () => {
    await transfer(B, A, 100, MID);
    const marked = await loadSeasonMarked([WS], START, END);
    expect(marked.get(A)).toBe(100);
    expect(marked.get(B)).toBe(-100);
  });

  test('settlement writes the transfer into the final', async () => {
    const seasonId = 'season-xfer';
    await db.insert(prizeSeasons).values({
      id: seasonId,
      name: 'Season X',
      startsAt: START,
      endsAt: END,
      status: 'running',
      poolUsd: 100,
      ladder: [],
      payoutMode: 'proportional',
      minPayoutUsd: 0,
      strictEligibility: false,
      workspaceIds: [WS],
      rulesUrl: '/legal/season-x',
    });
    await db
      .insert(seasonEntries)
      .values([A, B].map(id => ({ seasonId, agentId: id, optedIn: true, baselineProfit: 0, enteredAt: START })));
    await loserPaysWinner(B, A, 30, 'final');
    await transfer(A, B, 30, MID);

    const res = await request(app).post(`/api/seasons/${seasonId}/settle`).send({});
    expect(res.status).toBe(200);
    const [a] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, A)));
    const [b] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, B)));
    expect(a.finalProfit).toBe(0);
    expect(b.finalProfit).toBe(0);
  });
});
