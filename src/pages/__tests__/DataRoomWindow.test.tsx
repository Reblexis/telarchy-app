import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * The window block on the page (docs/data-room.md, "The window is the rows
 * behind the next reading").
 *
 * The block exists because a count of the rows throws away the tail, so what
 * is pinned here is that the page draws the ROWS: one mark per participant,
 * one per lapsing week, one per undecided proposal, one per payment. And that
 * a value taller than the axis is still readable, because an axis that
 * silently swallows the biggest trader is the summary this block replaced.
 */
function feedWith(window: unknown) {
  return {
    schema: 1,
    generatedAt: '2026-09-09T12:00:00.000Z',
    doc: {
      updatedAt: '2026-09-09',
      sections: [{ id: 'the-window', title: 'The window', markdown: 'The rows.', blocks: ['window'] }],
    },
    evidence: { window },
  };
}

const FULL = {
  at: '2026-09-09T12:00:00.000Z',
  traders: {
    threshold: 100,
    spend: [4200, 880, 310, 140, 96, 55, 0],
    lapses: ['2026-09-10', '2026-09-10', '2026-09-14', '2026-09-16'],
  },
  forecasters: { threshold: 100, profit: [860, 140, 6, -30, -520] },
  owners: {
    pending: [
      { slug: 'pinecast', title: 'Raise the paid tier to $9', decideBy: '2026-09-14' },
      { slug: 'hedgerow', title: 'Ship the weekly digest', decideBy: null },
    ],
  },
  revenue: {
    payments: [
      { usd: 49, status: 'pending', at: '2026-09-06' },
      { usd: 5, status: 'completed', at: '2026-09-01' },
    ],
  },
};

async function renderFeed(window: unknown) {
  (api.getDataRoom as ReturnType<typeof vi.fn>).mockResolvedValue(feedWith(window));
  const { container } = render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(screen.getAllByText('The window').length).toBeGreaterThan(1));
  return container;
}

describe('the window draws one mark per row', () => {
  test('one bar per verified participant, zeroes included', async () => {
    const container = await renderFeed(FULL);
    const bars = container.querySelectorAll('[data-dist="traders"] .dr-dist-bar');
    expect(bars).toHaveLength(FULL.traders.spend.length);
  });

  test('one bar per participant in the profit distribution, losses included', async () => {
    const container = await renderFeed(FULL);
    const bars = container.querySelectorAll('[data-dist="forecasters"] .dr-dist-bar');
    expect(bars).toHaveLength(FULL.forecasters.profit.length);
  });

  test('one dot per lapsing week, and the days are named', async () => {
    const container = await renderFeed(FULL);
    expect(container.querySelectorAll('.dr-lapse-dot')).toHaveLength(FULL.traders.lapses.length);
    expect(container.querySelector('.dr-lapse')?.textContent).toContain('Sep 10');
  });

  test('every undecided proposal is a row, with its floor and its deadline', async () => {
    const container = await renderFeed(FULL);
    const rows = [...container.querySelectorAll('[data-when="owners"] .dr-when-row')].map(r => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('pinecast');
    expect(rows[0]).toContain('Raise the paid tier to $9');
    expect(rows[0]).toContain('Sep 14');
    // A proposal with no deadline says so rather than showing an empty cell.
    expect(rows[1]).toContain('Ship the weekly digest');
    expect(rows[1]).toContain('no deadline');
  });

  test('every payment is a row, with its amount, its state and its day', async () => {
    const container = await renderFeed(FULL);
    const rows = [...container.querySelectorAll('[data-when="revenue"] .dr-when-row')].map(r => r.textContent ?? '');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('$49');
    expect(rows[0]).toContain('pending');
    expect(rows[0]).toContain('Sep 6');
    expect(rows[1]).toContain('$5');
    expect(rows[1]).toContain('completed');
  });
});

describe('nothing is lost off the top of an axis', () => {
  test('a value taller than the axis is printed, not silently clipped', async () => {
    const container = await renderFeed(FULL);
    // 4,200 is far past the traders axis, so the page prints it in full.
    const over = container.querySelector('[data-dist="traders"] .dr-dist-over')?.textContent ?? '';
    expect(over).toContain('4,200');
  });

  test('the threshold that decides the count is drawn and named', async () => {
    const container = await renderFeed(FULL);
    expect(container.querySelectorAll('.dr-dist-threshold').length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('100 cr counts');
  });
});

describe('an empty window says so', () => {
  test('no verified participant, no proposal and no payment reads as nothing yet, not as zero bars', async () => {
    const container = await renderFeed({
      at: '2026-09-09T12:00:00.000Z',
      traders: { threshold: 100, spend: [], lapses: [] },
      forecasters: { threshold: 100, profit: [] },
      owners: { pending: [] },
      revenue: { payments: [] },
    });
    expect(container.querySelectorAll('.dr-dist-bar')).toHaveLength(0);
    expect(screen.getAllByText(/Nothing recorded yet|No payment|Nothing waiting/).length).toBeGreaterThan(0);
  });
});
