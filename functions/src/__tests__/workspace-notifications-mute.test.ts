/**
 * A workspace can mute everything it would send (docs/vision.md,
 * "Participant email notifications", "A workspace can mute everything it
 * would send"; owner decision 2026-09-10: "make sure it doestn send emails..
 * from there. .as there are too many 'jobs'").
 *
 * The rule: while `notificationsMuted` is true, NOTHING about that workspace
 * is delivered on ANY channel, whatever the participants' own switches say,
 * the switchless decision email to the proposer included. Unmuting resumes
 * future notifications only. The flag is a lifecycle setting (needs
 * manage_workspace), false by default, and announced to nobody.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    const caps = req.headers['x-test-caps']
      ? String(req.headers['x-test-caps']).split(',')
      : ['read', 'trade', 'manage', 'manage_workspace'];
    req.auth = {
      agentId: req.headers['x-test-agent-id'],
      workspaceId: req.headers['x-workspace-id'],
      capabilities: new Set(caps),
      isMasterKey: req.headers['x-test-master'] === '1',
    };
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

const sent: Array<{ to: string; subject: string; body: string }> = [];
const ownerMail: Array<{ subject: string; body: string }> = [];
jest.mock('../lib/notify', () => ({
  publicOrigin: () => 'https://telarchy.com',
  notifyOwner: async (subject: string, body: string) => {
    ownerMail.push({ subject, body });
  },
  sendEmail: async (to: string, subject: string, body: string) => {
    sent.push({ to, subject, body });
    return true;
  },
}));

const pushed: Array<{ to: string; title: string }> = [];
jest.mock('../lib/push', () => ({
  pushConfigured: () => true,
  vapidPublicKey: () => null,
  sendPushToParticipant: async (agentId: string, payload: { title: string }) => {
    pushed.push({ to: agentId, title: payload.title });
  },
}));

import { eq } from 'drizzle-orm';
import express from 'express';
import request from 'supertest';
import {
  agents,
  authUser,
  markets,
  metrics,
  permissionGroups,
  proposalMessages,
  proposals,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { AppError } from '../lib/errors';
import { provisionWorkspace } from '../lib/participants';
import { toUnits } from '../lib/validation';
import { authMiddleware } from '../middleware/auth';
import { proposalsRouter } from '../routes/proposals';
import { workspacesRouter } from '../routes/workspaces';
import {
  listNotifications,
  notifyCommentPosted,
  notifyMarketResolved,
  notifyProposalCreated,
  notifyProposalDeadlineSoon,
  notifyProposalDecided,
} from '../services/notifications';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/proposals', authMiddleware, proposalsRouter);
app.use('/api/workspaces', authMiddleware, workspacesRouter);
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message, code: (err as AppError).code });
});

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  sent.length = 0;
  ownerMail.length = 0;
  pushed.length = 0;
});

const WS = 'ws-muted';
const OTHER_WS = 'ws-loud';

/** The fire-and-forget paths run after the response; let them finish. */
async function settle() {
  for (let i = 0; i < 10; i++) await new Promise(r => setImmediate(r));
}

/** A participant with a browser account, i.e. one that has an address. */
async function human(id: string, prefs: Record<string, unknown> = {}) {
  await db.insert(authUser).values({ id: `u-${id}`, name: id, email: `${id}@example.com` });
  await db.insert(agents).values({
    id,
    apiKeyHash: `h-${id}`,
    balance: 0,
    nickname: id,
    authUserId: `u-${id}`,
    notificationsSeenAt: new Date('2020-01-01'),
    ...prefs,
  });
}

/** A floor with the given members in one trader group, created by `owner`. */
async function seedFloor(wsId: string, owner: string, memberIds: string[], fields: Record<string, unknown> = {}) {
  await db.insert(workspaces).values({
    id: wsId,
    name: wsId === WS ? 'Snake' : 'LookPilot',
    createdBy: owner,
    visibility: 'public',
    slug: wsId,
    ...fields,
  });
  await db.insert(permissionGroups).values({
    id: `grp-${wsId}`,
    workspaceId: wsId,
    name: 'Traders',
    type: 'trader',
    capabilities: ['read', 'trade'],
    memberIds,
  });
  await db.insert(permissionGroups).values({
    id: `grp-admin-${wsId}`,
    workspaceId: wsId,
    name: 'Admins',
    type: 'admin',
    capabilities: ['read', 'trade', 'manage'],
    memberIds: [owner],
  });
}

