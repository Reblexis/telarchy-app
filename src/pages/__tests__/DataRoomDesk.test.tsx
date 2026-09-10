import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * The desk: docs/data-room.md, "The desk: the strip, the ticker, and the dark".
 *
 * The rules under test are the ones a reader would be misled by if they broke:
 * the change on a tile is arithmetic on two published readings seven days
 * apart and is absent when the second one does not exist, the tiles are the
 * numbers the floor prices in the floor's own order, and the page fixes its
 * palette rather than following the visitor's.
 */

/** A run of daily readings ending today, so a 7-day change is computable. */
function daily(values: number[]): Array<{ at: string; value: number }> {
  const end = Date.UTC(2026, 8, 10);
  return values.map((value, i) => ({
    at: new Date(end - (values.length - 1 - i) * 86400000).toISOString().slice(0, 10),
    value,
  }));
}

const DAYS = daily([1, 2, 6, 4, 5, 6, 7, 8, 6, 9]); // 9 today, 6 seven days back

function feed(over: Record<string, unknown> = {}) {
  return {
    schema: 1,
    generatedAt: '2026-09-10T08:00:00Z',
    doc: {
      updatedAt: '2026-09-10',
      sections: [{ id: 'overview', title: 'Overview', markdown: 'The books.', blocks: [], part: 'numbers' }],
    },
    evidence: {
      pulse: {
        weeklyActiveVerifiedTraders: 9,
        tradesThisWeek: 244,
        openMarkets: 120,
        participants: 256,
        source: '/api/x',
      },
      rates: {
        weeks: [],
        metrics: [
          { name: 'Active traders', readings: [], daily: DAYS },
          { name: 'Telarchy revenue (USD)', readings: [], daily: daily([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]) },
        ],
      },
      trading: {
        byDay: daily([2, 2, 2, 2, 2, 2, 2, 2, 2, 2]).map(d => ({ day: d.at, trades: d.value, credits: 0, traders: 1 })),
      },
      traction: {
        accounts: 40,
        signupsByDay: daily([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]).map(d => ({ day: d.at, signups: d.value })),
      },
      events: [
        { at: '2026-09-01T00:00:00Z', kind: 'announced', label: 'Opened the market' },
        { at: '2026-09-05T00:00:00Z', kind: 'approved', label: 'Approved the referral share' },
      ],
      ...over,
    },
  };
}

async function show(over: Record<string, unknown> = {}) {
  vi.mocked(api.getDataRoom).mockResolvedValue(feed(over) as never);
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await screen.findByText('The books.');
  return container;
}

test('THE DATA ROOM FIXES ITS OWN PALETTE, WHATEVER THE VISITOR SET', async () => {
  const c = await show();
  expect(c.querySelector('[data-theme="dark"]')).toBeTruthy();
});

test('THE STRIP CARRIES ONE TILE PER PRICED METRIC, THEN TRADES AND PARTICIPANTS', async () => {
  const c = await show();
  const tiles = [...c.querySelectorAll('.dr-tile')];
  expect(tiles.map(t => t.querySelector('.dr-tile-label')?.textContent)).toEqual([
    'Active traders',
    'Telarchy revenue (USD)',
    'Trades this week',
    'Accounts',
  ]);
  expect(tiles.map(t => t.querySelector('.dr-tile-n')?.textContent)).toEqual(['9', '0', '244', '40']);
});

test('THE ACCOUNTS TOTAL IS COUNTED DOWN FROM THE PUBLISHED FIGURE', async () => {
  // Ten signups in the window and 40 accounts today: the total nine days ago
  // was 31, not 1. docs/data-room.md, "The running total of accounts".
  const c = await show();
  const accounts = [...c.querySelectorAll('.dr-tile')][3];
  expect(accounts.querySelector('.dr-tile-delta')?.textContent).toContain('+7');
});

test('A TILE PRINTS THE CHANGE AGAINST THE READING SEVEN DAYS BACK', async () => {
  const c = await show();
  const first = c.querySelector('.dr-tile');
  // 9 today against 6 on the reading seven days earlier.
  expect(first?.querySelector('.dr-tile-delta')?.textContent).toContain('+3');
  expect(first?.querySelector('.dr-tile-delta')?.textContent).toContain('7d');
});

test('A TILE WITH NO READING SEVEN DAYS BACK PRINTS NO CHANGE', async () => {
  const c = await show({
    rates: { weeks: [], metrics: [{ name: 'Active traders', readings: [], daily: daily([4, 9]) }] },
  });
  const first = c.querySelector('.dr-tile');
  expect(first?.querySelector('.dr-tile-n')?.textContent).toBe('9');
  expect(first?.querySelector('.dr-tile-delta')).toBeNull();
});

test('EVERY TILE DRAWS ITS SERIES WITH THE PAGE’S ONE TIME CHART', async () => {
  const c = await show();
  const tiles = [...c.querySelectorAll('.dr-tile')];
  expect(tiles.length).toBe(4);
  for (const tile of tiles) expect(tile.querySelector('svg.tchart-svg')).toBeTruthy();
});

test('A SPARK CARRIES NO AXIS LABELS', async () => {
  const c = await show();
  const spark = c.querySelector('.dr-tile svg.tchart-svg');
  expect(spark?.querySelector('.tchart-ylabel')).toBeNull();
  expect(spark?.querySelector('.tchart-xlabel')).toBeNull();
});

test('THE TICKER RUNS THE DATED THINGS THE OWNER DID, NEWEST FIRST', async () => {
  const c = await show();
  const rows = [...c.querySelectorAll('.dr-ticker-item')].map(r => r.textContent ?? '');
  expect(rows.length).toBe(2);
  expect(rows[0]).toContain('Approved the referral share');
  expect(rows[1]).toContain('Opened the market');
  expect(rows[0]).toContain('Sep 5');
});

test('AN EMPTY EVENT RECORD DRAWS NO TICKER', async () => {
  const c = await show({ events: [] });
  expect(c.querySelector('.dr-ticker')).toBeNull();
});
