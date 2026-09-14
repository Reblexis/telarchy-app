/**
 * The agent watchdog (docs/infra/deploy.md, "Cron schedule"): the owner is
 * emailed when a watched house agent stops working, from whatever cause, once
 * per incident with a daily reminder, and once when it works again.
 *
 * Pinned: the three ways an agent counts as stopped (no report for 30
 * minutes, a last report that is an error, work due and not done), what is
 * NOT due work, one mail per incident, the 24-hour reminder, the recovery
 * mail, a refused mail retried on the next run, and no mail without an owner
 * address.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const sent: { to: string; subject: string; text: string }[] = [];
let accept = true;
jest.mock('../lib/notify', () => ({
  sendEmail: jest.fn(async (to: string, subject: string, text: string) => {
    sent.push({ to, subject, text });
    return accept;
  }),
}));

import { eq } from 'drizzle-orm';
import { agentHeartbeats, agents, marketForecasts, markets, proposals, systemConfig, workspaces } from '../db/schema';
import { initialPool } from '../lib/amm';
import {
  DUE_AFTER_MS,
  MIN_LIFETIME_MS,
  PROPOSAL_DUE_AFTER_MS,
  PROPOSAL_MIN_WINDOW_MS,
  REMIND_EVERY_MS,
  runAgentWatchdog,
  STALE_HEARTBEAT_MS,
  WATCHED_AGENTS,
} from '../services/agent-watchdog';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const AGENT = 'reference-astra';
const T0 = new Date('2026-09-14T12:00:00.000Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(T0.getTime() + ms);

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  accept = true;
  process.env.OWNER_NOTIFY_EMAIL = 'owner@example.com';
  await db.insert(agents).values([
    { id: AGENT, apiKeyHash: 'h-ref', balance: 0, platformOperated: true },
    { id: 'someone-else', apiKeyHash: 'h-else', balance: 0 },
  ]);
  await db.insert(workspaces).values([
    { id: 'ws-pub', name: 'LookPilot', slug: 'lookpilot', createdBy: 'someone-else', visibility: 'public' },
    { id: 'ws-priv', name: 'Private', slug: 'private', createdBy: 'someone-else', visibility: 'private' },
  ]);
});

async function heartbeat(ageMs: number, status = 'idle', lastError: string | null = null, now = T0) {
  await db
    .insert(agentHeartbeats)
    .values({ agentId: AGENT, status, lastError, updatedAt: new Date(now.getTime() - ageMs) })
    .onConflictDoUpdate({
      target: agentHeartbeats.agentId,
      set: { status, lastError, updatedAt: new Date(now.getTime() - ageMs) },
    });
}

let n = 0;
async function market(opts: {
  openedAgoMs?: number;
  lifetimeMs?: number;
  ws?: string;
  resolved?: boolean;
  voided?: boolean;
  active?: boolean;
  proposalId?: string;
  branch?: string;
  now?: Date;
}) {
  n += 1;
  const now = opts.now ?? T0;
  const createdAt = new Date(now.getTime() - (opts.openedAgoMs ?? 7 * HOUR));
  const id = `mkt-${n}`;
  await db.insert(markets).values({
    id,
    workspaceId: opts.ws ?? 'ws-pub',
    metricId: 'metric-1',
    metricName: `Revenue ${n}`,
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 1000,
    pool: initialPool(1000),
    active: opts.active ?? true,
    proposalId: opts.proposalId ?? null,
    branch: opts.branch ?? (opts.proposalId ? 'approved' : null),
    resolved: opts.resolved ?? false,
    voided: opts.voided ?? false,
    createdAt,
    settlesAt: new Date(createdAt.getTime() + (opts.lifetimeMs ?? 48 * HOUR)),
  });
  return id;
}

async function forecast(marketId: string, agentId = AGENT, ws = 'ws-pub') {
  await db
    .insert(marketForecasts)
    .values({ id: `fc-${marketId}-${agentId}`, workspaceId: ws, marketId, agentId, value: 1, stage: 'spawn' });
}

async function state() {
  const [row] = await db
    .select()
    .from(systemConfig)
    .where(eq(systemConfig.key, `agent_watchdog:${AGENT}`));
  return row?.value as { status: string; reasons: string[]; lastAlertAt: string | null } | undefined;
}

describe('what is watched and the lines it draws', () => {
  test('the reference forecaster is watched; the lines are 30 minutes, 6 hours due, 12 hours of life, 24-hour reminders', () => {
    expect(WATCHED_AGENTS).toEqual(['reference-astra']);
    expect(STALE_HEARTBEAT_MS).toBe(30 * MIN);
    expect(DUE_AFTER_MS).toBe(6 * HOUR);
    expect(MIN_LIFETIME_MS).toBe(12 * HOUR);
    expect(REMIND_EVERY_MS).toBe(24 * HOUR);
    expect(PROPOSAL_DUE_AFTER_MS).toBe(2 * HOUR);
    expect(PROPOSAL_MIN_WINDOW_MS).toBe(4 * HOUR);
  });
});

describe('a working agent', () => {
  test('reports recently, is idle, and has forecast every due market: no mail, state ok', async () => {
    await heartbeat(5 * MIN);
    await forecast(await market({}));
    const [r] = await runAgentWatchdog(T0);
    expect(r).toMatchObject({ agentId: AGENT, status: 'ok', mailed: null });
    expect(sent).toEqual([]);
    expect((await state())?.status).toBe('ok');
  });

  test('a report 29 minutes old is still working', async () => {
    await heartbeat(29 * MIN);
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });
});

describe('THE RULE: the owner is emailed when the reference forecaster stops, whatever the cause', () => {
  test('no report for 30 minutes: the machine, the unit or the network is down', async () => {
    await heartbeat(31 * MIN);
    const [r] = await runAgentWatchdog(T0);
    expect(r.status).toBe('stopped');
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toContain('reference-astra');
    expect(sent[0].subject.toLowerCase()).toContain('stopped');
    expect(sent[0].text).toMatch(/not reported for 31 minutes/);
  });

  test('it never reported at all', async () => {
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/never reported/);
  });

  test('its last report is an error, and the mail carries the error text', async () => {
    await heartbeat(2 * MIN, 'error', 'unit exhausted its restart budget');
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('unit exhausted its restart budget');
  });

  test('work due and not done: a public market opened 7 hours ago with no forecast from it, though it reports idle', async () => {
    await heartbeat(3 * MIN);
    const id = await market({ openedAgoMs: 7 * HOUR });
    await forecast(id, 'someone-else');
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/1 open market/);
    expect(sent[0].text).toContain('Revenue');
    expect(sent[0].text).toContain('LookPilot');
  });

  test('every reason is named in the one mail', async () => {
    await heartbeat(45 * MIN, 'error', 'boom');
    await market({ openedAgoMs: 8 * HOUR });
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/not reported for 45 minutes/);
    expect(sent[0].text).toContain('boom');
    expect(sent[0].text).toMatch(/1 open market/);
    expect((await state())?.reasons).toHaveLength(3);
  });
});

let p = 0;
/** A proposal posted `postedAgoMs` ago deciding `windowMs` after posting, with two open books. */
async function pendingProposal(opts: { postedAgoMs?: number; windowMs?: number; ws?: string; status?: string } = {}) {
  p += 1;
  const createdAt = new Date(T0.getTime() - (opts.postedAgoMs ?? 3 * HOUR));
  const id = `prop-${p}`;
  await db.insert(proposals).values({
    id,
    workspaceId: opts.ws ?? 'ws-pub',
    proposedBy: 'someone-else',
    title: `Raise prices ${p}`,
    status: opts.status ?? 'pending',
    createdAt,
    decideBy: new Date(createdAt.getTime() + (opts.windowMs ?? 24 * HOUR)),
  });
  const a = await market({
    proposalId: id,
    branch: 'approved',
    ws: opts.ws,
    openedAgoMs: opts.postedAgoMs ?? 3 * HOUR,
  });
  const b = await market({
    proposalId: id,
    branch: 'declined',
    ws: opts.ws,
    openedAgoMs: opts.postedAgoMs ?? 3 * HOUR,
  });
  return { id, books: [a, b] };
}

