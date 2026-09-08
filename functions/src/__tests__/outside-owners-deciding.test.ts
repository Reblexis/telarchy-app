/**
 * "Outside owners deciding" (docs/metrics.md): distinct workspaces whose
 * owner is not a house account and who approved or declined a proposal on
 * their own floor in the trailing 7 days. The number the outreach exists to
 * move, so its definition is pinned here the way the trader count's is.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { agents, proposals, workspaces } from '../db/schema';
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

async function decided(wsId: string, by: string, status: 'approved' | 'declined', when: Date) {
  n += 1;
  await db.insert(proposals).values({
    id: `p-${n}`,
    workspaceId: wsId,
    title: `P${n}`,
    description: '',
    proposedBy: 'someone',
    status,
    resolvedBy: by,
    resolvedAt: when,
    conditionalMarketIds: [],
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

  test('two outside owners are two', async () => {
    const w1 = await floor({ id: 'e' });
    const w2 = await floor({ id: 'f' });
    await decided(w1, 'e', 'approved', ago(1));
    await decided(w2, 'f', 'declined', ago(6));
    expect(await outsideOwnersDeciding7d()).toBe(2);
  });
});
