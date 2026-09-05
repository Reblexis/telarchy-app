import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { LeaderboardEntry, PrizeSeason, PublicContractor } from '../../lib/api';

/**
 * The standings under the verbs (docs/ui-conventions.md, "The rails, and
 * the standings under the verbs", revised 2026-09-05): two three-row
 * footers, "Top traders" and "Top contractors", one "Show full leaderboard"
 * link under the pair, and the count strip above them carrying the market's
 * traders and volume and the season line with its control. With a proposal
 * selected the traders footer becomes "Traders on this proposal".
 *
 * Where the reader stands (owner ask 2026-08-19) survives the move: their
 * own row is marked, and when they are outside the three it is pinned
 * underneath with its real rank.
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

const { FloorStandings, CountStrip } = await import('../FloorRails');

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

function contractor(n: number): PublicContractor {
  return { id: `c${n}`, name: `contractor${n}`, impact: 100 - n, jobs: 2, pendingJobs: 1, pricedJobs: 2, earnedUsd: 0 };
}

const five = Array.from({ length: 5 }, (_, i) => trader(i + 1));
const fiveContractors = Array.from({ length: 5 }, (_, i) => contractor(i + 1));

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

const standings = (props: Partial<Parameters<typeof FloorStandings>[0]> = {}) =>
  render(
    <MemoryRouter>
      <FloorStandings entries={five} contractors={fiveContractors} {...props} />
    </MemoryRouter>,
  );

const blockOf = (container: HTMLElement, label: string) =>
  [...container.querySelectorAll('.pubws-lb-block')].find(b =>
    b.querySelector('.pubws-lb-head .pubws-h2')?.textContent?.startsWith(label),
  ) as HTMLElement;

describe('the standings are footers, not rails', () => {
  test('two blocks, three rows each, with the shared head anatomy', () => {
    const { container } = standings();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pubws-standings');
    expect(root.tagName).not.toBe('ASIDE');
    expect(container.querySelector('.pubws-rail')).toBeNull();
    expect(container.querySelector('.pubws-rail--left')).toBeNull();

    const traders = blockOf(container, 'Top traders');
    const contractors = blockOf(container, 'Top contractors');
    expect(traders).toBeTruthy();
    expect(contractors).toBeTruthy();
    // Three, not five and not ten (the rail showed more; a footer is compact).
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(3);
    expect(contractors.querySelectorAll('.pubws-lb-row')).toHaveLength(3);
    expect(traders.textContent).toContain('trader1');
    expect(traders.textContent).toContain('trader3');
    expect(traders.textContent).not.toContain('trader4');
    // The head: label left, mono meta right, saying what the numbers are.
    expect(traders.querySelector('.pubws-lb-head .pubws-lb-meta')?.textContent).toBe('this market');
    expect(contractors.querySelector('.pubws-lb-head .pubws-lb-meta')?.textContent).toBe('impact');
  });

  test('one "Show full leaderboard" link under the pair, to /leaderboard, never a board in place', () => {
    getLeaderboard.mockResolvedValue({ participants: [{ ...trader(9), id: 'g1', nickname: 'globalpro' }] });
    const { container, getAllByText, queryByText } = standings();
    const links = getAllByText('Show full leaderboard');
    expect(links).toHaveLength(1);
    expect(links[0].tagName).toBe('A');
    expect(links[0]).toHaveAttribute('href', '/leaderboard');
    // Under BOTH blocks, not inside either.
    expect(links[0].closest('.pubws-lb-block')).toBeNull();
    const blocks = container.querySelectorAll('.pubws-lb-block');
    expect(blocks[1].compareDocumentPosition(links[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  test('a floor with contractors but no traders yet shows the contractors alone', () => {
    const { container } = standings({ entries: [] });
    expect(blockOf(container, 'Top traders')).toBeUndefined();
    expect(blockOf(container, 'Top contractors')).toBeTruthy();
  });
});

describe('finding yourself in the footer', () => {
  test('the reader inside the three is marked, and not shown twice', () => {
    const { container } = standings({ meId: 'p2' });
    const traders = blockOf(container, 'Top traders');
    const marked = traders.querySelectorAll('.pubws-lb-row.is-me');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('trader2');
    expect(traders.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(3);
  });

  test('the reader outside the three is pinned underneath, with their real rank', () => {
    const { container } = standings({ meId: 'p5' });
    const traders = blockOf(container, 'Top traders');
    const pinned = traders.querySelector('.pubws-lb-row.is-pinned');
    expect(pinned).toBeTruthy();
    expect(pinned!.textContent).toContain('trader5');
    expect(pinned!.querySelector('.pubws-lb-rank')!.textContent).toBe('5');
    expect(pinned!.classList.contains('is-me')).toBe(true);
    expect(traders.querySelectorAll('.pubws-lb-row')).toHaveLength(4);
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

describe('with a proposal selected, the traders footer is the holders of its pair', () => {
  const holder = (n: number, profit: number, sub = 'bet higher if approved') =>
    ({
      ...trader(n),
      rank: null,
      totalEarnings: profit,
      totalTrades: 1,
      positionLine: sub,
    }) as unknown as LeaderboardEntry;

  test('the heading and meta change, rows are the holders ranked by marked profit, contractors unchanged', () => {
    const { container } = standings({
      proposalTraders: [holder(4, 12), holder(1, 310), holder(9, -80, 'bet lower if approved'), holder(2, 5)],
    });
    expect(blockOf(container, 'Top traders')).toBeUndefined();
    const block = blockOf(container, 'Traders on this proposal');
    expect(block).toBeTruthy();
    expect(block.querySelector('.pubws-lb-head .pubws-lb-meta')?.textContent).toBe('this proposal');
    const rows = [...block.querySelectorAll('.pubws-lb-row')];
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.querySelector('.pubws-lb-name')?.textContent)).toEqual(['trader1', 'trader4', 'trader2']);
    expect(rows.map(r => r.querySelector('.pubws-lb-rank')?.textContent)).toEqual(['1', '2', '3']);
    expect(rows[0].querySelector('.pubws-lb-score')?.textContent).toBe('+310 cr');
    expect(rows[0].querySelector('.pubws-lb-score')?.className).toContain('is-up');
    expect(rows[0].querySelector('.pubws-lb-sub')?.textContent).toBe('bet higher if approved');
    // Nobody from the workspace board sneaks in.
    expect(block.textContent).not.toContain('trader3');
    const contractors = blockOf(container, 'Top contractors');
    expect(contractors.querySelectorAll('.pubws-lb-row')).toHaveLength(3);
    expect(contractors.querySelector('.pubws-lb-meta')?.textContent).toBe('impact');
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

describe('the count strip', () => {
  const strip = (props: Partial<Parameters<typeof CountStrip>[0]> = {}) =>
    render(
      <MemoryRouter>
        <CountStrip traders={8} volume={2778} season={null} signedIn={false} {...props} />
      </MemoryRouter>,
    );

  test('traders and volume on this market, no season line when there is no season', () => {
    const { container, queryByText } = strip();
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('pubws-count');
    expect(root.textContent).toMatch(/8 traders and 2,778 cr traded on this market/);
    expect(root.textContent).not.toMatch(/season/i);
    expect(queryByText(/Enter the season/)).toBeNull();
    expect(queryByText(/See the season/)).toBeNull();
  });

  test('one trader reads singular', () => {
    const { container } = strip({ traders: 1, volume: 0 });
    expect(container.textContent).toMatch(/1 trader and 0 cr traded/);
  });

  test('the season line and "Enter the season" for a visitor', () => {
    const { container, getByText } = strip({ season: runningSeason });
    expect(container.textContent).toMatch(/Season 0/);
    expect(container.textContent).toMatch(/\$1,000 in prizes/);
    expect(container.textContent).toMatch(/left/);
    expect(container.textContent).toMatch(/free to enter/);
    const go = getByText('Enter the season');
    expect(go.tagName).toBe('A');
    expect(go).toHaveAttribute('href', '/season');
  });

  test('an entrant reads "you are in" and "See the season"', async () => {
    getMySeason.mockResolvedValue({ season: null, optedIn: true, canEnter: false });
    const { findByText, container } = strip({ season: runningSeason, signedIn: true });
    const go = await findByText('See the season');
    expect(go).toHaveAttribute('href', '/season');
    expect(container.textContent).toMatch(/you are in/i);
    expect(container.textContent).not.toMatch(/free to enter/);
  });

  test('a signed-in visitor who has not entered is still asked to enter', async () => {
    getMySeason.mockResolvedValue({ season: null, optedIn: false, canEnter: true });
    const { findByText } = strip({ season: runningSeason, signedIn: true });
    expect(await findByText('Enter the season')).toHaveAttribute('href', '/season');
    expect(getMySeason).toHaveBeenCalled();
  });

  test('a settled season offers "See the season", not entry', () => {
    const { getByText } = strip({ season: { ...runningSeason, status: 'settled' } as PrizeSeason });
    expect(getByText('See the season')).toHaveAttribute('href', '/season');
  });
});
