/**
 * The notifications inbox (GET /api/notifications), the bell's contents.
 *
 * The rule this file exists to pin: the inbox shows EVERYTHING that happened
 * to you, including events whose email you switched off. Mail is interruption
 * a person tunes; the inbox is the record, and a record with holes in it is
 * worse than no record.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { db, ensureMigrations, truncateAll } from './harness/test-db';
import {
  agents, authUser, markets, marketMessages, permissionGroups, proposals, proposalMessages, workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { listNotifications, markNotificationsSeen } from '../services/notifications';

beforeAll(async () => { await ensureMigrations(); });
beforeEach(async () => { await truncateAll(); });

const WS = 'ws-inbox';

async function participant(id: string, prefs: Record<string, boolean> = {}) {
  await db.insert(authUser).values({ id: `u-${id}`, name: id, email: `${id}@example.com` });
  await db.insert(agents).values({
    id, apiKeyHash: `h-${id}`, balance: 0, nickname: id, authUserId: `u-${id}`,
    // Read state starts in the past, so seeded rows count as unread.
    notificationsSeenAt: new Date('2020-01-01'), ...prefs,
  });
}

async function seedFloor(memberIds: string[]) {
  await db.insert(workspaces).values({
    id: WS, name: 'LookPilot', createdBy: 'poster', visibility: 'public', slug: 'lookpilot',
  });
  await db.insert(permissionGroups).values({
    id: 'grp', workspaceId: WS, name: 'Traders', type: 'trader', capabilities: ['read', 'trade'], memberIds,
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

  test('shows an event whose email is switched off', async () => {
    await participant('me', { notifyCommentOnMyProposal: false, notifyReplyToMyComment: false, notifyNewProposal: false });
    await participant('other');
    await seedFloor(['me', 'other']);
    await contract('c-mine', 'me', 'My contract');
    await comment('m1', 'c-mine', 'other', 'you switched the email off, not the fact', new Date('2026-08-19T10:00:00Z'));

    const { items } = await listNotifications('me');
    expect(items.map(i => i.kind)).toContain('comment');
  });

  test('counts a comment on a conditional market against its contract', async () => {
    await participant('me');
    await participant('trader');
    await seedFloor(['me', 'trader']);
    await contract('c-mine', 'me', 'My contract');
    await db.insert(markets).values({
      id: 'mkt-cond', workspaceId: WS, metricId: 'metric-1', metricName: 'Weekly traders',
      targetDate: '2026-12', rangeMin: 0, rangeMax: 100, shares: [0, 0], liquidity: 10, pool: initialPool(10),
      active: true, resolved: false, voided: false, proposalId: 'c-mine', branch: 'approved',
    });
    await db.insert(marketMessages).values({
      id: 'mm1', workspaceId: WS, marketId: 'mkt-cond', from: 'trader',
      content: 'priced too high', createdAt: new Date('2026-08-19T11:00:00Z'),
    });

    const { items } = await listNotifications('me');
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('comment');
    // Titled by the contract, and linked to it, not to the branch market.
    expect(items[0].subject).toBe('My contract');
    expect(items[0].proposalId).toBe('c-mine');
    expect(items[0].workspaceSlug).toBe('lookpilot');
  });

  test('a decision on my own contract lands, with the reason', async () => {
    await participant('me');
    await seedFloor(['me']);
    await contract('c-mine', 'me', 'My contract', {
      status: 'declined', resolvedAt: new Date('2026-08-19T12:00:00Z'), declineReason: 'out of scope this quarter',
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