async function setMuted(wsId: string, muted: boolean) {
  await db.update(workspaces).set({ notificationsMuted: muted }).where(eq(workspaces.id, wsId));
}

async function proposal(id: string, wsId: string, proposedBy: string, fields: Record<string, unknown> = {}) {
  await db.insert(proposals).values({
    id,
    workspaceId: wsId,
    proposedBy,
    title: `Turn left (${id})`,
    description: 'the snake turns',
    askUsd: 5,
    ...fields,
  });
}

async function settledMarket(id: string, wsId: string) {
  await db.insert(markets).values({
    id,
    workspaceId: wsId,
    metricId: `metric-${wsId}`,
    metricName: 'Score',
    targetDate: '2026-12',
    rangeMin: 0,
    rangeMax: 100,
    shares: [0, 0],
    liquidity: 10,
    pool: 0,
    active: false,
    resolved: true,
    voided: false,
    actualValue: 62,
    resolvedAt: new Date(),
  });
}

async function trade(id: string, wsId: string, marketId: string, agentId: string) {
  await db.insert(trades).values({
    id,
    workspaceId: wsId,
    agentId,
    marketId,
    direction: 'higher',
    shares: 5,
    cost: 2,
    createdAt: new Date(),
  });
}

/** Every member and the owner with every switch on, on every channel. */
async function loudMembers() {
  const allOn = {
    notifyCommentOnMyProposal: true,
    notifyReplyToMyComment: true,
    notifyNewProposal: true,
    notifyAnyComment: true,
    notifyMarketResolved: true,
    notifyContractDecided: true,
    notificationChannels: {
      comment: { web: true, email: true, mobile: true },
      reply: { web: true, email: true, mobile: true },
      settled: { web: true, email: true, mobile: true },
      decision: { web: true, email: true, mobile: true },
      contract: { web: true, email: true, mobile: true },
      anyComment: { web: true, email: true, mobile: true },
    },
  };
  await human('owner', allOn);
  await human('proposer', allOn);
  await human('member', allOn);
}

