/**
 * "Outside owners deciding" (docs/metrics.md): distinct workspaces whose
 * owner is not a house account and who approved or declined a proposal on
 * their own floor in the trailing 7 days. The number the outreach exists to
 * move, so its definition is pinned here the way the trader count's is.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
import { agents, authUser, proposals, workspaces } from '../db/schema';
import { outsideOwnersDeciding7d } from '../services/platform-stats';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const day = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * day);

let n = 0;
async function floor(owner: { id: string; house?: 'admin' | 'operated' }) {
  n += 1;
  await db
    .insert(agents)
    .values({
      id: owner.id,
      apiKeyHash: `h-${owner.id}`,
      balance: 0,
      platformAdmin: owner.house === 'admin',
      platformOperated: owner.house === 'operated',
    })
    .onConflictDoNothing();
  const wsId = `ws-${n}`;
  await db.insert(workspaces).values({ id: wsId, name: `WS ${n}`, createdBy: owner.id, visibility: 'public' });
  return wsId;
}

async function decided(
  wsId: string,
  by: string,
  status: 'approved' | 'declined',
  when: Date,
  over: { proposedBy?: string; createdAt?: Date } = {},
) {
  n += 1;
  await db.insert(proposals).values({
    id: `p-${n}`,
    workspaceId: wsId,
    title: `P${n}`,
    description: '',
    proposedBy: over.proposedBy ?? 'someone',
    status,
    resolvedBy: by,
    resolvedAt: when,
    conditionalMarketIds: [],
    // A proposal written later than the workspace, unless the test says
    // otherwise: the starter is the one born with it.
    createdAt: over.createdAt ?? ago(4),
  });
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  n = 0;
});

describe('outsideOwnersDeciding7d', () => {
  test('an outside owner who approved a proposal this week counts once, however many they decided', async () => {
    const ws = await floor({ id: 'patrik' });
    await decided(ws, 'patrik', 'approved', ago(2));
    await decided(ws, 'patrik', 'declined', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(1);
  });

  test('a decline is a decision too', async () => {
    const ws = await floor({ id: 'a' });
    await decided(ws, 'a', 'declined', ago(3));
    expect(await outsideOwnersDeciding7d()).toBe(1);
  });

  test('house floors never count: the platform admin and platform-operated participants', async () => {
    const admin = await floor({ id: 'viktor', house: 'admin' });
    await decided(admin, 'viktor', 'approved', ago(1));
    const bot = await floor({ id: 'adminbot', house: 'operated' });
    await decided(bot, 'adminbot', 'approved', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test('a decision older than seven days does not count', async () => {
    const ws = await floor({ id: 'b' });
    await decided(ws, 'b', 'approved', ago(8));
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test('a pending proposal is not a decision', async () => {
    const ws = await floor({ id: 'c' });
    n += 1;
    await db.insert(proposals).values({
      id: `p-${n}`,
      workspaceId: ws,
      title: 'pending',
      description: '',
      proposedBy: 'someone',
      status: 'pending',
      conditionalMarketIds: [],
    });
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test('a decision made by someone other than the owner on their floor does not count as the owner deciding', async () => {
    const ws = await floor({ id: 'd' });
    await decided(ws, 'not-the-owner', 'approved', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test('approving the starter proposal the template seeded is trying the button, not deciding', async () => {
    const ws = await floor({ id: 'patrik' });
    const [row] = await db.select({ createdAt: workspaces.createdAt }).from(workspaces).where(eq(workspaces.id, ws));
    await decided(ws, 'patrik', 'approved', ago(1), {
      proposedBy: 'patrik',
      createdAt: new Date(row.createdAt.getTime() + 500),
    });
    expect(await outsideOwnersDeciding7d()).toBe(0);
    // The owner's own proposal written later does count: the test is the
    // birth instant, not who proposed.
    await decided(ws, 'patrik', 'approved', ago(1), { proposedBy: 'patrik', createdAt: ago(3) });
    expect(await outsideOwnersDeciding7d()).toBe(1);
  });

  test('two outside owners are two', async () => {
    const w1 = await floor({ id: 'e' });
    const w2 = await floor({ id: 'f' });
    await decided(w1, 'e', 'approved', ago(1));
    await decided(w2, 'f', 'declined', ago(6));
    expect(await outsideOwnersDeciding7d()).toBe(2);
  });
});

describe('the Snake floor counted as an outside owner (2026-09-11)', () => {
  // The snake's operator is an API participant with no flag of its own; its
  // floor read as an outsider's. House is the platform admin, the operated
  // participants, and everything they own, however deep (docs/metrics.md).
  async function bot(id: string, owner: { ownerUserId?: string; ownerAgentId?: string }) {
    await db
      .insert(agents)
      .values({ id, apiKeyHash: `h-${id}`, balance: 0, ...owner })
      .onConflictDoNothing();
  }

  test('a floor opened by a bot the platform admin registered from the browser is a house floor', async () => {
    await db.insert(authUser).values({ id: 'u-viktor', name: 'Viktor', email: 'v@example.com' });
    await db
      .insert(agents)
      .values({ id: 'viktor', apiKeyHash: 'h-viktor', balance: 0, platformAdmin: true, authUserId: 'u-viktor' });
    await bot('snake-operator', { ownerUserId: 'u-viktor' });
    const snake = await floor({ id: 'snake-operator' });
    await decided(snake, 'snake-operator', 'approved', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test("a floor opened by a bot a platform-operated agent spawned, or that bot's own bot, is a house floor", async () => {
    await db.insert(agents).values({ id: 'adminbot', apiKeyHash: 'h-adminbot', balance: 0, platformOperated: true });
    await bot('child', { ownerAgentId: 'adminbot' });
    await bot('grandchild', { ownerAgentId: 'child' });
    const a = await floor({ id: 'child' });
    const b = await floor({ id: 'grandchild' });
    await decided(a, 'child', 'approved', ago(1));
    await decided(b, 'grandchild', 'declined', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(0);
  });

  test('a bot an OUTSIDE person owns is still an outside owner', async () => {
    await db.insert(authUser).values({ id: 'u-out', name: 'Out', email: 'o@example.com' });
    await db.insert(agents).values({ id: 'outsider', apiKeyHash: 'h-out', balance: 0, authUserId: 'u-out' });
    await bot('their-bot', { ownerUserId: 'u-out' });
    const ws = await floor({ id: 'their-bot' });
    await decided(ws, 'their-bot', 'approved', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(1);
  });

  test("an ownership cycle between two bots is nobody's, so it counts as outside rather than crashing", async () => {
    await bot('a', {});
    await bot('b', { ownerAgentId: 'a' });
    await db.update(agents).set({ ownerAgentId: 'b' }).where(eq(agents.id, 'a'));
    const ws = await floor({ id: 'a' });
    await decided(ws, 'a', 'approved', ago(1));
    expect(await outsideOwnersDeciding7d()).toBe(1);
  });
});
