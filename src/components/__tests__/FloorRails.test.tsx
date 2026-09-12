import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { LeaderboardEntry, PrizeSeason } from '../../lib/api';

/**
 * The standings under the verbs (docs/ui-conventions.md, "The standings
 * are one footer, not rails, and not two boards"): ONE block, "Top
 * traders", ten rows over two columns (1 to 5 left, 6 to 10 right on a
 * desktop, one stacked column on a phone), one "Show full leaderboard"
 * link under it, and no contractors block at all. The season advert (three
 * lines: the prize, the terms, the control) lives in the left column. With
 * a proposal selected the footer becomes "Traders on this proposal".
 *
 * Where the reader stands survives the change: their own row is marked,
 * and when they are outside the ten it is pinned underneath with its real
 * rank.
 */

const getSeasons = vi.fn(async () => ({ seasons: [] as unknown[] }));
const getSeasonStandings = vi.fn(async () => ({ participants: [] as unknown[] }));
const getLeaderboard = vi.fn(async () => ({ participants: [] as unknown[] }));
const getMySeason = vi.fn(async () => ({ season: null, optedIn: false, canEnter: false }));

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      getSeasons: () => getSeasons(),
      getSeasonStandings: () => getSeasonStandings(),
      getLeaderboard: () => getLeaderboard(),
      getMySeason: () => getMySeason(),
    },
  };
});

const { FloorStandings, SeasonAdvert } = await import('../FloorRails');

function trader(n: number): LeaderboardEntry {
  return {
    id: `p${n}`,
    nickname: `trader${n}`,
    rank: n,
    totalEarnings: 1000 - n,
    totalTrades: 10,
    resolvedMarkets: 0,
    accuracy: null,
    calibration: null,
    lastTradeAt: null,
  } as unknown as LeaderboardEntry;
}

const draftSeason: PrizeSeason = {
  id: 's0',
  name: 'Season 0',
  status: 'draft',
  startsAt: '2026-08-22T00:00:00.000Z',
  endsAt: '2026-10-16T00:00:00.000Z',
  settledAt: null,
  poolUsd: 1000,
  payoutMode: 'ladder',
  minPayoutUsd: 0,
  strictEligibility: false,
  ladder: [
    { place: 1, prizeUsd: 500 },
    { place: 2, prizeUsd: 250 },
  ],
  rulesUrl: '/legal/season-0',
} as unknown as PrizeSeason;
const runningSeason = { ...draftSeason, status: 'running' } as PrizeSeason;

beforeEach(() => {
  vi.clearAllMocks();
  getMySeason.mockResolvedValue({ season: null, optedIn: false, canEnter: false });
  vi.useFakeTimers({ shouldAdvanceTime: true, now: new Date('2026-09-05T10:00:00Z') });
});

const twelve = Array.from({ length: 12 }, (_, i) => trader(i + 1));

const standings = (props: Partial<Parameters<typeof FloorStandings>[0]> = {}) =>
  render(
    <MemoryRouter>
      <FloorStandings entries={twelve} {...props} />
    </MemoryRouter>,
  );

const blockOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.pubws-lb-block')].find(b =>
    b.querySelector('.pubws-lb-head .pubws-h2')?.textContent?.startsWith(label),
  ) as HTMLElement;

/** The two row columns, left then right, in document order. */
const colsOf = (container: HTMLElement) => [...container.querySelectorAll('.pubws-lb-cols > .pubws-lb')];
const namesIn = (el: Element) => [...el.querySelectorAll('.pubws-lb-name')].map(n => n.textContent);
const ranksIn = (el: Element) => [...el.querySelectorAll('.pubws-lb-rank')].map(n => n.textContent);

