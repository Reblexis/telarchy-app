/**
 * Participant email notifications (docs/vision.md, "Participant email
 * notifications"): who actually gets mail when a comment lands or a contract
 * goes on the ballot.
 *
 * These are the rules a person notices when they are broken: being mailed
 * about your own comment, being mailed twice for one comment, being mailed
 * after switching it off, and hearing nothing when someone answers you.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { db, ensureMigrations, truncateAll } from './harness/test-db';
import {
  agents, authUser, markets, marketMessages, permissionGroups,
  proposals, proposalMessages, workspaces,
} from '../db/schema';
import { initialPool } from '../lib/amm';
import { notifyCommentPosted, notifyProposalCreated } from '../services/notifications';

const realFetch = global.fetch;
let sent: Array<{ to: string; subject: string; text: string }>;

beforeAll(async () => { await ensureMigrations(); });

beforeEach(async () => {
  await truncateAll();
  sent = [];
  process.env.RESEND_API_KEY = 'test-key';
  global.fetch = jest.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body);
    sent.push({ to: body.to[0], subject: body.subject, text: body.text });
    return new Response('{}', { status: 200 });
  }) as any;
});

afterEach(() => { global.fetch = realFetch; delete process.env.RESEND_API_KEY; });

const WS = 'ws-notif';

/** A participant with a browser account, i.e. one that has an address. */
async function human(id: string, email: string, prefs: Partial<{
  notifyCommentOnMyProposal: boolean; notifyReplyToMyComment: boolean; notifyNewProposal: boolean;
}> = {}) {
  await db.insert(authUser).values({ id: `u-${id}`, name: id, email });
  await db.insert(agents).values({ id, apiKeyHash: `h-${id}`, balance: 0, nickname: id, authUserId: `u-${id}`, ...prefs });
}

/** A key-only participant: no browser account, so no address anywhere. */
async function bot(id: string) {
  await db.insert(agents).values({ id, apiKeyHash: `h-${id}`, balance: 0, nickname: id });
}

async function seedWorkspace(memberIds: string[]) {
  await db.insert(workspaces).values({
    id: WS, name: 'LookPilot', createdBy: 'poster', visibility: 'public', slug: 'lookpilot',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-traders', workspaceId: WS, name: 'Traders', type: 'trader',
    capabilities: ['read', 'trade'], memberIds,
  });
}

async function seedProposal() {
  await db.insert(proposals).values({
    id: 'prop-1', workspaceId: WS, proposedBy: 'poster', title: 'Ship the landing page', description: 'do the thing',
  });
}

async function comment(id: string, from: string, content = 'a comment') {
  await db.insert(proposalMessages).values({ id, workspaceId: WS, proposalId: 'prop-1', from, content, createdAt: new Date() });
}

describe('a comment under a contract', () => {
  test('reaches the poster, and never the person who wrote it', async () => {
    await human('poster', 'poster@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();
    await comment('m1', 'commenter');

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'what is the channel?', proposalId: 'prop-1' });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    expect(sent[0].subject).toContain('Ship the landing page');
    expect(sent[0].text).toContain('what is the channel?');
    // The link out and the way off are both in the message, always.
    expect(sent[0].text).toContain('/lookpilot');
    expect(sent[0].text).toContain('#account');
  });

  test('reaches everyone else already in the thread', async () => {
    await human('poster', 'poster@example.com');
    await human('asker', 'asker@example.com');
    await human('answerer', 'answerer@example.com');
    await seedWorkspace(['poster', 'asker', 'answerer']);
    await seedProposal();
    await comment('m1', 'asker');
    await comment('m2', 'answerer');

    await notifyCommentPosted({ workspaceId: WS, from: 'answerer', content: 'here is why', proposalId: 'prop-1' });

    expect(sent.map(s => s.to).sort()).toEqual(['asker@example.com', 'poster@example.com']);
    const asker = sent.find(s => s.to === 'asker@example.com')!;
    expect(asker.text).toContain('you commented in this thread');
  });

  test('a poster who also commented gets ONE email, as the poster', async () => {
    await human('poster', 'poster@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();
    await comment('m1', 'poster');
    await comment('m2', 'commenter');

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'ping', proposalId: 'prop-1' });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('poster@example.com');
    expect(sent[0].text).toContain('a contract you posted');
  });

  test('a switched-off participant hears nothing', async () => {
    await human('poster', 'poster@example.com', { notifyCommentOnMyProposal: false });
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'ping', proposalId: 'prop-1' });

    expect(sent).toHaveLength(0);
  });

  test('a key-only participant is skipped: there is no address', async () => {
    await bot('poster');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'ping', proposalId: 'prop-1' });

    expect(sent).toHaveLength(0);
  });

  test('a Resend outage does not surface to the caller', async () => {
    global.fetch = jest.fn(async () => { throw new Error('no network'); }) as any;
    await human('poster', 'poster@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();

    await expect(notifyCommentPosted({
      workspaceId: WS, from: 'commenter', content: 'ping', proposalId: 'prop-1',
    })).resolves.toBeUndefined();
  });
});

