import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Stage 5 of the 2026-09-08 floor redesign (docs/ui-conventions.md, "The
 * proposals board (right rail)"): the board is the right rail, every row
 * carries its ask and both calls, rows are sorted by absolute impact, and
 * for the owner the board is an inbox.
 */

const fx = vi.hoisted(() => ({ ref: null as null | import('./floor-fixture').Fx }));

vi.mock('../../hooks/useAuth', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useAuth: () => ({ user: state.auth.user, loading: state.auth.loading, logout: async () => {} }) };
});
vi.mock('../../hooks/useEarnAvailable', async () => {
  const { makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  const state = fx.ref;
  return { useEarnAvailable: (signedIn: boolean) => (signedIn ? state.earn : null), clearEarnAvailableCache: () => {} };
});
vi.mock('../../lib/api', async () => {
  const { apiMock, makeFx } = await import('./floor-fixture');
  if (!fx.ref) fx.ref = makeFx();
  return apiMock(fx.ref);
});

const { TradePage } = await import('../TradePage');
const { renderFloor, resetFx, signIn, installObservers, freezeClock, OWNER_ID, OTHER_ID } = await import(
  './floor-fixture'
);
const state = () => fx.ref!;

beforeEach(() => {
  resetFx(state());
  installObservers();
  freezeClock();
  sessionStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
});

async function floor() {
  const r = renderFloor(TradePage);
  await screen.findByText('What will be', { exact: false });
  await waitFor(() => expect(document.querySelector('.pubws-ballot-row')).toBeTruthy());
  return r;
}

const board = () => document.querySelector('.pubws-rail--right [aria-label="Proposals"]') as HTMLElement;
const rowTitles = () => [...document.querySelectorAll('.pubws-ballot-title')].map(e => e.textContent ?? '');
/** The pending rows, in the order the board draws them. */
const rows = () => [...document.querySelectorAll('.pubws-ballot-row')] as HTMLElement[];
/** The row whose number is exactly this one. */
const rowNum = (n: number) =>
  rows().find(r => r.querySelector('.pubws-ballot-num')?.textContent === `#${n}`) as HTMLElement;

/** A proposal whose pair on the horizon on screen prices at these numbers. */
function proposal(
  over: Record<string, unknown>,
  approved: number,
  declined: number,
  pool = 300,
  liquidity = 425,
): Record<string, unknown> {
  return {
    id: 'p-x',
    number: 9,
    title: 'A proposal',
    description: 'Some work.',
    askUsd: 0,
    status: 'pending',
    proposedByName: 'telarchy-agents',
    proposedByHandle: OTHER_ID,
    createdAt: '2026-08-20T09:00:00.000Z',
    editedAt: null,
    marketPairCount: 1,
    markets: [
      {
        metricId: 'metric-active',
        metricName: 'Active traders',
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00.000Z',
        approvedConsensus: approved,
        declinedConsensus: declined,
        delta: approved - declined,
        approvedMarketId: 'xa',
        declinedMarketId: 'xd',
        approvedProbability: approved / 50,
        declinedProbability: declined / 50,
        approvedLiquidity: liquidity,
        declinedLiquidity: liquidity,
        approvedPool: pool,
        declinedPool: pool,
        approvedTraders: 1,
        declinedTraders: 1,
        approvedVolume: 10,
        declinedVolume: 10,
        rangeMin: 0,
        rangeMax: 50,
      },
    ],
    ...over,
  };
}

describe('the proposals board IS the right rail', () => {
  test('under the label PROPOSALS with the right-aligned mono meta "impact on 30 Sep"', async () => {
    await floor();
    const b = board();
    expect(b.closest('.pubws-rail--right')).toBeTruthy();
    expect(within(b).getByRole('heading', { name: 'Proposals' })).toBeTruthy();
    expect(b.querySelector('.pubws-lb-meta')?.textContent).toBe('impact on 30 Sep');
  });

  test('one quiet line says what a row is to a trader', async () => {
    await floor();
    expect(board().querySelector('.pubws-ballot-why')?.textContent).toBe(
      'Each is a pair of books: the number if approved, the number if declined. Trade either.',
    );
  });
});

describe('every row carries its ask and both calls', () => {
  test('under the title, in small mono, the two calls of the pair on screen', async () => {
    await floor();
    const paid = rowNum(3);
    const calls = paid.querySelector('.pubws-ballot-calls') as HTMLElement;
    expect(calls.textContent).toBe('if approved 17.04 · if declined 17.00');
    // At the pair band's precision: two calls that print equal at the floor's
    // usual precision grow decimals until the row adds up.
    const title = paid.querySelector('.pubws-ballot-title') as HTMLElement;
    expect(title.compareDocumentPosition(calls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('the icon row: the ask ALWAYS shown, the credits behind the pair, and the proposer', async () => {
    await floor();
    const paid = rowNum(3);
    const facts = paid.querySelector('.pubws-ballot-facts') as HTMLElement;
    expect(facts.textContent?.replace(/\s+/g, ' ').trim()).toBe('$200 ask 624 cr by telarchy-agents');
    expect(within(facts).getByTitle('paid to the proposer on approval')).toBeTruthy();
    expect(within(facts).getByTitle('credits behind the pair')).toBeTruthy();
  });

  test('"$0 ask" when zero: a free proposal still prints its ask', async () => {
    await floor();
    const free = rowNum(31);
    expect(free.querySelector('.pubws-ballot-facts')?.textContent).toContain('$0 ask');
  });

  test("in the floor head's glyph set: a pool glyph before the credits, and no caret", async () => {
    await floor();
    const paid = rowNum(3);
    const facts = paid.querySelector('.pubws-ballot-facts') as HTMLElement;
    expect(facts.querySelector('.pubws-glyph--pool')).toBeTruthy();
    expect(facts.querySelector('.pubws-glyph--dollar')).toBeTruthy();
    expect(board().querySelector('.pubws-ballot-caret')).toBeNull();
  });

  test('the proposer is named only when they are not the viewer', async () => {
    signIn(state(), 'owner');
    await floor();
    // The viewer is only known once the participant call lands.
    await waitFor(() => expect(rowNum(31).querySelector('.pubws-ballot-facts')?.textContent).not.toContain('by '));
    expect(rowNum(3).querySelector('.pubws-ballot-facts')?.textContent).toContain('by telarchy-agents');
  });

  test('there is no "yours" tag on a row', async () => {
    signIn(state(), 'owner');
    await floor();
    // Wait for the viewer to be known: that is when a "yours" tag would be
    // drawn if the row still had one.
    await waitFor(() => expect(board().querySelector('.pubws-ballot-mine')).toBeTruthy());
    expect(board().querySelector('.pubws-ballot-yours')).toBeNull();
    expect(rows().some(r => /yours/.test(r.textContent ?? ''))).toBe(false);
  });
});

describe('the impact sits right-aligned in ink', () => {
  test('approved minus declined of the pair on screen, in ink mono, never green', async () => {
    await floor();
    const free = rowNum(31);
    const delta = free.querySelector('.pubws-ballot-delta') as HTMLElement;
    expect(delta.textContent).toBe('+3.7');
    expect(delta.className).not.toMatch(/is-up|is-down/);
  });

  test('"±0" in the tertiary register when the two calls are equal', async () => {
    state().overrides = { proposals: [proposal({ id: 'p-flat', number: 5 }, 12, 12)] };
    await floor();
    const delta = document.querySelector('.pubws-ballot-delta') as HTMLElement;
    expect(delta.textContent).toBe('±0');
    expect(delta.className).toContain('pubws-ballot-delta--open');
  });

  test('"no price yet" with an "Inject" link when the pair has no liquidity', async () => {
    signIn(state(), 'trader');
    state().overrides = { proposals: [proposal({ id: 'p-dry', number: 5 }, 12, 12, 0, 0)] };
    await floor();
    const impact = document.querySelector('.pubws-ballot-impact') as HTMLElement;
    expect(impact.textContent).toContain('no price yet');
    expect(within(impact).getByRole('button', { name: 'Inject' })).toBeTruthy();
  });

  test('the Inject link is for anyone signed in, and signed out there is none', async () => {
    state().overrides = { proposals: [proposal({ id: 'p-dry', number: 5 }, 12, 12, 0, 0)] };
    await floor();
    const impact = document.querySelector('.pubws-ballot-impact') as HTMLElement;
    expect(impact.textContent).toContain('no price yet');
    expect(within(impact).queryByRole('button', { name: 'Inject' })).toBeNull();
  });
});

describe('rows are sorted by absolute impact, largest first, ties by pool', () => {
  test('the largest absolute impact leads, whatever the pools say', async () => {
    state().overrides = {
      proposals: [
        proposal({ id: 'p-deep', number: 1, title: 'Deep but flat' }, 12.1, 12, 90_000),
        proposal({ id: 'p-big', number: 2, title: 'Shallow but large' }, 20, 12, 10),
      ],
    };
    await floor();
    expect(rowTitles()).toEqual(['#2Shallow but large', '#1Deep but flat']);
  });

  test('a negative impact ranks by its size, not its sign', async () => {
    state().overrides = {
      proposals: [
        proposal({ id: 'p-small', number: 1, title: 'Small gain' }, 13, 12),
        proposal({ id: 'p-harm', number: 2, title: 'Large harm' }, 4, 12),
      ],
    };
    await floor();
    expect(rowTitles()).toEqual(['#2Large harm', '#1Small gain']);
  });

  test('ties by pool: the same impact, the deeper pair first', async () => {
    state().overrides = {
      proposals: [
        proposal({ id: 'p-thin', number: 1, title: 'Thin' }, 13, 12, 10),
        proposal({ id: 'p-thick', number: 2, title: 'Thick' }, 13, 12, 900),
      ],
    };
    await floor();
    expect(rowTitles()).toEqual(['#2Thick', '#1Thin']);
  });

  test('a pair with no liquidity sorts last', async () => {
    state().overrides = {
      proposals: [
        proposal({ id: 'p-dry', number: 1, title: 'Unpriced' }, 40, 12, 0, 0),
        proposal({ id: 'p-priced', number: 2, title: 'Priced' }, 13, 12),
      ],
    };
    await floor();
    expect(rowTitles()).toEqual(['#2Priced', '#1Unpriced']);
  });
});

describe("the owner's rail is an inbox", () => {
  test('one ruled line in ink counts what it is: "1 payment request"', async () => {
    signIn(state(), 'owner');
    await floor();
    const count = board().querySelector('.pubws-ballot-count') as HTMLElement;
    expect(count.textContent).toBe('1 payment request ↓');
    expect(count.className).toContain('pubws-ballot-count--inbox');
  });

  test('a pending proposal with a zero ask, or one the owner posted, is not counted', async () => {
    signIn(state(), 'owner');
    state().overrides = {
      proposals: [
        // free, by somebody else: pending, but nothing to pay
        proposal({ id: 'p-free', number: 1, askUsd: 0 }, 20, 12),
        // paid, but the owner's own
        proposal(
          { id: 'p-mine', number: 2, askUsd: 500, proposedByHandle: OWNER_ID, proposedByName: 'Viktor36' },
          19,
          12,
        ),
        // paid, by somebody else, and already decided
        proposal(
          { id: 'p-done', number: 3, askUsd: 500, status: 'approved', resolvedAt: '2026-09-01T09:00:00.000Z' },
          18,
          12,
        ),
      ],
    };
    await floor();
    await waitFor(() => expect(board().querySelector('.pubws-ballot-count')?.textContent).toBe('No payment requests'));
    expect(board().querySelector('.pubws-ballot-decide')).toBeNull();
    expect(board().querySelector('.pubws-ballot-rule')).toBeNull();
  });

  test('the counted rows come FIRST, each with an ink "decide" tag beside its ask, then a thin rule', async () => {
    signIn(state(), 'owner');
    state().overrides = {
      proposals: [
        // the largest impact, but free: it is not a payment request
        proposal({ id: 'p-free', number: 1, title: 'Free and large', askUsd: 0 }, 40, 12),
        proposal({ id: 'p-ask', number: 2, title: 'Asks for money', askUsd: 200 }, 13, 12),
      ],
    };
    await floor();
    expect(rowTitles()).toEqual(['#2Asks for money', '#1Free and large']);
    const first = rows()[0];
    const tag = first.querySelector('.pubws-ballot-decide') as HTMLElement;
    expect(tag.textContent).toBe('decide');
    const facts = first.querySelector('.pubws-ballot-facts') as HTMLElement;
    expect(facts.contains(tag)).toBe(true);
    const rule = board().querySelector('.pubws-ballot-rule') as HTMLElement;
    expect(first.compareDocumentPosition(rule) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rule.compareDocumentPosition(rows()[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test('everyone who is not the owner reads no group, no rule, and no decide tag', async () => {
    signIn(state(), 'trader');
    await floor();
    expect(board().querySelector('.pubws-ballot-decide')).toBeNull();
    expect(board().querySelector('.pubws-ballot-rule')).toBeNull();
  });

  test('the owner row reads the same count and selects the first row of the group', async () => {
    signIn(state(), 'owner');
    state().overrides = {
      proposals: [
        proposal({ id: 'p-small', number: 1, title: 'Small ask', askUsd: 50 }, 13, 12),
        proposal({ id: 'p-large', number: 2, title: 'Large ask', askUsd: 400 }, 30, 12),
      ],
    };
    await floor();
    await waitFor(() => expect(board().querySelector('.pubws-ballot-count')?.textContent).toBe('2 payment requests ↓'));
    fireEvent.click(screen.getByRole('button', { name: '2 proposals need your decision' }));
    // The first row of the group, which is the one the board draws first.
    await waitFor(() => expect(document.querySelector('.pubws-proposal-title')?.textContent).toBe('Large ask'));
  });

  test('the foot tells the owner how many of the open ones are theirs', async () => {
    signIn(state(), 'owner');
    await floor();
    await waitFor(() => expect(board().querySelector('.pubws-ballot-mine')?.textContent).toBe('1 of 2 are yours'));
  });
});

describe('everyone else reads the open count and the largest impact', () => {
  test('"2 open · largest impact +3.7", and no inbox line', async () => {
    await floor();
    const count = board().querySelector('.pubws-ballot-count') as HTMLElement;
    expect(count.textContent).toBe('2 open · largest impact +3.7');
    expect(count.className).not.toContain('pubws-ballot-count--inbox');
    expect(board().querySelector('.pubws-ballot-mine')).toBeNull();
  });
});

describe('the foot', () => {
  test('the decided fold, "+ Propose", and one line naming what approval pays', async () => {
    await floor();
    const foot = board().querySelector('.pubws-ballot-foot') as HTMLElement;
    const fold = foot.querySelector('.pubws-ballot-fold') as HTMLElement;
    expect(fold.textContent).toContain('1 decided');
    const propose = within(foot).getByRole('button', { name: '+ Propose' });
    expect(fold.compareDocumentPosition(propose) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(foot.querySelector('.pubws-propose-cost')?.textContent).toBe(
      'Free to post. If approved you are paid the ask in real money, plus 500 cr.',
    );
  });

  test("the propose dialog's confirm carries the same phrase, so the two surfaces never disagree", async () => {
    signIn(state(), 'trader');
    await floor();
    fireEvent.click(within(board()).getByRole('button', { name: '+ Propose' }));
    const dialog = await screen.findByLabelText('Offer to do the work');
    expect(dialog.querySelector('.ticket-go-sub')?.textContent).toBe(
      'Free to post. If approved you are paid the ask in real money, plus 500 cr.',
    );
  });

  test('a workspace with no proposal reward promises no credits', async () => {
    state().overrides = { proposalReward: 0 };
    await floor();
    expect(board().querySelector('.pubws-propose-cost')?.textContent).toBe(
      'Free to post. If approved you are paid the ask in real money.',
    );
  });
});