describe('the standings are one footer of ten, across two columns', () => {
  test('one block, ten rows, the shared head anatomy, one link under it', () => {
    const { container } = standings();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pubws-standings');
    expect(root.tagName).not.toBe('ASIDE');
    expect(container.querySelector('.pubws-rail')).toBeNull();
    expect(container.querySelector('.pubws-rail--left')).toBeNull();

    const blocks = container.querySelectorAll('.pubws-lb-block');
    expect(blocks).toHaveLength(1);
    const traders = blockOf(container, 'Top traders');
    expect(traders).toBeTruthy();
    // Ten, not three: the owner asked for the top ten over the two columns.
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(10);
    expect(namesIn(traders)).toEqual(Array.from({ length: 10 }, (_, i) => `trader${i + 1}`));
    expect(traders.textContent).not.toContain('trader11');
    // The head: label left, mono meta right, saying what the numbers are.
    expect(traders.querySelector('.pubws-lb-head .pubws-lb-meta')?.textContent).toBe('this market');
  });

  test('ranks 1 to 5 stand in the left column and 6 to 10 in the right', () => {
    const { container } = standings();
    const cols = colsOf(container);
    expect(cols).toHaveLength(2);
    expect(namesIn(cols[0])).toEqual(['trader1', 'trader2', 'trader3', 'trader4', 'trader5']);
    expect(namesIn(cols[1])).toEqual(['trader6', 'trader7', 'trader8', 'trader9', 'trader10']);
    expect(ranksIn(cols[0])).toEqual(['1', '2', '3', '4', '5']);
    expect(ranksIn(cols[1])).toEqual(['6', '7', '8', '9', '10']);
    // The right column starts its numbering where the left one stopped, so
    // assistive technology reading the list hears 6 and not 1 again.
    expect(cols[1].getAttribute('start')).toBe('6');
  });

  test('STACKED ON A PHONE THE ROWS READ 1 TO 10 IN ORDER: the document order is the phone order', () => {
    const { container } = standings();
    const block = blockOf(container, 'Top traders');
    // One column under the other in the DOM, so the single-column phone
    // layout is 1..10 without the CSS having to reorder anything.
    expect(ranksIn(block)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
    expect(namesIn(block)).toEqual(Array.from({ length: 10 }, (_, i) => `trader${i + 1}`));
  });

  test('five traders or fewer draw one column, never an empty second track', () => {
    const { container } = standings({ entries: twelve.slice(0, 4) });
    expect(container.querySelector('.pubws-lb-cols')).toBeNull();
    const lists = container.querySelectorAll('.pubws-lb');
    expect(lists).toHaveLength(1);
    expect(lists[0].querySelectorAll('.pubws-lb-row')).toHaveLength(4);
  });

  test('THE FLOOR CARRIES NO CONTRACTORS BLOCK: one board, the traders', () => {
    // Handed contractors anyway (an old caller, a stale payload), the footer
    // draws none: the block is gone from the floor, not merely unwired.
    const { container } = render(
      <MemoryRouter>
        <FloorStandings
          entries={twelve}
          {...({
            contractors: [
              { id: 'c1', name: 'contractor1', impact: 90, jobs: 2, pendingJobs: 1, pricedJobs: 2, earnedUsd: 0 },
            ],
          } as unknown as Partial<Parameters<typeof FloorStandings>[0]>)}
        />
      </MemoryRouter>,
    );
    expect(container.querySelectorAll('.pubws-lb-block')).toHaveLength(1);
    expect(blockOf(container, 'Top contractors')).toBeUndefined();
    expect(container.textContent).not.toMatch(/contractor/i);
    expect(container.textContent).not.toMatch(/impact/i);
  });

  test('one "Show full leaderboard" link under the board, to /leaderboard, never a board in place', () => {
    getLeaderboard.mockResolvedValue({ participants: [{ ...trader(9), id: 'g1', nickname: 'globalpro' }] });
    const { container, getAllByText, queryByText } = standings();
    const links = getAllByText('Show full leaderboard');
    expect(links).toHaveLength(1);
    expect(links[0].tagName).toBe('A');
    expect(links[0]).toHaveAttribute('href', '/leaderboard');
    // Under the block, not inside it.
    expect(links[0].closest('.pubws-lb-block')).toBeNull();
    const block = container.querySelector('.pubws-lb-block') as HTMLElement;
    expect(block.compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(links[0]);
    expect(queryByText('Global standings')).toBeNull();
    expect(getLeaderboard).not.toHaveBeenCalled();
  });

  test('the season control does not live in the standings any more', () => {
    const { container, queryByText } = standings({ season: runningSeason });
    expect(queryByText(/Enter the season/)).toBeNull();
    expect(queryByText(/See the season/)).toBeNull();
    expect(container.querySelector('.pubws-lb-section')).toBeNull();
  });

  test('a floor nobody has traded on, with no proposal selected, draws nothing', () => {
    const { container } = standings({ entries: [] });
    expect(container.firstElementChild).toBeNull();
  });
});

describe('finding yourself in the footer', () => {
  test('the reader inside the ten is marked, and not shown twice', () => {
    const { container } = standings({ meId: 'p7' });
    const traders = blockOf(container, 'Top traders');
    const marked = traders.querySelectorAll('.pubws-lb-row.is-me');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('trader7');
    expect(traders.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(10);
  });

  test('the reader outside the ten is pinned underneath, with their real rank', () => {
    const { container } = standings({ meId: 'p12' });
    const traders = blockOf(container, 'Top traders');
    const pinned = traders.querySelector('.pubws-lb-row.is-pinned');
    expect(pinned).toBeTruthy();
    expect(pinned!.textContent).toContain('trader12');
    expect(pinned!.querySelector('.pubws-lb-rank')!.textContent).toBe('12');
    expect(pinned!.classList.contains('is-me')).toBe(true);
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(11);
    // Last of all, so it reads as an addendum to the ten rather than as an
    // eleventh place: the foot of the second column, the foot of the stack.
    const cols = colsOf(container);
    expect(cols[1].lastElementChild).toBe(pinned);
  });

  test('a signed-out reader gets no highlight and no pin', () => {
    const { container } = standings();
    expect(container.querySelectorAll('.pubws-lb-row.is-me')).toHaveLength(0);
    expect(container.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
  });

  test('a reader who has not traded is not invented onto the board', () => {
    const { container } = standings({ meId: 'nobody' });
    expect(container.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
  });

  test('the pin joins the single column when there is only one', () => {
    const { container } = standings({ entries: twelve.slice(0, 3), meId: 'p3' });
    expect(container.querySelector('.pubws-lb-cols')).toBeNull();
    expect(container.querySelectorAll('.pubws-lb-row')).toHaveLength(3);
  });
});

describe('the season prize beside an entrant', () => {
  const entrant = (prize: number | null) =>
    ({ ...trader(2), seasonEntered: true, seasonPrizeUsd: prize }) as unknown as LeaderboardEntry;

  test('a draft season shows a neutral "entered" marker, never a per-row dollar', () => {
    const { getByText, queryByText } = standings({ entries: [trader(1), entrant(null)], season: draftSeason });
    expect(getByText('entered').className).toContain('pubws-lb-prize');
    expect(queryByText('$500')).toBeNull();
  });

  test('a running season shows the projected payout', () => {
    const { getByText } = standings({ entries: [entrant(250)], season: runningSeason });
    expect(getByText('$250').className).toBe('pubws-lb-prize');
  });

  test('a non-entrant carries no chip', () => {
    const { container } = standings({ entries: [trader(1)], season: draftSeason });
    expect(container.querySelector('.pubws-lb-prize')).toBeNull();
  });
});

describe('with a proposal selected, the footer is the holders of its pair', () => {
  const holder = (n: number, profit: number, sub = 'bet higher if approved') =>
    ({
      ...trader(n),
      rank: null,
      totalEarnings: profit,
      totalTrades: 1,
      positionLine: sub,
    }) as unknown as LeaderboardEntry;

  test('the heading and meta change, and the holders rank by marked profit', () => {
    const { container } = standings({
      proposalTraders: [holder(4, 12), holder(1, 310), holder(9, -80, 'bet lower if approved'), holder(2, 5)],
    });
    expect(blockOf(container, 'Top traders')).toBeUndefined();
    const block = blockOf(container, 'Traders on this proposal');
    expect(block).toBeTruthy();
    expect(block.querySelector('.pubws-lb-head .pubws-lb-meta')?.textContent).toBe('this proposal');
    const rows = [...block.querySelectorAll('.pubws-lb-row')];
    expect(rows).toHaveLength(4);
    expect(namesIn(block)).toEqual(['trader1', 'trader4', 'trader2', 'trader9']);
    expect(ranksIn(block)).toEqual(['1', '2', '3', '4']);
    expect(rows[0].querySelector('.pubws-lb-score')?.textContent).toBe('+310 cr');
    expect(rows[0].querySelector('.pubws-lb-score')?.className).toContain('is-up');
    expect(rows[0].querySelector('.pubws-lb-sub')?.textContent).toBe('bet higher if approved');
    // Nobody from the workspace board sneaks in.
    expect(block.textContent).not.toContain('trader3');
    // And no contractors, here either.
    expect(container.querySelectorAll('.pubws-lb-block')).toHaveLength(1);
  });

  test('a proposal with more than ten holders shows the top ten over the two columns', () => {
    const { container } = standings({
      proposalTraders: Array.from({ length: 14 }, (_, i) => holder(i + 1, 1000 - i)),
    });
    const block = blockOf(container, 'Traders on this proposal');
    expect(block.querySelectorAll('.pubws-lb-row')).toHaveLength(10);
    const cols = colsOf(container);
    expect(cols).toHaveLength(2);
    expect(namesIn(cols[0])).toEqual(['trader1', 'trader2', 'trader3', 'trader4', 'trader5']);
    expect(namesIn(cols[1])).toEqual(['trader6', 'trader7', 'trader8', 'trader9', 'trader10']);
    expect(block.textContent).not.toContain('trader11');
  });

  test('nobody holding a position says "nobody yet" in one row rather than hiding', () => {
    const { container } = standings({ proposalTraders: [] });
    const block = blockOf(container, 'Traders on this proposal');
    expect(block).toBeTruthy();
    const rows = block.querySelectorAll('.pubws-lb-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toBe('nobody yet');
    expect(container.querySelector('.pubws-lb-more')).toHaveAttribute('href', '/leaderboard');
  });

  test('a loss prints signed and red, and the reader is marked but never pinned onto a proposal', () => {
    const { container } = standings({ proposalTraders: [holder(9, -80), holder(1, 5)], meId: 'p9' });
    const block = blockOf(container, 'Traders on this proposal');
    const rows = [...block.querySelectorAll('.pubws-lb-row')];
    expect(rows[1].querySelector('.pubws-lb-score')?.textContent).toBe('-80 cr');
    expect(rows[1].querySelector('.pubws-lb-score')?.className).toContain('is-down');
    expect(rows[1].classList.contains('is-me')).toBe(true);
    expect(block.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
  });
});

describe('the season advert', () => {
  const advert = (props: Partial<Parameters<typeof SeasonAdvert>[0]> = {}) =>
    render(
      <MemoryRouter>
        <SeasonAdvert season={runningSeason} signedIn={false} {...props} />
      </MemoryRouter>,
    );

  test('three lines: the prize as the hero, the terms, the control, and nothing else', () => {
    const { container, getByText } = advert();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pubws-season');
    expect(root.children).toHaveLength(3);
    const hero = root.querySelector('.pubws-season-hero') as HTMLElement;
    const terms = root.querySelector('.pubws-season-terms') as HTMLElement;
    expect(hero.textContent).toBe('$1,000 in prizes');
    // 2026-09-05 10:00Z to 2026-10-16 00:00Z: 40 days.
    expect(terms.textContent).toBe('Season 0 ends in 40 days. Free to enter.');
    const go = getByText('Enter the season');
    expect(go.tagName).toBe('A');
    expect(go).toHaveAttribute('href', '/season');
    expect(hero.compareDocumentPosition(terms) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(terms.compareDocumentPosition(go) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Advertised, not narrated: no counts, no "and", no running sentence.
    expect(root.textContent).not.toMatch(/trader/i);
    expect(root.textContent).not.toMatch(/traded/i);
    expect(root.textContent).not.toMatch(/ and /);
    expect(root.textContent).not.toMatch(/left/);
  });

  test('the prize is the real pool, formatted with its thousands separator', () => {
    const { container } = advert({ season: { ...runningSeason, poolUsd: 12500 } as PrizeSeason });
    expect(container.querySelector('.pubws-season-hero')?.textContent).toBe('$12,500 in prizes');
  });

  test('no season, nothing rendered', () => {
    const { container } = advert({ season: null });
    expect(container.firstElementChild).toBeNull();
  });

  test('an entrant reads "You are in." and "See the season"', async () => {
    getMySeason.mockResolvedValue({ season: null, optedIn: true, canEnter: false });
    const { findByText, container } = advert({ signedIn: true });
    const go = await findByText('See the season');
    expect(go).toHaveAttribute('href', '/season');
    expect(container.querySelector('.pubws-season-terms')?.textContent).toBe('Season 0 ends in 40 days. You are in.');
    expect(container.textContent).not.toMatch(/Free to enter/);
  });

  test('a signed-in visitor who has not entered is still asked to enter', async () => {
    getMySeason.mockResolvedValue({ season: null, optedIn: false, canEnter: true });
    const { findByText } = advert({ signedIn: true });
    expect(await findByText('Enter the season')).toHaveAttribute('href', '/season');
    expect(getMySeason).toHaveBeenCalled();
  });

  test('a signed-out visitor is never asked the server whether they entered', () => {
    advert();
    expect(getMySeason).not.toHaveBeenCalled();
  });

  test('a draft season counts down to its start and is free to enter', () => {
    const { container, getByText } = advert({ season: { ...draftSeason, startsAt: '2026-09-12T00:00:00.000Z' } });
    // 2026-09-05 10:00Z to 2026-09-12 00:00Z: 6 days and change.
    expect(container.querySelector('.pubws-season-terms')?.textContent).toBe(
      'Season 0 starts in 6 days. Free to enter.',
    );
    expect(getByText('Enter the season')).toHaveAttribute('href', '/season');
  });

  test('under a day, the terms say the hours rather than "0 days"', () => {
    const { container } = advert({ season: { ...runningSeason, endsAt: '2026-09-05T16:30:00.000Z' } });
    expect(container.querySelector('.pubws-season-terms')?.textContent).toBe(
      'Season 0 ends in 6 hours 30 min. Free to enter.',
    );
  });

  test('a season past its end offers "See the season", not entry, and says so', () => {
    const { container, getByText, queryByText } = advert({
      season: { ...runningSeason, endsAt: '2026-09-01T00:00:00.000Z' } as PrizeSeason,
    });
    expect(getByText('See the season')).toHaveAttribute('href', '/season');
    expect(queryByText('Enter the season')).toBeNull();
    expect(container.querySelector('.pubws-season-terms')?.textContent).toBe(
      'Season 0 has ended. Standings are being settled.',
    );
  });

  test('a settled season offers "See the season", not entry', () => {
    const { container, getByText, queryByText } = advert({
      season: { ...runningSeason, status: 'settled' } as PrizeSeason,
    });
    expect(getByText('See the season')).toHaveAttribute('href', '/season');
    expect(queryByText('Enter the season')).toBeNull();
    expect(container.querySelector('.pubws-season-terms')?.textContent).toBe('Season 0 is over. Final standings.');
    expect(container.querySelector('.pubws-season-hero')?.textContent).toBe('$1,000 in prizes');
  });
});
