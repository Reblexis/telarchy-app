import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test } from 'vitest';

/**
 * The standings show the mark beside the score.
 *
 * The season ranks and pays settled profit, which leaves an entrant holding a
 * good open position reading a row of zeroes (participant report 2026-08-31,
 * after the scoring amendment: "I was hyped about being in the lead... could
 * we add profit at resolving at current price"). Two columns answer that
 * without touching what decides the money, so the test that matters is that
 * they are visibly the projection and visibly not the key.
 */

import type { PrizeSeason, SeasonStanding } from '../../lib/api';
import { SeasonTable } from '../LeaderTables';

const season = {
  id: 's0',
  name: 'Season 0',
  status: 'running',
  startsAt: '2026-08-22T00:00:00.000Z',
  endsAt: '2026-10-01T00:00:00.000Z',
  settledAt: null,
  poolUsd: 1000,
  payoutMode: 'proportional',
  minPayoutUsd: 1,
  strictEligibility: false,
  ladder: [],
  rulesUrl: '/legal/season-0-rules',
} as unknown as PrizeSeason;

const rows: SeasonStanding[] = [
  {
    rank: 1,
    id: 'vi0',
    nickname: 'vi0',
    score: 706.77,
    projectedPrizeUsd: 734.49,
    markedScore: 806.77,
    markedProjectedPrizeUsd: 700,
  },
  {
    rank: 2,
    id: 'quroe',
    nickname: 'Quroe',
    score: 0,
    projectedPrizeUsd: 0,
    markedScore: 312.5,
    markedProjectedPrizeUsd: 271.3,
  },
];

function rowOf(name: string) {
  return screen.getByText(name).closest('tr') as HTMLElement;
}

describe('the season standings table', () => {
  test('shows what an entrant would have if prices hold, beside the settled score', () => {
    render(
      <MemoryRouter>
        <SeasonTable rows={rows} season={season} mode="running" />
      </MemoryRouter>,
    );

    const quroe = rowOf('Quroe');
    // The settled score is still zero and still what the row is ranked on.
    expect(within(quroe).getByText('0 cr')).toBeTruthy();
    // The mark, and what the pool would pay on it, are their own columns.
    expect(within(quroe).getByText('+312.5 cr')).toBeTruthy();
    expect(within(quroe).getByText('$271')).toBeTruthy();
  });

  test('names the columns so nobody reads the mark as the prize', () => {
    render(
      <MemoryRouter>
        <SeasonTable rows={rows} season={season} mode="running" />
      </MemoryRouter>,
    );
    // The key keeps its arrow; the marked pair says it is a projection.
    expect(screen.getByText('Settled profit ↓')).toBeTruthy();
    expect(screen.getByText('If prices hold')).toBeTruthy();
    expect(screen.getByText('Would pay')).toBeTruthy();
  });

  test('a season with no mark yet renders without the columns claiming zero', () => {
    const noMark: SeasonStanding[] = [
      { rank: 1, id: 'vi0', nickname: 'vi0', score: 12, prizeUsd: 1000, markedScore: null },
    ];
    render(
      <MemoryRouter>
        <SeasonTable rows={noMark} season={season} mode="settled" />
      </MemoryRouter>,
    );
    const row = rowOf('vi0');
    // Settled seasons publish finals only: the marked cells read as absent.
    expect(within(row).queryByText('If prices hold')).toBeNull();
    expect(within(row).getByText('+12 cr')).toBeTruthy();
  });
});
