import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: {
    getPublicWorkspaces: vi.fn(),
    getMarketplaceWorkspace: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The top bar drags in the whole floor page; the marketplace grid is what
// this spec is about.
vi.mock('../TradePage', () => ({
  TopBar: () => null,
  settleDayOf: (d: string) => `settle-day(${d})`,
}));

import { api } from '../../lib/api';
import { FloorsPage } from '../FloorsPage';

const listing = {
  workspaceId: 'ws1',
  slug: 'lookpilot',
  name: 'LookPilot',
  description: 'A real product, run in the open.',
  proposalStats: { total: 3, approved: 0, declined: 1, declinedSpam: 0, withdrawn: 0, pending: 2 },
};

const payload = {
  participantCount: 14,
  tradesThisWeek: 108,
  markets: [{ metricName: 'LookPilot revenue (monthly, USD)', consensus: 77315.69, targetDate: '2026-08' }],
  marketHistory: [
    { at: '2026-08-11T06:41:39.275Z', consensus: 73600 },
    { at: '2026-08-13T17:01:26.679Z', consensus: 78570.63 },
  ],
};

const renderPage = () => render(<MemoryRouter><FloorsPage /></MemoryRouter>);

describe('marketplace', () => {
  beforeEach(() => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([listing] as never);
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue(payload as never);
  });

  test('states the mechanism once, in plain words', async () => {
    renderPage();
    expect(screen.getByText(/one number someone is trying to move/i)).toBeInTheDocument();
    expect(screen.getByText(/paid contract/i)).toBeInTheDocument();
  });

  test('never says "floor" to a visitor', async () => {
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    expect(container.textContent).not.toMatch(/floor/i);
  });

  test('a listing shows what it is, its number, and its market', async () => {
    const { container } = renderPage();
    await screen.findByText('LookPilot');
    await waitFor(() => expect(screen.getByText('$77,316')).toBeInTheDocument());
    expect(screen.getByText('A real product, run in the open.')).toBeInTheDocument();
    // The metric name loses its parenthetical unit tail.
    expect(screen.getByText('LookPilot revenue')).toBeInTheDocument();
    // The market itself: a spark drawn from the real trade history.
    expect(container.querySelector('.mkt-spark')).toBeTruthy();
    expect(container.querySelector('.mkt-spark-dot')).toBeTruthy();
  });

  test('the footer leads with settlement, then the activity behind it', async () => {
    renderPage();
    await screen.findByText('settles settle-day(2026-08)');
    expect(screen.getByText(/14 participants · 108 trades this week · 2 contracts priced now/)).toBeInTheDocument();
  });

  test('listing your own number is a cell of the grid, not a footnote', async () => {
    const { container } = renderPage();
    const tile = await screen.findByText('List your own number');
    const card = tile.closest('a');
    expect(card).toHaveAttribute('href', '/manage');
    expect(card).toHaveClass('mkt-card');
    expect(card?.parentElement).toHaveClass('mkt-grid');
    expect(container.querySelector('.mkt-new-plus')).toBeTruthy();
  });

  test('the grid still renders its listing tile when nothing is listed yet', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
    renderPage();
    expect(await screen.findByText('List your own number')).toBeInTheDocument();
  });
});