describe("THE RULE, for proposals: a pending proposal left without the agent's forecast is work not done", () => {
  test('a public proposal posted 3 hours ago, deciding in a day, with no forecast on any of its books', async () => {
    await heartbeat(1 * MIN);
    await pendingProposal();
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toMatch(/1 pending proposal/);
    expect(sent[0].text).toContain('Raise prices 1');
    expect(sent[0].text).toContain('LookPilot');
  });

  test('one forecast on any of its books is enough', async () => {
    await heartbeat(1 * MIN);
    const { books } = await pendingProposal();
    await forecast(books[1]);
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test('not yet due: posted less than 2 hours ago', async () => {
    await heartbeat(1 * MIN);
    await pendingProposal({ postedAgoMs: 1 * HOUR + 59 * MIN });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test("never due: a proposal deciding less than 4 hours after it was posted (the Snake's moves)", async () => {
    await heartbeat(1 * MIN);
    await pendingProposal({ postedAgoMs: 3 * HOUR, windowMs: 3 * HOUR + 59 * MIN });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test('never due: a decided proposal, one past its deadline, one on a private workspace', async () => {
    await heartbeat(1 * MIN);
    await pendingProposal({ status: 'approved' });
    await pendingProposal({ postedAgoMs: 30 * HOUR, windowMs: 24 * HOUR });
    await pendingProposal({ ws: 'ws-priv' });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });
});

describe('what is not due work', () => {
  test('a market opened less than 6 hours ago', async () => {
    await heartbeat(1 * MIN);
    await market({ openedAgoMs: 5 * HOUR + 59 * MIN });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test('a market that settles less than 12 hours after it opened (the agent skips short books by its own rule)', async () => {
    await heartbeat(1 * MIN);
    await market({ openedAgoMs: 7 * HOUR, lifetimeMs: 11 * HOUR + 59 * MIN });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test('a market that settles 12 hours after it opened is due', async () => {
    await heartbeat(1 * MIN);
    await market({ openedAgoMs: 7 * HOUR, lifetimeMs: 12 * HOUR });
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
  });

  test("a proposal's book: the agent estimates floor books only, so 160 proposal books once read as an outage", async () => {
    await heartbeat(1 * MIN);
    await market({ proposalId: 'proposal-1' });
    await market({ proposalId: 'proposal-2', openedAgoMs: 30 * 24 * HOUR });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });

  test('markets on a private workspace, resolved, voided or deactivated books', async () => {
    await heartbeat(1 * MIN);
    await market({ ws: 'ws-priv' });
    await market({ resolved: true });
    await market({ voided: true });
    await market({ active: false });
    await runAgentWatchdog(T0);
    expect(sent).toEqual([]);
  });
});

describe('one mail per incident', () => {
  test('a second run while still stopped sends nothing; a run 24 hours after the alert sends one reminder', async () => {
    await heartbeat(31 * MIN);
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    await runAgentWatchdog(at(1 * HOUR));
    await runAgentWatchdog(at(23 * HOUR));
    expect(sent).toHaveLength(1);
    const [r] = await runAgentWatchdog(at(24 * HOUR + 1 * MIN));
    expect(r.mailed).toBe('reminder');
    expect(sent).toHaveLength(2);
    expect(sent[1].subject.toLowerCase()).toContain('still');
  });

  test('when it works again the owner gets one recovery mail, and nothing after', async () => {
    await heartbeat(31 * MIN);
    await runAgentWatchdog(T0);
    await heartbeat(1 * MIN, 'idle', null, at(2 * HOUR));
    const [r] = await runAgentWatchdog(at(2 * HOUR));
    expect(r).toMatchObject({ status: 'ok', mailed: 'recovered' });
    expect(sent).toHaveLength(2);
    expect(sent[1].subject.toLowerCase()).toContain('working again');
    await runAgentWatchdog(at(2 * HOUR + 15 * MIN));
    expect(sent).toHaveLength(2);
  });

  test('a mail the provider refuses is not recorded as sent, so the next run tries again', async () => {
    await heartbeat(31 * MIN);
    accept = false;
    await runAgentWatchdog(T0);
    expect(sent).toHaveLength(1);
    expect((await state())?.lastAlertAt).toBeNull();
    accept = true;
    await runAgentWatchdog(at(15 * MIN));
    expect(sent).toHaveLength(2);
    expect((await state())?.lastAlertAt).not.toBeNull();
  });

  test('with no owner address nothing is sent and nothing breaks, and the incident is still recorded', async () => {
    delete process.env.OWNER_NOTIFY_EMAIL;
    await heartbeat(31 * MIN);
    const [r] = await runAgentWatchdog(T0);
    expect(r.status).toBe('stopped');
    expect(sent).toEqual([]);
    expect((await state())?.status).toBe('stopped');
  });
});
