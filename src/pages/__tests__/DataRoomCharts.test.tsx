import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * What the data room draws (docs/data-room.md, "How the page draws things").
 *
 * Numbers with a history are lines on a date axis, and the metric charts
 * carry the dated things the owner did as marks on the day they happened. The
 * page is a document a forecaster reads to price where a number goes next, so
 * the drawing that answers that has to be the one it uses.
 */
const EVENTS = [
  { at: '2026-08-22T10:00:00.000Z', kind: 'announcement', label: 'Season 0 opened' },
  { at: '2026-09-04T10:00:00.000Z', kind: 'approved', label: 'Trader rewards' },
];

const RATES = {
  weeks: [
    '2026-07-22',
    '2026-07-29',
    '2026-08-05',
    '2026-08-12',
    '2026-08-19',
    '2026-08-26',
    '2026-09-02',
    '2026-09-09',
  ],
  metrics: [
    {
      name: 'Active traders',
      readings: [0, 2, 3, 6, null, 8, 11, 9],
      daily: [
        { at: '2026-08-20', value: 4 },
        { at: '2026-08-21', value: 5 },
        { at: '2026-08-22', value: 6 },
        { at: '2026-09-04', value: 8 },
        { at: '2026-09-05', value: 9 },
      ],
    },
  ],
};

const TRADING = {
  byDay: [
    { day: '2026-09-01', trades: 4, credits: 900, traders: 2 },
    { day: '2026-09-02', trades: 9, credits: 2400, traders: 5 },
  ],
};

const TRAFFIC = {
  byDay: [
    { day: '2026-09-01', visits: 400, uniques: 30 },
    { day: '2026-09-02', visits: 600, uniques: 41 },
  ],
  keptSince: '2026-08-11',
  visits24h: 600,
  uniques24h: 41,
  visits7d: 1000,
  totalVisits: 12970,
};

async function renderBlocks(blocks: string[], evidence: Record<string, unknown>) {
  (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    doc: {
      updatedAt: '2026-09-09',
      sections: [{ id: 'over-time', title: 'Over time', markdown: 'The shapes.', blocks }],
    },
    evidence: { events: EVENTS, ...evidence },
  });
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText('Over time').length).toBeGreaterThan(1));
  return container;
}

describe('a priced metric is a line over time, annotated', () => {
  test('the daily readings are the line, not the eight weekly numbers', async () => {
    const c = await renderBlocks(['rates'], { rates: RATES });
    const pts = [...c.querySelectorAll('.tchart-line')].flatMap(l =>
      (l.getAttribute('points') ?? '').trim().split(/\s+/),
    );
    expect(pts).toHaveLength(5);
  });

  test('the dated things the owner did are marked on the chart', async () => {
    const c = await renderBlocks(['rates'], { rates: RATES });
    // Both events fall inside the drawn range, and both are on days with a
    // reading, so both get a mark.
    expect(c.querySelectorAll('.tchart-event').length).toBe(2);
  });

  test('the weekly readings stay printed under the line: a shape is not a base rate', async () => {
    const c = await renderBlocks(['rates'], { rates: RATES });
    const cells = [...c.querySelectorAll('.dr-rate-vals span')].map(x => x.textContent);
    expect(cells).toEqual(['0', '2', '3', '6', '—', '8', '11', '9']);
  });

  test('a metric with readings but no daily points still prints its weeks', async () => {
    const c = await renderBlocks(['rates'], {
      rates: { weeks: RATES.weeks, metrics: [{ name: 'Revenue', readings: [0, 0, 0, 0, 0, 0, 0, 0], daily: [] }] },
    });
    expect(c.querySelectorAll('.dr-rate-vals span')).toHaveLength(8);
  });
});

describe('the trading under the trader count', () => {
  test('credits, trades and the people who placed them are three charts, not one squashed one', async () => {
    const c = await renderBlocks(['trading'], { trading: TRADING });
    // Ten people against a hundred trades on one axis draws the people flat.
    expect(c.querySelectorAll('.tchart-svg').length).toBe(3);
    expect(c.textContent).toContain('Credits traded, per day');
    expect(c.textContent).toContain('People trading, per day');
  });

  test('the credits axis is a log one, and says so', async () => {
    const c = await renderBlocks(['trading'], { trading: TRADING });
    expect(c.textContent).toContain('log axis');
  });

  test('nothing traded yet says so', async () => {
    const c = await renderBlocks(['trading'], { trading: { byDay: [] } });
    expect(c.textContent).toContain('Nothing recorded yet');
  });
});

describe('traffic', () => {
  test('visits and distinct visitors get a chart each, because one axis flattens the people', async () => {
    const c = await renderBlocks(['traffic'], { traffic: TRAFFIC });
    expect(c.querySelectorAll('.tchart-svg').length).toBe(2);
    expect(c.textContent).toContain('Visits, per day');
    expect(c.textContent).toContain('Distinct addresses, per day');
  });
});

test('TRAFFIC FILTERING DOES NOT ESTABLISH HUMAN IDENTITY', async () => {
  const c = await renderBlocks(['traffic'], { traffic: TRAFFIC });
  expect(c.textContent).toContain('Known crawlers and scanner paths excluded');
  expect(c.textContent).not.toContain('Humans only');
  expect(c.textContent).not.toContain('Distinct visitors');
  expect(screen.getByLabelText('Distinct addresses per day')).toBeTruthy();
});