describe('a comment under a market', () => {
  test('reaches the thread, and has no poster to reach', async () => {
    await human('asker', 'asker@example.com');
    await human('answerer', 'answerer@example.com');
    await seedWorkspace(['asker', 'answerer']);
    await db.insert(markets).values({
      id: 'mkt-1', workspaceId: WS, metricId: 'metric-1', metricName: 'Net 2026',
      targetDate: '2026-12', rangeMin: 0, rangeMax: 100,
      shares: [0, 0], liquidity: 10, pool: initialPool(10),
      active: true, resolved: false, voided: false, proposalId: null, branch: null,
    });
    await db.insert(marketMessages).values({
      id: 'mm1', workspaceId: WS, marketId: 'mkt-1', from: 'asker', content: 'why so low?', createdAt: new Date(),
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'answerer', content: 'thin book', marketId: 'mkt-1' });

    expect(sent.map(s => s.to)).toEqual(['asker@example.com']);
    expect(sent[0].subject).toContain('Net 2026 2026-12');
  });
});

describe('a comment under a contract\'s conditional market', () => {
  /**
   * The bug this pins (found on the live floor 2026-08-19): a conditional
   * market belongs to a contract, but comments on it went into the market
   * thread, which has no poster, so the person being asked to do the work
   * heard nothing about half the conversation about their own contract.
   */
  test('reaches the contract poster, not just the thread', async () => {
    await human('poster', 'poster@example.com');
    await human('trader', 'trader@example.com');
    await seedWorkspace(['poster', 'trader']);
    await seedProposal();
    await db.insert(markets).values({
      id: 'mkt-cond', workspaceId: WS, metricId: 'metric-1', metricName: 'Weekly traders',
      targetDate: '2026-12', rangeMin: 0, rangeMax: 100,
      shares: [0, 0], liquidity: 10, pool: initialPool(10),
      active: true, resolved: false, voided: false, proposalId: 'prop-1', branch: 'approved',
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'trader', content: 'priced too high', marketId: 'mkt-cond' });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    // Titled by the contract, not the branch market: that is what the
    // reader recognises in an inbox.
    expect(sent[0].subject).toContain('Ship the landing page');
    expect(sent[0].text).toContain('a contract you posted');
  });

  test('a base market has no poster to reach', async () => {
    await human('poster', 'poster@example.com');
    await human('trader', 'trader@example.com');
    await seedWorkspace(['poster', 'trader']);
    await seedProposal();
    await db.insert(markets).values({
      id: 'mkt-base', workspaceId: WS, metricId: 'metric-1', metricName: 'Weekly traders',
      targetDate: '2026-12', rangeMin: 0, rangeMax: 100,
      shares: [0, 0], liquidity: 10, pool: initialPool(10),
      active: true, resolved: false, voided: false, proposalId: null, branch: null,
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'trader', content: 'thin book', marketId: 'mkt-base' });

    expect(sent).toHaveLength(0);
  });
});

describe('a new contract on the ballot', () => {
  test('reaches only the members who asked for it, never the poster', async () => {
    await human('poster', 'poster@example.com', { notifyNewProposal: true });
    await human('watcher', 'watcher@example.com', { notifyNewProposal: true });
    await human('quiet', 'quiet@example.com');
    await seedWorkspace(['poster', 'watcher', 'quiet']);

    await notifyProposalCreated({ workspaceId: WS, proposedBy: 'poster', title: 'Rewrite the pricing page', description: 'why' });

    expect(sent.map(s => s.to)).toEqual(['watcher@example.com']);
    expect(sent[0].subject).toContain('Rewrite the pricing page');
  });

  test('is off unless asked for: a default account hears nothing', async () => {
    await human('poster', 'poster@example.com');
    await human('member', 'member@example.com');
    await seedWorkspace(['poster', 'member']);

    await notifyProposalCreated({ workspaceId: WS, proposedBy: 'poster', title: 'Anything' });

    expect(sent).toHaveLength(0);
  });
});
