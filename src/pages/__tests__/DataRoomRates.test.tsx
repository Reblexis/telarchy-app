import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * The base rates on the page (docs/data-room.md, "The base rates are every
 * weekly reading").
 *
 * The block replaced "biggest week +3, flat 1 of 8", so the page has to print
 * the readings themselves. The case that matters most is the hole: a week
 * nobody measured must not be drawn as a week the number did not move.
 */
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
    { name: 'Active traders', readings: [0, 2, 3, 6, null, 8, 11, 9] },
    { name: 'Telarchy revenue (USD)', readings: [0, 0, 0, 0, 0, 0, 0, 0] },
  ],
};

async function renderRates(rates: unknown) {
  (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    doc: {
      updatedAt: '2026-09-09',
      sections: [{ id: 'the-window', title: 'The window', markdown: 'The rows.', blocks: ['rates'] }],
    },
    evidence: { rates },
  });
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText('The window').length).toBeGreaterThan(1));
  return container;
}

describe('every weekly reading is on the page', () => {
  test('one row per metric, named', async () => {
    const container = await renderRates(RATES);
    const rows = container.querySelectorAll('.dr-rate');
    expect(rows).toHaveLength(2);
    expect(container.textContent).toContain('Active traders');
  });

  test('the eight readings are printed, not only drawn', async () => {
    const container = await renderRates(RATES);
    const cells = [...container.querySelectorAll('.dr-rate-vals span')].map(c => c.textContent);
    expect(cells.slice(0, 8)).toEqual(['0', '2', '3', '6', '—', '8', '11', '9']);
  });

  test('a week with no reading is a dash, never a number the sync did not take', async () => {
    const container = await renderRates(RATES);
    const cells = [...(container.querySelector('.dr-rate')?.querySelectorAll('.dr-rate-vals span') ?? [])];
    const unread = cells.filter(c => c.classList.contains('is-unread'));
    expect(unread).toHaveLength(1);
    expect(unread[0].textContent).toBe('—');
    // The line itself is the DAILY readings now (docs/data-room.md, "How the
    // page draws things"); TimeChart owns the rule that a gap breaks it.
  });

  test('the row is bookended by the weeks it covers', async () => {
    const container = await renderRates(RATES);
    const caption = container.querySelector('.dr-rate-cap')?.textContent ?? '';
    expect(caption).toContain('Jul 22');
    expect(caption).toContain('Sep 9');
  });

  test('nothing recorded yet says so', async () => {
    const container = await renderRates({ weeks: RATES.weeks, metrics: [] });
    expect(container.querySelectorAll('.dr-rate')).toHaveLength(0);
    expect(container.textContent).toContain('Nothing recorded yet');
  });
});
