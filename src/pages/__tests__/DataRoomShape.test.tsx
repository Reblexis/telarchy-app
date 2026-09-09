import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * The shape of the page (docs/data-room.md, "One page, three parts").
 *
 * One URL, ordered by the questions a reader arrives with, with the index
 * grouping the sections under the part they belong to so it navigates like
 * three pages without becoming three. And exactly two drawings on it, both
 * interactive: a series over dates, and a value per ranked unit.
 */
const SECTIONS = [
  { id: 'overview', title: 'Overview', part: 'numbers', markdown: 'What this is.', blocks: [] },
  { id: 'the-numbers', title: 'The numbers', part: 'numbers', markdown: 'Every priced number.', blocks: ['rates'] },
  { id: 'the-window', title: 'The window', part: 'numbers', markdown: 'The rows.', blocks: ['window'] },
  { id: 'traffic', title: 'Traffic', part: 'place', markdown: 'Who came.', blocks: ['traffic'] },
  { id: 'risks', title: 'Risks', part: 'plan', markdown: 'What could go wrong.', blocks: [] },
];

const EVIDENCE = {
  events: [{ at: '2026-08-22T10:00:00.000Z', kind: 'announcement', label: 'Season 0 opened' }],
  rates: {
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
          { at: '2026-08-21', value: 5 },
          { at: '2026-08-22', value: 6 },
        ],
      },
    ],
  },
  window: {
    at: '2026-09-09T12:00:00.000Z',
    traders: { threshold: 100, spend: [4200, 880, 96, 0], lapses: ['2026-09-10', '2026-09-10', '2026-09-14'] },
    forecasters: { threshold: 100, profit: [860, 40, -30] },
    owners: { pending: [] },
    revenue: { payments: [] },
  },
  traffic: {
    byDay: [
      { day: '2026-09-01', visits: 400, uniques: 30 },
      { day: '2026-09-02', visits: 600, uniques: 41 },
    ],
    keptSince: '2026-08-11',
    visits24h: 600,
    uniques24h: 41,
    visits7d: 1000,
    totalVisits: 12970,
  },
};

async function renderPage() {
  (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    doc: { updatedAt: '2026-09-09', sections: SECTIONS },
    evidence: EVIDENCE,
  });
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText('The numbers').length).toBeGreaterThan(0));
  return container;
}

describe('the index groups the page into its parts', () => {
  test('each part is a named group of the sections in it', async () => {
    const c = await renderPage();
    const groups = [...c.querySelectorAll('.dr-index-group')];
    expect(groups).toHaveLength(3);
    expect(groups[0].textContent).toContain('The numbers');
    expect(groups[0].textContent).toContain('Overview');
    expect(groups[2].textContent).toContain('Risks');
  });

  test('a part with no sections is not a heading over nothing', async () => {
    (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
      schema: 1,
      generatedAt: '2026-09-09T12:00:00.000Z',
      doc: { updatedAt: '2026-09-09', sections: [SECTIONS[0]] },
      evidence: EVIDENCE,
    });
    const { container } = render(
      <MemoryRouter>
        <DataRoomPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(container.querySelectorAll('.dr-index-group').length).toBe(1));
  });

  test('every section still has its own anchor, so a link into one keeps working', async () => {
    const c = await renderPage();
    for (const s of SECTIONS) expect(c.querySelector(`#${s.id}`)).toBeTruthy();
  });
});

describe('two drawings, both interactive', () => {
  test('the distribution is a rank chart, not a picture', async () => {
    const c = await renderPage();
    expect(c.querySelectorAll('.rchart-svg').length).toBe(2);
    expect(c.querySelectorAll('.rchart-bar').length).toBe(7);
  });

  test('the seven days the counted traders lapse over are a series, like every other series', async () => {
    const c = await renderPage();
    // Drawn by the same component as the metric line above it, not by a
    // bespoke strip of dots.
    expect(c.querySelector('[data-lapse]')?.querySelector('.tchart-svg')).toBeTruthy();
  });

  test('nothing on the page is a static drawing', async () => {
    const c = await renderPage();
    const svgs = [...c.querySelectorAll('svg')];
    expect(svgs.length).toBeGreaterThan(2);
    for (const svg of svgs) {
      const cls = svg.getAttribute('class') ?? '';
      expect(['tchart-svg', 'rchart-svg'].some(k => cls.includes(k))).toBe(true);
    }
  });
});
