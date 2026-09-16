/**
 * THE RULE: your score includes the accounts you own (docs/seasons.md, "Your
 * score includes the accounts you own"; owner decision 2026-09-16: "their own
 * + sum of all profit of their owned accounts / bots / agents"). The
 * arithmetic, without a database: an owner's number is its own plus every
 * account it owns, transitively, each counted once; the bot keeps its own
 * number; and the pool pays once per person, so a bot whose owner is an
 * entrant takes no share of its own.
 */
import { foldHouseholds, householdMembers } from '../lib/leaderboard';
import { type LadderRung, settleSeason } from '../lib/seasons';

const T0 = new Date('2026-09-01T00:00:00Z');

describe('householdMembers', () => {
  test('an owner reaches its bots and their bots, each once', () => {
    const ownerOf = new Map([
      ['bot', 'owner'],
      ['subbot', 'bot'],
    ]);
    expect([...householdMembers('owner', ownerOf)].sort()).toEqual(['bot', 'owner', 'subbot']);
    expect([...householdMembers('bot', ownerOf)].sort()).toEqual(['bot', 'subbot']);
    expect([...householdMembers('subbot', ownerOf)]).toEqual(['subbot']);
  });

  test('a cycle is cut: two accounts owning each other count each other once and stop', () => {
    const ownerOf = new Map([
      ['a', 'b'],
      ['b', 'a'],
    ]);
    expect([...householdMembers('a', ownerOf)].sort()).toEqual(['a', 'b']);
  });
});

describe('foldHouseholds', () => {
  test("an owner's number is its own plus its bots'; the bot keeps its own", () => {
    const own = new Map([
      ['owner', 10],
      ['bot', 25],
    ]);
    const folded = foldHouseholds(own, new Map([['bot', 'owner']]));
    expect(folded.get('owner')).toBe(35);
    expect(folded.get('bot')).toBe(25);
  });

  test('transitive: the owner gets the sub-bot too, and the bot gets its own sub-bot', () => {
    const own = new Map([
      ['owner', 1],
      ['bot', 2],
      ['subbot', 4],
    ]);
    const folded = foldHouseholds(
      own,
      new Map([
        ['bot', 'owner'],
        ['subbot', 'bot'],
      ]),
    );
    expect(folded.get('owner')).toBe(7);
    expect(folded.get('bot')).toBe(6);
    expect(folded.get('subbot')).toBe(4);
  });

  test('an owner with no number of its own gets a row from its bots', () => {
    const folded = foldHouseholds(new Map([['bot', 12]]), new Map([['bot', 'owner']]));
    expect(folded.get('owner')).toBe(12);
  });

  test('a bot with no number adds nothing and is not invented', () => {
    const folded = foldHouseholds(new Map([['owner', 3]]), new Map([['bot', 'owner']]));
    expect(folded.get('owner')).toBe(3);
    expect(folded.has('bot')).toBe(false);
  });

  test('the bankroll sent to a bot cancels inside the household', () => {
    // Owner sent 15,000 (a loss on its own row); the bot received 15,000 and
    // lost 975 trading. The household made -975 against everyone else.
    const own = new Map([
      ['owner', -15000],
      ['bot', 14025],
    ]);
    const folded = foldHouseholds(own, new Map([['bot', 'owner']]));
    expect(folded.get('owner')).toBe(-975);
  });

  test('rounds to two decimals', () => {
    const folded = foldHouseholds(
      new Map([
        ['owner', 0.1],
        ['bot', 0.2],
      ]),
      new Map([['bot', 'owner']]),
    );
    expect(folded.get('owner')).toBe(0.3);
  });
});

describe('the pool pays once per person (settleSeason paidVia)', () => {
  const entrants = (bot: { paidVia?: string | null }) => [
    { agentId: 'owner', baselineProfit: 0, currentProfit: 100, enteredAt: T0 },
    { agentId: 'bot', baselineProfit: 0, currentProfit: 60, enteredAt: T0, ...bot },
    { agentId: 'other', baselineProfit: 0, currentProfit: 40, enteredAt: T0 },
  ];

  test('proportional: a bot paid through its owner takes no share and does not dilute the pool', () => {
    const { ranked, rolloverUsd } = settleSeason(entrants({ paidVia: 'owner' }), [], 700, {
      payoutMode: 'proportional',
    });
    const byId = new Map(ranked.map(r => [r.agentId, r]));
    // Weights: owner 100, other 40; the bot's 60 is already inside the owner's 100.
    expect(byId.get('owner')?.prizeUsd).toBe(500);
    expect(byId.get('other')?.prizeUsd).toBe(200);
    expect(byId.get('bot')?.prizeUsd).toBe(0);
    expect(byId.get('bot')?.eligible).toBe(false);
    expect(rolloverUsd).toBe(0);
  });

  test('the bot keeps its rank, so it can see where its own score stands', () => {
    const { ranked } = settleSeason(entrants({ paidVia: 'owner' }), [], 700, { payoutMode: 'proportional' });
    expect(ranked.map(r => r.agentId)).toEqual(['owner', 'bot', 'other']);
    expect(ranked[1].rank).toBe(2);
  });

  test('ladder: a bot paid through its owner burns no rung', () => {
    const ladder: LadderRung[] = [
      { place: 1, prizeUsd: 500 },
      { place: 2, prizeUsd: 250 },
    ];
    const { ranked } = settleSeason(entrants({ paidVia: 'owner' }), ladder, 1000, { payoutMode: 'ladder' });
    const byId = new Map(ranked.map(r => [r.agentId, r]));
    expect(byId.get('owner')?.prizeUsd).toBe(500);
    expect(byId.get('bot')?.prizeUsd).toBe(0);
    expect(byId.get('other')?.prizeUsd).toBe(250);
  });

  test('a bot whose owner has not entered is paid on its own score like any entrant', () => {
    const { ranked } = settleSeason(entrants({ paidVia: null }), [], 700, { payoutMode: 'proportional' });
    const byId = new Map(ranked.map(r => [r.agentId, r]));
    expect(byId.get('bot')?.prizeUsd).toBe(210);
    expect(byId.get('bot')?.eligible).toBe(true);
  });
});

describe('the pool goes to the nearest ancestor in the season (owner, 2026-09-16)', () => {
  // "if there is an ancestor in the hierarchy that is registered in season
  // as well then the pool goes towards them"
  const { paidViaOf } = require('../routes/leaderboard') as typeof import('../routes/leaderboard');
  const ownerOf = new Map([
    ['subbot', 'bot'],
    ['bot', 'owner'],
  ]);

  test('a sub-bot whose bot did not enter is paid through the owner, a generation up', () => {
    expect(paidViaOf(['subbot', 'owner'], ownerOf).get('subbot')).toBe('owner');
  });

  test('the nearest entered ancestor wins when both entered', () => {
    const via = paidViaOf(['subbot', 'bot', 'owner'], ownerOf);
    expect(via.get('subbot')).toBe('bot');
    expect(via.get('bot')).toBe('owner');
    expect(via.get('owner')).toBeNull();
  });

  test('no entered ancestor: paid on its own score', () => {
    expect(paidViaOf(['subbot'], ownerOf).get('subbot')).toBeNull();
  });

  test('a cycle in the ownership record stops the climb', () => {
    expect(
      paidViaOf(
        ['a'],
        new Map([
          ['a', 'b'],
          ['b', 'a'],
        ]),
      ).get('a'),
    ).toBeNull();
  });
});
