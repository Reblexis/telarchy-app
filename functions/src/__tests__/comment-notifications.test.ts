/**
 * Participant email notifications (docs/vision.md, "Participant email
 * notifications"): who actually gets mail when a comment lands or a proposal
 * goes on the ballot.
 *
 * These are the rules a person notices when they are broken: being mailed
 * about your own comment, being mailed twice for one comment, being mailed
 * after switching it off, and hearing nothing when someone answers you.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { eq } from 'drizzle-orm';
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
import {
  notifyCommentPosted,
  notifyMarketResolved,
  notifyProposalCreated,
  notifyProposalDecided,
} from '../services/notifications';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const realFetch = global.fetch;
let sent: Array<{ to: string; subject: string; text: string }>;

beforeAll(async () => {
  await ensureMigrations();
});

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

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.RESEND_API_KEY;
});

const WS = 'ws-notif';

/** A participant with a browser account, i.e. one that has an address. */
async function human(
  id: string,
  email: string,
  prefs: Partial<{
    notifyCommentOnMyProposal: boolean;
    notifyReplyToMyComment: boolean;
    notifyNewProposal: boolean;
    notifyAnyComment: boolean;
    notifyMarketResolved: boolean;
    notifyContractDecided: boolean;
  }> = {},
) {
  await db.insert(authUser).values({ id: `u-${id}`, name: id, email });
  await db
    .insert(agents)
    .values({ id, apiKeyHash: `h-${id}`, balance: 0, nickname: id, authUserId: `u-${id}`, ...prefs });
}

/** A key-only participant: no browser account, so no address anywhere. */
async function bot(id: string) {
  await db.insert(agents).values({ id, apiKeyHash: `h-${id}`, balance: 0, nickname: id });
}

async function seedWorkspace(memberIds: string[]) {
  await db.insert(workspaces).values({
    id: WS,
    name: 'LookPilot',
    createdBy: 'poster',
    visibility: 'public',
    slug: 'lookpilot',
  });
  await db.insert(permissionGroups).values({
    id: 'grp-traders',
    workspaceId: WS,
    name: 'Traders',
    type: 'trader',
    capabilities: ['read', 'trade'],
    memberIds,
  });
}

async function seedProposal() {
  await db.insert(proposals).values({
    id: 'prop-1',
    workspaceId: WS,
    proposedBy: 'poster',
    title: 'Ship the landing page',
    description: 'do the thing',
  });
}

async function comment(id: string, from: string, content = 'a comment') {
  await db
    .insert(proposalMessages)
    .values({ id, workspaceId: WS, proposalId: 'prop-1', from, content, createdAt: new Date() });
}