describe('A MUTED WORKSPACE SENDS NOTHING, ON ANY CHANNEL', () => {
  beforeEach(async () => {
    await loudMembers();
    await seedFloor(WS, 'owner', ['owner', 'proposer', 'member'], { notificationsMuted: true });
  });

  test('no email and no push for a new proposal', async () => {
    await notifyProposalCreated({ workspaceId: WS, proposedBy: 'proposer', title: 'Turn left' });
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('no email and no push for a decision, the switchless proposer email included', async () => {
    await proposal('p1', WS, 'proposer', { status: 'approved', resolvedAt: new Date(), resolvedBy: 'owner' });
    await trade('t1', WS, 'm-any', 'member');
    await notifyProposalDecided({ workspaceId: WS, proposalId: 'p1' });
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('no email and no push for a comment', async () => {
    await proposal('p1', WS, 'proposer');
    await db
      .insert(proposalMessages)
      .values({ id: 'm1', workspaceId: WS, proposalId: 'p1', from: 'member', content: 'why?', createdAt: new Date() });
    await notifyCommentPosted({ workspaceId: WS, from: 'member', content: 'why?', proposalId: 'p1' });
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('no email and no push for a market resolution', async () => {
    await settledMarket('mkt-1', WS);
    await trade('t1', WS, 'mkt-1', 'member');
    await notifyMarketResolved({ workspaceId: WS, marketId: 'mkt-1' });
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('no email and no push for a deadline running out', async () => {
    await proposal('p1', WS, 'proposer', { status: 'pending', decideBy: new Date(Date.now() + 30 * 60_000) });
    await notifyProposalDeadlineSoon({ workspaceId: WS, proposalId: 'p1' });
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);
  });

  test('no bell-inbox row for a member, while another workspace still fills the bell', async () => {
    await seedFloor(OTHER_WS, 'owner', ['owner', 'proposer', 'member']);
    await proposal('p-muted', WS, 'proposer');
    await proposal('p-loud', OTHER_WS, 'proposer');
    await db.insert(proposalMessages).values({
      id: 'm-muted',
      workspaceId: WS,
      proposalId: 'p-muted',
      from: 'member',
      content: 'on the muted floor',
      createdAt: new Date(),
    });
    await db.insert(proposalMessages).values({
      id: 'm-loud',
      workspaceId: OTHER_WS,
      proposalId: 'p-loud',
      from: 'member',
      content: 'on the loud floor',
      createdAt: new Date(),
    });

    const { items } = await listNotifications('proposer');
    expect(items.some(i => i.workspaceSlug === WS)).toBe(false);
    expect(items.some(i => i.workspaceSlug === OTHER_WS && i.kind === 'comment')).toBe(true);

    // The member who watches for new proposals: the loud one only.
    const member = await listNotifications('member');
    expect(member.items.filter(i => i.kind === 'contract').map(i => i.workspaceSlug)).toEqual([OTHER_WS]);
  });
});

describe('THE OWNER EMAIL ABOUT A NEW PROPOSAL IS NOT SENT WHILE MUTED', () => {
  const OWNER = 'agent-owner';
  const PROPOSER = 'agent-proposer';

  async function seedRoutes(muted: boolean) {
    await db.insert(agents).values([
      { id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(1000) },
      { id: PROPOSER, apiKeyHash: 'h-proposer', balance: toUnits(1000) },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: WS,
      name: 'Snake',
      createdBy: OWNER,
      ownerAgentId: OWNER,
      visibility: 'public',
    });
    await setMuted(WS, muted);
    await db.insert(metrics).values({
      id: 'metric-snake',
      workspaceId: WS,
      name: 'Score',
      value: 50,
      formula: '0',
      marketRangeMax: 100,
    });
    await db.insert(markets).values({
      id: 'mkt-far',
      workspaceId: WS,
      metricId: 'metric-snake',
      metricName: 'Score',
      targetDate: '2099',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    });
  }

  const post = () =>
    request(app)
      .post('/api/proposals')
      .set('X-Test-Agent-Id', PROPOSER)
      .set('X-Workspace-Id', WS)
      .send({ title: 'Turn left', description: '', liquiditySubsidy: 20 });

  test('muted: the proposal is created and the owner hears nothing', async () => {
    await seedRoutes(true);
    const res = await post();
    expect(res.status).toBe(201);
    await settle();
    expect(ownerMail).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  test('unmuted: the owner email goes out as before (regression guard)', async () => {
    await seedRoutes(false);
    const res = await post();
    expect(res.status).toBe(201);
    await settle();
    expect(ownerMail).toHaveLength(1);
    expect(ownerMail[0].subject).toContain('Turn left');
  });
});

describe('AN UNMUTED WORKSPACE STILL SENDS (regression guard)', () => {
  beforeEach(async () => {
    await loudMembers();
    await seedFloor(WS, 'owner', ['owner', 'proposer', 'member']);
  });

  test('a new proposal mails and pushes the members who asked for it', async () => {
    await notifyProposalCreated({ workspaceId: WS, proposedBy: 'proposer', title: 'Turn left' });
    expect(sent.map(s => s.to).sort()).toEqual(['member@example.com', 'owner@example.com']);
    expect(pushed.map(p => p.to).sort()).toEqual(['member', 'owner']);
  });

  test('a decision mails and pushes the proposer', async () => {
    await proposal('p1', WS, 'proposer', { status: 'approved', resolvedAt: new Date(), resolvedBy: 'owner' });
    await notifyProposalDecided({ workspaceId: WS, proposalId: 'p1' });
    expect(sent.map(s => s.to)).toEqual(['proposer@example.com']);
    expect(pushed.map(p => p.to)).toEqual(['proposer']);
  });

  test('a comment, a settlement and a deadline each reach their people', async () => {
    await proposal('p1', WS, 'proposer', { status: 'pending', decideBy: new Date(Date.now() + 30 * 60_000) });
    await notifyCommentPosted({ workspaceId: WS, from: 'member', content: 'why?', proposalId: 'p1' });
    expect(sent.map(s => s.to)).toContain('proposer@example.com');

    sent.length = 0;
    await settledMarket('mkt-1', WS);
    await trade('t1', WS, 'mkt-1', 'member');
    await notifyMarketResolved({ workspaceId: WS, marketId: 'mkt-1' });
    expect(sent.map(s => s.to)).toEqual(['member@example.com']);

    sent.length = 0;
    await notifyProposalDeadlineSoon({ workspaceId: WS, proposalId: 'p1' });
    expect(sent.map(s => s.to)).toEqual(['owner@example.com']);
  });

  test('the bell carries the workspace', async () => {
    await proposal('p1', WS, 'proposer');
    const { items } = await listNotifications('member');
    expect(items.map(i => i.workspaceSlug)).toContain(WS);
  });
});

describe('UNMUTING RESUMES FUTURE NOTIFICATIONS ONLY', () => {
  test('what was skipped while muted is never sent; what happens after the unmute is', async () => {
    await loudMembers();
    await seedFloor(WS, 'owner', ['owner', 'proposer', 'member'], { notificationsMuted: true });
    await proposal('p1', WS, 'proposer', { status: 'approved', resolvedAt: new Date(), resolvedBy: 'owner' });
    await notifyProposalDecided({ workspaceId: WS, proposalId: 'p1' });
    expect(sent).toHaveLength(0);

    await setMuted(WS, false);
    // Nothing arrives on its own from the unmute.
    await settle();
    expect(sent).toHaveLength(0);
    expect(pushed).toHaveLength(0);

    await proposal('p2', WS, 'proposer', { status: 'declined', resolvedAt: new Date(), resolvedBy: 'owner' });
    await notifyProposalDecided({ workspaceId: WS, proposalId: 'p2' });
    expect(sent.map(s => s.subject)).toEqual(['Declined: Turn left (p2)']);
  });
});

describe('the setting: PUT /api/workspaces/:id/settings { notificationsMuted }', () => {
  const OWNER = 'agent-owner';

  async function seedSettings() {
    await db.insert(agents).values([{ id: OWNER, apiKeyHash: 'h-owner', balance: toUnits(10) }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await provisionWorkspace(db as any, {
      wsId: WS,
      name: 'Snake',
      createdBy: OWNER,
      ownerAgentId: OWNER,
      visibility: 'public',
    });
  }

  const put = (body: Record<string, unknown>, caps?: string) => {
    const r = request(app)
      .put(`/api/workspaces/${WS}/settings`)
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', WS);
    if (caps) r.set('X-Test-Caps', caps);
    return r.send(body);
  };
  const get = () =>
    request(app)
      .get(`/api/workspaces/${WS}`)
      .set('X-Test-Agent-Id', OWNER)
      .set('X-Workspace-Id', WS)
      .set('X-Test-Master', '1');

  test('NOT MUTED BY DEFAULT: a fresh workspace reports false', async () => {
    await seedSettings();
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body.notificationsMuted).toBe(false);
  });

  test('accepts true and false, and the workspace payload reports it', async () => {
    await seedSettings();
    expect((await put({ notificationsMuted: true })).status).toBe(200);
    expect((await get()).body.notificationsMuted).toBe(true);
    const [row] = await db.select({ m: workspaces.notificationsMuted }).from(workspaces).where(eq(workspaces.id, WS));
    expect(row.m).toBe(true);

    expect((await put({ notificationsMuted: false })).status).toBe(200);
    expect((await get()).body.notificationsMuted).toBe(false);
  });

  test('rejects anything but a boolean with 400', async () => {
    await seedSettings();
    for (const bad of ['true', 1, null, {}, []]) {
      const res = await put({ notificationsMuted: bad });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('notificationsMuted');
    }
    expect((await get()).body.notificationsMuted).toBe(false);
  });

  test('REQUIRES manage_workspace: plain manage gets 403 and changes nothing', async () => {
    await seedSettings();
    const res = await put({ notificationsMuted: true }, 'read,trade,manage');
    expect(res.status).toBe(403);
    expect((await get()).body.notificationsMuted).toBe(false);
  });
});
