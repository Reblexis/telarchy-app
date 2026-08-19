import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { LeaderboardEntry } from '../../lib/api';

/**
 * Where the reader stands on the board (owner ask 2026-08-19).
 *
 * The rail shows the top ten. A board that shows the leaders and stops answers
 * "who is winning" but not "where am I", which is the question the person
 * reading it opened it with. So: their own row is marked, and when they are
 * outside the ten it is pinned underneath with its real rank.
 *
 * Tested here rather than by hand because the interesting case is the one that
 * cannot be produced by looking: the account doing the looking is usually near
 * the top of its own board.
 */

vi.mock('../../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../../lib/api')>('../../lib/api');
  return {
    ...actual,
    api: {
      // The season strip fetches on mount; it is not what this file is about.
      getSeasons: () => Promise.resolve({ seasons: [] }),
      getMySeason: () => Promise.resolve({ season: null, optedIn: false, canEnter: false }),
    },
  };
});

const { LeaderboardRail } = await import('../FloorRails');

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

const twelve = Array.from({ length: 12 }, (_, i) => trader(i + 1));

beforeEach(() => { vi.clearAllMocks(); });

describe('finding yourself on the rail', () => {
  test('the reader inside the ten is marked, and not shown twice', () => {
    const { container } = render(<LeaderboardRail entries={twelve} meId="p3" />);
    const marked = container.querySelectorAll('.pubws-lb-row.is-me');
    expect(marked).toHaveLength(1);
    expect(marked[0].textContent).toContain('trader3');
    // The pin is for people who are NOT in the list; duplicating a visible row
    // would read as two entries for one person.
    expect(container.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
    expect(container.querySelectorAll('.pubws-lb-row')).toHaveLength(10);
  });

  test('the reader outside the ten is pinned underneath, with their real rank', () => {
    const { container } = render(<LeaderboardRail entries={twelve} meId="p12" />);
    const pinned = container.querySelector('.pubws-lb-row.is-pinned');
    expect(pinned).toBeTruthy();
    expect(pinned!.textContent).toContain('trader12');
    // Their rank on the whole board, not the position of the pinned row: an
    // eleventh row showing "11" for the twelfth-placed reader is a lie.
    expect(pinned!.querySelector('.pubws-lb-rank')!.textContent).toBe('12');
    expect(pinned!.classList.contains('is-me')).toBe(true);
    expect(container.querySelectorAll('.pubws-lb-row')).toHaveLength(11);
  });

  test('a signed-out reader gets no highlight and no pin', () => {
    const { container } = render(<LeaderboardRail entries={twelve} />);
    expect(container.querySelectorAll('.pubws-lb-row.is-me')).toHaveLength(0);
    expect(container.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
    expect(container.querySelectorAll('.pubws-lb-row')).toHaveLength(10);
  });

  test('a reader who has not traded is not invented onto the board', () => {
    // The list filters to people with trades; someone with none has no row to
    // pin, and a pinned row for them would claim a rank they do not have.
    const { container } = render(<LeaderboardRail entries={twelve} meId="nobody" />);
    expect(container.querySelectorAll('.pubws-lb-row.is-pinned')).toHaveLength(0);
  });
});