describe('a comment under a proposal', () => {
  test('reaches the poster, and never the person who wrote it', async () => {
    await human('poster', 'poster@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();
    await comment('m1', 'commenter');

    await notifyCommentPosted({
      workspaceId: WS,
      from: 'commenter',
      content: 'what is the channel?',
      proposalId: 'prop-1',
    });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    expect(sent[0].subject).toContain('Ship the landing page');
    expect(sent[0].text).toContain('what is the channel?');
    // The link out and the way off are both in the message, always.
    expect(sent[0].text).toContain('/lookpilot');
    // The way off lands ON the switches, not merely in the account dialog.
    expect(sent[0].text).toContain('#emails');
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
    expect(sent[0].text).toContain('a proposal you posted');
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
    global.fetch = jest.fn(async () => {
      throw new Error('no network');
    }) as any;
    await human('poster', 'poster@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'commenter']);
    await seedProposal();

    await expect(
      notifyCommentPosted({
        workspaceId: WS,
        from: 'commenter',
        content: 'ping',
        proposalId: 'prop-1',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('a comment under a market', () => {
  test('reaches the thread, and has no poster to reach', async () => {
    await human('asker', 'asker@example.com');
    await human('answerer', 'answerer@example.com');
    await seedWorkspace(['asker', 'answerer']);
    await db.insert(markets).values({
      id: 'mkt-1',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Net 2026',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 10,
      pool: initialPool(10),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
      branch: null,
    });
    await db.insert(marketMessages).values({
      id: 'mm1',
      workspaceId: WS,
      marketId: 'mkt-1',
      from: 'asker',
      content: 'why so low?',
      createdAt: new Date(),
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'answerer', content: 'thin book', marketId: 'mkt-1' });

    expect(sent.map(s => s.to)).toEqual(['asker@example.com']);
    expect(sent[0].subject).toContain('Net 2026 2026-12');
  });
});

describe("a comment under a proposal's conditional market", () => {
  /**
   * The bug this pins (found on the live floor 2026-08-19): a conditional
   * market belongs to a proposal, but comments on it went into the market
   * thread, which has no poster, so the person being asked to do the work
   * heard nothing about half the conversation about their own proposal.
   */
  test('reaches the proposal poster, not just the thread', async () => {
    await human('poster', 'poster@example.com');
    await human('trader', 'trader@example.com');
    await seedWorkspace(['poster', 'trader']);
    await seedProposal();
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
      proposalId: 'prop-1',
      branch: 'approved',
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'trader', content: 'priced too high', marketId: 'mkt-cond' });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    // Titled by the proposal, not the branch market: that is what the
    // reader recognises in an inbox.
    expect(sent[0].subject).toContain('Ship the landing page');
    expect(sent[0].text).toContain('a proposal you posted');
  });

  test('a base market has no poster to reach', async () => {
    await human('poster', 'poster@example.com');
    await human('trader', 'trader@example.com');
    await seedWorkspace(['poster', 'trader']);
    await seedProposal();
    await db.insert(markets).values({
      id: 'mkt-base',
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
      proposalId: null,
      branch: null,
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'trader', content: 'thin book', marketId: 'mkt-base' });

    expect(sent).toHaveLength(0);
  });
});

describe('a new proposal on the ballot', () => {
  test('reaches only the members who asked for it, never the poster', async () => {
    await human('poster', 'poster@example.com', { notifyNewProposal: true });
    await human('watcher', 'watcher@example.com', { notifyNewProposal: true });
    await human('quiet', 'quiet@example.com');
    await seedWorkspace(['poster', 'watcher', 'quiet']);

    await notifyProposalCreated({
      workspaceId: WS,
      proposedBy: 'poster',
      title: 'Rewrite the pricing page',
      description: 'why',
    });

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

describe('a decision on your own proposal', () => {
  /** A proposal already decided, the way the routes leave it before mailing. */
  async function decided(fields: Record<string, unknown>) {
    await db.insert(proposals).values({
      id: 'prop-1',
      workspaceId: WS,
      proposedBy: 'poster',
      title: 'Ship the landing page',
      askUsd: 300,
      resolvedAt: new Date(),
      ...fields,
    });
  }

  test('an approval reaches the poster, with the ask on it', async () => {
    await human('poster', 'poster@example.com');
    await human('owner', 'owner@example.com');
    await seedWorkspace(['poster', 'owner']);
    await decided({ status: 'approved' });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    expect(sent[0].subject).toBe('Approved: Ship the landing page');
    expect(sent[0].text).toContain('$300');
    expect(sent[0].text).toContain('/lookpilot#proposal=prop-1');
  });

  test('a decline carries the written reason', async () => {
    await human('poster', 'poster@example.com');
    await seedWorkspace(['poster']);
    await decided({ status: 'declined', declineReason: 'Already delivered, so the gap is zero.' });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent[0].subject).toBe('Declined: Ship the landing page');
    expect(sent[0].text).toContain('Already delivered, so the gap is zero.');
  });

  test('a decline with no reason says so rather than leaving a blank', async () => {
    await human('poster', 'poster@example.com');
    await seedWorkspace(['poster']);
    await decided({ status: 'declined' });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent[0].text).toContain('No reason was given.');
  });

  test('has no switch: it goes out with every email preference off', async () => {
    await human('poster', 'poster@example.com', {
      notifyCommentOnMyProposal: false,
      notifyReplyToMyComment: false,
      notifyNewProposal: false,
    });
    await seedWorkspace(['poster']);
    await decided({ status: 'declined_spam' });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
    expect(sent[0].text).toContain('declined as spam');
  });

  test('says nothing while the proposal is still pending, or once withdrawn', async () => {
    await human('poster', 'poster@example.com');
    await seedWorkspace(['poster']);
    await decided({ status: 'pending', resolvedAt: null });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent).toHaveLength(0);
  });

  test('a key-only bot has no address, and that is not an error', async () => {
    await bot('poster');
    await seedWorkspace(['poster']);
    await decided({ status: 'approved' });

    await expect(notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' })).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});

/**
 * Every comment on a floor you belong to (owner ask 2026-08-21: "make sure
 * that i get email regarding telarchy when any comment is written ... should
 * be off by default ofc").
 *
 * The rule that costs something to get right is the last one: a watcher who is
 * also the poster, or already in the thread, still gets exactly one email, and
 * it names the closer reason. Two emails for one comment is how a person turns
 * the whole thing off.
 */
describe('watching every comment on a floor', () => {
  test('off by default, so a normal member hears nothing', async () => {
    await human('poster', 'poster@example.com');
    await human('member', 'member@example.com');
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'member', 'commenter']);
    await seedProposal();
    await comment('m1', 'commenter');

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'hello', proposalId: 'prop-1' });

    // Only the proposal's poster, on the switch that is on by default.
    expect(sent.map(s => s.to)).toEqual(['poster@example.com']);
  });

  test('a watcher hears about a comment on a proposal that is not theirs', async () => {
    await human('poster', 'poster@example.com', { notifyCommentOnMyProposal: false });
    await human('owner', 'owner@example.com', { notifyAnyComment: true });
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['poster', 'owner', 'commenter']);
    await seedProposal();
    await comment('m1', 'commenter');

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'anyone there', proposalId: 'prop-1' });

    expect(sent.map(s => s.to)).toEqual(['owner@example.com']);
    expect(sent[0].text).toContain('every comment on this workspace');
  });

  test('never about their own comment', async () => {
    await human('owner', 'owner@example.com', { notifyAnyComment: true });
    await seedWorkspace(['owner']);
    await seedProposal();
    await comment('m1', 'owner');

    await notifyCommentPosted({ workspaceId: WS, from: 'owner', content: 'my own words', proposalId: 'prop-1' });

    expect(sent).toHaveLength(0);
  });

  test('one email, not two, when they are also the poster', async () => {
    await human('owner', 'owner@example.com', { notifyAnyComment: true });
    await human('commenter', 'commenter@example.com');
    await seedWorkspace(['owner', 'commenter']);
    // The proposal is the watcher's own, so both switches would fire.
    await db.insert(proposals).values({
      id: 'prop-1',
      workspaceId: WS,
      proposedBy: 'owner',
      title: 'Ship the landing page',
    });
    await comment('m1', 'commenter');

    await notifyCommentPosted({ workspaceId: WS, from: 'commenter', content: 'ping', proposalId: 'prop-1' });

    expect(sent).toHaveLength(1);
    // And it names the closer reason, not the floor-wide one.
    expect(sent[0].text).toContain('commented on a proposal you posted');
  });

  test('it covers market threads too, not only proposals', async () => {
    await human('owner', 'owner@example.com', { notifyAnyComment: true });
    await human('trader', 'trader@example.com');
    await seedWorkspace(['owner', 'trader']);
    await db.insert(markets).values({
      id: 'mkt-1',
      workspaceId: WS,
      metricId: 'metric-1',
      metricName: 'Revenue',
      targetDate: '2026-12',
      rangeMin: 0,
      rangeMax: 100,
      shares: [0, 0],
      liquidity: 100,
      pool: initialPool(100),
      active: true,
      resolved: false,
      voided: false,
      proposalId: null,
    });
    await db.insert(marketMessages).values({
      id: 'mm-1',
      workspaceId: WS,
      marketId: 'mkt-1',
      from: 'trader',
      content: 'thin book',
      createdAt: new Date(),
    });

    await notifyCommentPosted({ workspaceId: WS, from: 'trader', content: 'thin book', marketId: 'mkt-1' });

    expect(sent.map(s => s.to)).toEqual(['owner@example.com']);
  });
});

// Owner ask 2026-08-24: "add email notifications on traded market resolving
// as well as a proposal on which user traded / commented / made being
// approved/declined". The proposer's mail already existed; these two blocks
// pin the new recipients.

describe('a decision reaches everyone with money or words on the proposal', () => {
  async function decidedWithPair(fields: Record<string, unknown> = {}) {
    await db.insert(proposals).values({
      id: 'prop-1',
      workspaceId: WS,
      proposedBy: 'poster',
      title: 'Ship the landing page',
      askUsd: 300,
      resolvedAt: new Date(),
      resolvedBy: 'owner',
      status: 'approved',
      ...fields,
    });
    await db.insert(markets).values({
      id: 'mkt-approved',
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
      proposalId: 'prop-1',
      branch: 'approved',
    });
  }
  const trade = (id: string, agentId: string) =>
    db.insert(trades).values({
      id,
      workspaceId: WS,
      agentId,
      marketId: 'mkt-approved',
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: new Date(),
    });

  test('a trader on a branch and a commenter in the thread both hear the verdict', async () => {
    await human('poster', 'poster@example.com');
    await human('owner', 'owner@example.com');
    await human('trader', 'trader@example.com');
    await human('voice', 'voice@example.com');
    await seedWorkspace(['poster', 'owner', 'trader', 'voice']);
    await decidedWithPair();
    await trade('t1', 'trader');
    await db.insert(proposalMessages).values({
      id: 'm1',
      workspaceId: WS,
      proposalId: 'prop-1',
      from: 'voice',
      content: 'is this priced right?',
      createdAt: new Date(),
    });

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent.map(x => x.to).sort()).toEqual(['poster@example.com', 'trader@example.com', 'voice@example.com']);
    const traderMail = sent.find(x => x.to === 'trader@example.com')!;
    // Not "your proposal": they took a side on it, they do not own it.
    expect(traderMail.text).toContain('this proposal');
    expect(traderMail.text).toContain('you traded or commented');
    const posterMail = sent.find(x => x.to === 'poster@example.com')!;
    expect(posterMail.text).toContain('your proposal');
  });

  test('the switch works, and the decider is never told about their own act', async () => {
    await human('poster', 'poster@example.com');
    await human('owner', 'owner@example.com');
    await human('trader', 'trader@example.com', { notifyContractDecided: false });
    await seedWorkspace(['poster', 'owner', 'trader']);
    await decidedWithPair();
    await trade('t1', 'trader');
    // The owner also traded the branch; deciding it must not mail them.
    await trade('t2', 'owner');

    await notifyProposalDecided({ workspaceId: WS, proposalId: 'prop-1' });

    expect(sent.map(x => x.to)).toEqual(['poster@example.com']);
  });
});

describe('a settled market mails its traders', () => {
  async function settledMarket(fields: Record<string, unknown> = {}) {
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
      pool: 0,
      active: false,
      resolved: true,
      voided: false,
      actualValue: 62,
      resolvedAt: new Date(),
      ...fields,
    });
  }
  const trade = (id: string, agentId: string) =>
    db.insert(trades).values({
      id,
      workspaceId: WS,
      agentId,
      marketId: 'mkt-1',
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: new Date(),
    });

  test('every trader hears the settled value, once, and bystanders nothing', async () => {
    await human('alice', 'alice@example.com');
    await human('bob', 'bob@example.com');
    await human('bystander', 'bystander@example.com');
    await seedWorkspace(['alice', 'bob', 'bystander']);
    await settledMarket();
    await trade('t1', 'alice');
    await trade('t2', 'alice'); // a second trade is not a second email
    await trade('t3', 'bob');

    await notifyMarketResolved({ workspaceId: WS, marketId: 'mkt-1' });

    expect(sent.map(x => x.to).sort()).toEqual(['alice@example.com', 'bob@example.com']);
    expect(sent[0].subject).toContain('Settled at 62');
    expect(sent[0].text).toContain('settled at 62');
    expect(sent[0].text).toContain('you traded this market');
  });

  test('the switch turns it off, and a voided market sends nothing', async () => {
    await human('alice', 'alice@example.com', { notifyMarketResolved: false });
    await human('bob', 'bob@example.com');
    await seedWorkspace(['alice', 'bob']);
    await settledMarket();
    await trade('t1', 'alice');
    await notifyMarketResolved({ workspaceId: WS, marketId: 'mkt-1' });
    expect(sent).toHaveLength(0);

    // Voided is not settled: the refund is the message.
    await db.update(markets).set({ voided: true }).where(eq(markets.id, 'mkt-1'));
    await db.insert(trades).values({
      id: 't2',
      workspaceId: WS,
      agentId: 'bob',
      marketId: 'mkt-1',
      direction: 'higher',
      shares: 5,
      cost: 2,
      createdAt: new Date(),
    });
    await notifyMarketResolved({ workspaceId: WS, marketId: 'mkt-1' });
    expect(sent).toHaveLength(0);
  });
});
