import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * What is scheduled, on the page (docs/data-room.md, "What is scheduled").
 *
 * The rows are the raw thing: one per date the platform already holds, one
 * square per person on the outreach list. No tally of either, because the
 * squares are the tally.
 */
const CALENDAR = {
  dates: [
    { at: '2026-09-15T17:00:00.000Z', kind: 'decides', label: 'A $500 prize for the best agent' },
    { at: '2026-10-01T00:00:00.000Z', kind: 'settles', label: 'Active traders 2026-09' },
  ],
  outreach: { stages: ['draft', 'sent', 'sent', 'replied'] },
};

async function renderCalendar(calendar: unknown) {
  (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue({
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    doc: {
      updatedAt: '2026-09-09',
      sections: [{ id: 'scheduled', title: 'What is scheduled', markdown: 'The dates.', blocks: ['calendar'] }],
    },
    evidence: { calendar },
  });
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText('What is scheduled').length).toBeGreaterThan(1));
  return container;
}

describe('the dates', () => {
  test('one row per date, with the day and what falls due', async () => {
    const container = await renderCalendar(CALENDAR);
    const rows = [...container.querySelectorAll('[data-when="calendar"] .dr-when-row')].map(r => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Sep 15');
    expect(rows[0]).toContain('A $500 prize for the best agent');
    expect(rows[0]).toContain('decides');
    expect(rows[1]).toContain('settles');
  });

  test('nothing scheduled says so', async () => {
    const container = await renderCalendar({ dates: [], outreach: { stages: [] } });
    expect(container.textContent).toContain('Nothing scheduled');
  });
});

describe('the outreach list', () => {
  test('one square per person, and no count beside them', async () => {
    const container = await renderCalendar(CALENDAR);
    expect(container.querySelectorAll('.dr-stage-cell')).toHaveLength(4);
  });

  test('a square carries the stage it is at, so the shape of the list is readable', async () => {
    const container = await renderCalendar(CALENDAR);
    const cells = [...container.querySelectorAll('.dr-stage-cell')].map(c => c.getAttribute('data-stage'));
    expect(cells).toEqual(['draft', 'sent', 'sent', 'replied']);
  });

  test('nobody on the list draws no squares', async () => {
    const container = await renderCalendar({ dates: CALENDAR.dates, outreach: { stages: [] } });
    expect(container.querySelectorAll('.dr-stage-cell')).toHaveLength(0);
  });
});
