/**
 * The notifications inbox (GET /api/notifications), the bell's contents.
 *
 * The rule this file exists to pin: the inbox shows EVERYTHING that happened
 * to you, including events whose email you switched off. Mail is interruption
 * a person tunes; the inbox is the record, and a record with holes in it is
 * worse than no record.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import {
  agents,
  authUser,
  marketMessages,
  markets,
  permissionGroups,
  proposalMessages,
  proposals,
  trades,
  workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { listNotifications, markNotificationRead, markNotificationsSeen } from '../services/notifications';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const WS = 'ws-inbox';

async function participant(id: string, prefs: Record<string, boolean> = {}) {
  await db.insert(authUser).values({ id: `u-${id}`, name: id, email: `${id}@example.com` });
  await db.insert(agents).values({
    id,
    apiKeyHash: `h-${id}`,
    balance: 0,
    nickname: id,
    authUserId: `u-${id}`,
    // Read state starts in the past, so seeded rows count as unread.
    notificationsSeenAt: new Date('2020-01-01'),
    ...prefs,
  });
}

async function seedFloor(memberIds: string[]) {
  await db.insert(workspaces).values({
    id: WS,
    name: 'LookPilot',
    createdBy: 'poster',
    visibility: 'public',
    slug: 'lookpilot',
  });
  await db.insert(permissionGroups).values({
    id: 'grp',
    workspaceId: WS,
    name: 'Traders',
    type: 'trader',
    capabilities: ['read', 'trade'],
    memberIds,
  });
}

async function contract(id: string, proposedBy: string, title: string, extra: Record<string, unknown> = {}) {
  await db.insert(proposals).values({ id, workspaceId: WS, proposedBy, title, description: 'pitch', ...extra });
}

async function comment(id: string, proposalId: string, from: string, content: string, at: Date) {
  await db.insert(proposalMessages).values({ id, workspaceId: WS, proposalId, from, content, createdAt: at });
}

describe('the inbox', () => {
  test('carries comments on my contract, replies in my threads, and new contracts', async () => {
    await participant('me');
    await participant('other');
    await participant('stranger');
    await seedFloor(['me', 'other', 'stranger']);
    await contract('c-mine', 'me', 'My contract');
    await contract('c-theirs', 'other', 'Their contract');
    await comment('m1', 'c-mine', 'other', 'question about your contract', new Date('2026-08-19T10:00:00Z'));
    await comment('m2', 'c-theirs', 'me', 'my own question', new Date('2026-08-19T10:05:00Z'));
    await comment('m3', 'c-theirs', 'stranger', 'answering you', new Date('2026-08-19T10:10:00Z'));

    const { items, unread } = await listNotifications('me');
    const kinds = items.map(i => `${i.kind}:${i.actor}`);

    // Newest first: the reply, then the new contract, then the comment.
    expect(kinds).toContain('comment:other');
    expect(kinds).toContain('reply:stranger');
    expect(kinds).toContain('contract:other');
    // Never my own comment, never my own contract.
    expect(items.some(i => i.actor === 'me')).toBe(false);
    expect(unread).toBe(items.length);
    expect(items[0].at.getTime()).toBeGreaterThanOrEqual(items[items.length - 1].at.getTime());
  });

  test('replying to a thread does not backfill what was said before I arrived', async () => {
    // Reported 2026-08-22: a first reply in an existing thread made every
    // older comment in it appear as an unread notification from the past.
    await participant('me');
    await participant('other');
    await participant('stranger');
    await seedFloor(['me', 'other', 'stranger']);
    await contract('c-theirs', 'other', 'Their contract');
    await comment('old1', 'c-theirs', 'other', 'before me', new Date('2026-08-19T09:00:00Z'));
    await comment('old2', 'c-theirs', 'stranger', 'also before me', new Date('2026-08-19T09:30:00Z'));
    await comment('mine', 'c-theirs', 'me', 'my first reply', new Date('2026-08-19T10:00:00Z'));
    await comment('after', 'c-theirs', 'stranger', 'answering you', new Date('2026-08-19T10:30:00Z'));

    const { items } = await listNotifications('me');
    const ids = items.map(i => i.commentId);
    // Only what came after I spoke is news addressed to me. (The contract
    // itself still lands as a new-contract item; that one is correct.)
    expect(ids).toContain('after');
    expect(ids).not.toContain('old1');
    expect(ids).not.toContain('old2');
    expect(items.filter(i => i.kind === 'reply')).toHaveLength(1);
  });

  test('replying under a market thread does not backfill it either', async () => {
    await participant('me');
    await participant('trader');
    await seedFloor(['me', 'trader']);
    await db.insert(markets).values({
      id: 'mkt-1',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly traders',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
    });
    const say = (id: string, from: string, content: string, at: Date) =>
      db.insert(marketMessages).values({
        id,
        workspaceId: WS,
        marketId: 'mkt-1',
        from,
        content,
        createdAt: at,
      });
    await say('old', 'trader', 'before me', new Date('2026-08-19T09:00:00Z'));
    await say('mine', 'me', 'my first reply', new Date('2026-08-19T10:00:00Z'));
    await say('after', 'trader', 'answering you', new Date('2026-08-19T11:00:00Z'));

    const { items } = await listNotifications('me');
    const ids = items.map(i => i.commentId);
    expect(ids).toContain('after');
    expect(ids).not.toContain('old');
  });

  test('shows an event whose email is switched off', async () => {
    await participant('me', {
      notifyCommentOnMyProposal: false,
      notifyReplyToMyComment: false,
      notifyNewProposal: false,
    });
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-mine', 'me', 'My contract');
    await comment(
      'm1',
      'c-mine',
      'other',
      'you switched the email off, not the fact',
      new Date('2026-08-19T10:00:00Z'),
    );

    const { items } = await listNotifications('me');
    expect(items.map(i => i.kind)).toContain('comment');
  });

  test('counts a comment on a conditional market against its contract', async () => {
    await participant('me');
    await participant('trader');
    await seedFloor(['me', 'trader']);
    await contract('c-mine', 'me', 'My contract');
    await db.insert(markets).values({
      id: 'mkt-cond',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly traders',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: 'c-mine',
      branch: 'approved',
    });
    await db.insert(marketMessages).values({
      id: 'mm1',
      workspaceId: WS,
      marketId: 'mkt-cond',
      from: 'trader',
      content: 'priced too high',
      createdAt: new Date('2026-08-19T11:00:00Z'),
    });

    const { items } = await listNotifications('me');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('comment');
    // Titled by the contract, and linked to it, not to the branch market.
    expect(items[0].subject).toBe('My contract');
    expect(items[0].proposalId).toBe('c-mine');
    expect(items[0].workspaceSlug).toBe('lookpilot');
    // The row points at the comment itself, which is what lets the floor
    // scroll to that line and flash it instead of just opening the page.
    expect(items[0].commentId).toBe('mm1');
  });

  test('a decision on my own contract lands, with the reason', async () => {
    await participant('me');
    await seedFloor(['me']);
    await contract('c-mine', 'me', 'My contract', {
      status: 'declined',
      resolvedAt: new Date('2026-08-19T12:00:00Z'),
      declineReason: 'out of scope this quarter',
    });

    const { items } = await listNotifications('me');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('decision');
    expect(items[0].detail).toBe('out of scope this quarter');
  });

  test('marking seen clears unread without dropping the items', async () => {
    await participant('me');
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-mine', 'me', 'My contract');
    await comment('m1', 'c-mine', 'other', 'hello', new Date('2026-08-19T10:00:00Z'));

    expect((await listNotifications('me')).unread).toBe(1);
    await markNotificationsSeen('me');
    const after = await listNotifications('me');
    expect(after.unread).toBe(0);
    expect(after.items).toHaveLength(1);
  });

  test('reading ONE item takes exactly one off the count', async () => {
    await participant('me');
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-mine', 'me', 'My contract');
    await comment('m1', 'c-mine', 'other', 'first', new Date('2026-08-19T10:00:00Z'));
    await comment('m2', 'c-mine', 'other', 'second', new Date('2026-08-19T10:01:00Z'));

    const before = await listNotifications('me');
    expect(before.unread).toBe(2);

    await markNotificationRead('me', before.items[0].id);
    const after = await listNotifications('me');
    expect(after.unread).toBe(1);
    expect(after.items.find(i => i.id === before.items[0].id)?.unread).toBe(false);
    expect(after.items.find(i => i.id === before.items[1].id)?.unread).toBe(true);

    // Clicking the same row twice is not a second decrement.
    await markNotificationRead('me', before.items[0].id);
    expect((await listNotifications('me')).unread).toBe(1);
  });

  test('a fresh account opens on an empty inbox, not on a backlog', async () => {
    // The read watermark defaults to now, so history that predates the
    // account is not counted as unread.
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-old', 'other', 'Older contract');
    await db.insert(authUser).values({ id: 'u-fresh', name: 'fresh', email: 'fresh@example.com' });
    await db.insert(agents).values({ id: 'me', apiKeyHash: 'h', balance: 0, nickname: 'me', authUserId: 'u-fresh' });

    const { unread } = await listNotifications('me');
    expect(unread).toBe(0);
  });
});

// The matrix's new kinds and its web cells (owner ask 2026-08-24: the bell
// carries settlements and decisions on contracts you are involved in, and
// each kind's web cell decides whether the bell derives it at all).

describe('the matrix in the bell', () => {
  const market = (id: string, fields: Record<string, unknown> = {}) =>
    db.insert(markets).values({
      id,
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Weekly traders',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      ...fields,
    });
  const trade = (id: string, agentId: string, marketId: string) =>
    db.insert(trades).values({
      id,
      workspaceId: WS,
      agentId,
      marketId,
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: new Date(),
    });

  test('a market I traded settling lands as a settled item, with the value', async () => {
    await participant('me');
    await participant('other');
    await seedFloor(['me', 'other']);
    await market('mkt-1', {
      resolved: true,
      voided: false,
      active: false,
      actualValue: 62,
      resolvedAt: new Date('2026-08-24T10:00:00Z'),
    });
    await trade('t1', 'me', 'mkt-1');

    const { items } = await listNotifications('me');
    const settled = items.find(i => i.kind === 'settled');
    expect(settled).toBeDefined();
    expect(settled!.detail).toBe('Settled at 62.');
    expect(settled!.marketId).toBe('mkt-1');
  });

  test('removing my contract from the board is not a decision and leaves no row', async () => {
    // docs/vision.md: withdrawing is your own doing, removing is admin
    // cleanup; neither is a decision, so neither produces a record. The
    // remove path stamps resolvedAt like a decision does, which is how a
    // removed contract used to surface as "Declined." in the bell.
    await participant('me');
    await seedFloor(['me']);
    await contract('c-removed', 'me', 'Spam that got cleaned up', {
      status: 'removed',
      resolvedAt: new Date('2026-08-19T12:00:00Z'),
    });
    await contract('c-withdrawn', 'me', 'Changed my mind', {
      status: 'withdrawn',
      resolvedAt: new Date('2026-08-19T13:00:00Z'),
    });

    const { items } = await listNotifications('me');
    expect(items.filter(i => i.kind === 'decision')).toEqual([]);
  });

  test('a decision on a contract I traded lands, though it is not mine', async () => {
    await participant('me');
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-theirs', 'other', 'Their contract', {
      status: 'declined',
      resolvedAt: new Date('2026-08-24T11:00:00Z'),
      declineReason: 'not now',
    });
    await market('mkt-b', { proposalId: 'c-theirs', branch: 'approved' });
    await trade('t1', 'me', 'mkt-b');

    const { items } = await listNotifications('me');
    const dec = items.find(i => i.kind === 'decision');
    expect(dec).toBeDefined();
    expect(dec!.subject).toBe('Their contract');
    expect(dec!.detail).toBe('not now');
  });

  test('a kind whose web cell is off is not derived at all', async () => {
    await participant('other');
    await db.insert(authUser).values({ id: 'u-me', name: 'me', email: 'me@example.com' });
    await db.insert(agents).values({
      id: 'me',
      apiKeyHash: 'h-me',
      balance: 0,
      nickname: 'me',
      authUserId: 'u-me',
      notificationsSeenAt: new Date('2020-01-01'),
      notificationChannels: { contract: { web: false } },
    });
    await seedFloor(['me', 'other']);
    await contract('c-new', 'other', 'A new contract');

    const { items, unread } = await listNotifications('me');
    expect(items.find(i => i.kind === 'contract')).toBeUndefined();
    expect(unread).toBe(0);
  });

  test('the anyComment firehose, web cell on, shows floor comments once each', async () => {
    await participant('other');
    await db.insert(authUser).values({ id: 'u-me', name: 'me', email: 'me@example.com' });
    await db.insert(agents).values({
      id: 'me',
      apiKeyHash: 'h-me',
      balance: 0,
      nickname: 'me',
      authUserId: 'u-me',
      notificationsSeenAt: new Date('2020-01-01'),
      notificationChannels: { anyComment: { web: true } },
    });
    await seedFloor(['me', 'other']);
    await contract('c-mine', 'me', 'My contract');
    await contract('c-theirs', 'other', 'Their contract');
    // On MY contract: already carried as kind comment, never twice.
    await comment('m1', 'c-mine', 'other', 'on yours', new Date('2026-08-24T09:00:00Z'));
    // On theirs, a thread I am not in: only the firehose carries it.
    await comment('m2', 'c-theirs', 'other', 'somewhere else', new Date('2026-08-24T09:05:00Z'));

    const { items } = await listNotifications('me');
    const m1 = items.filter(i => i.commentId === 'm1');
    expect(m1).toHaveLength(1);
    expect(m1[0].kind).toBe('comment');
    const m2 = items.filter(i => i.commentId === 'm2');
    expect(m2).toHaveLength(1);
    expect(m2[0].kind).toBe('anyComment');
  });
});
