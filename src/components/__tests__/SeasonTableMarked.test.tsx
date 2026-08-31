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
    // Settled money, nothing open: the row that proves the mark is a total.
    rank: 2,
    id: 'philipp-gl',
    nickname: 'philipp-gl',
    score: 232.31,
    projectedPrizeUsd: 241.42,
    markedScore: 232.31,
    markedProjectedPrizeUsd: 164,
  },
  {
    rank: 3,
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
    expect(screen.getByText('Total if prices hold')).toBeTruthy();
    expect(screen.getByText('Would pay')).toBeTruthy();
  });

  test('the mark is a TOTAL, so a row with nothing open reads the same twice', () => {
    // The rule the header has to carry: "Total if prices hold" includes the
    // settled column, it does not add to it. philipp-gl has 232.31 settled and
    // nothing open, so both columns say 232.31 and the reader can see that a
    // row without open positions is unchanged by the projection.
    render(
      <MemoryRouter>
        <SeasonTable rows={rows} season={season} mode="running" />
      </MemoryRouter>,
    );
    const philipp = rowOf('philipp-gl');
    expect(within(philipp).getAllByText('+232.31 cr')).toHaveLength(2);
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
    expect(within(row).queryByText('Total if prices hold')).toBeNull();
    expect(within(row).getByText('+12 cr')).toBeTruthy();
  });
});

/**
 * The phone (owner report 2026-08-31: "the phone view looks like shit... i
 * think normal columns are even better than that").
 *
 * The phone used to hide both new columns and stack their numbers under the
 * score, so every row was three lines and the leader's row was the tallest
 * thing on the screen. It now carries the same four numeric columns the
 * desktop does, in a tighter rendering, under one line of grouped headers
 * that says which pair decides money - the job the accent underline does on
 * a wider screen.
 */
describe('the standings on a phone', () => {
  function renderRunning() {
    render(
      <MemoryRouter>
        <SeasonTable rows={rows} season={season} mode="running" />
      </MemoryRouter>,
    );
  }

  test('no number is stacked under the score any more', () => {
    renderRunning();
    // The sub-lines that made a row three tall are gone; the numbers they
    // carried are columns now.
    expect(document.querySelectorAll('.lbt-msub')).toHaveLength(0);
  });

  test('every money column has a tight rendering for the narrow screen', () => {
    renderRunning();
    const quroe = rowOf('Quroe');
    // Wide: what a desktop reads. Tight: no unit, no cents past a hundred.
    expect(within(quroe).getByText('+312.5 cr')).toBeTruthy();
    expect(within(quroe).getByText('+313')).toBeTruthy();
    const vi0 = rowOf('vi0');
    expect(within(vi0).getByText('+706.77 cr')).toBeTruthy();
    expect(within(vi0).getByText('+707')).toBeTruthy();
    expect(within(vi0).getByText('$734.49')).toBeTruthy();
    expect(within(vi0).getByText('$734')).toBeTruthy();
  });

  test('the grouped header says which pair pays', () => {
    renderRunning();
    expect(screen.getByText('Pays the prize')).toBeTruthy();
    expect(screen.getByText('If prices hold')).toBeTruthy();
  });

  test('the header carries a short form of every column name', () => {
    renderRunning();
    expect(screen.getByText('Settled profit ↓')).toBeTruthy();
    expect(screen.getByText('Settled cr ↓')).toBeTruthy();
    expect(screen.getByText('Total if prices hold')).toBeTruthy();
    expect(screen.getByText('Total cr')).toBeTruthy();
    expect(screen.getByText('Projected prize')).toBeTruthy();
    expect(screen.getByText('Prize')).toBeTruthy();
  });

  test('a settled season keeps its two columns and needs no group line', () => {
    const done: SeasonStanding[] = [
      { rank: 1, id: 'vi0', nickname: 'vi0', score: 12, prizeUsd: 1000, markedScore: null },
    ];
    render(
      <MemoryRouter>
        <SeasonTable rows={done} season={season} mode="settled" />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Pays the prize')).toBeNull();
    expect(screen.getByText('+12 cr')).toBeTruthy();
    expect(screen.getByText('+12')).toBeTruthy();
  });
});
