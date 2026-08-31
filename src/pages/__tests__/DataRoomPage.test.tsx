import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getDataRoom: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
// The top bar drags in the whole floor page; the document is what this spec
// is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { DataRoomPage } from '../DataRoomPage';

/**
 * What a visitor sees on telarchy.com/data-room (docs/data-room.md).
 *
 * The page's promise is that it renders the feed and nothing else, so the
 * cases worth pinning are the ones where a page would normally invent
 * something: prose it was not given, and a zero where the feed refused to
 * publish a number.
 */
const feed = {
  schema: 1,
  generatedAt: '2026-08-20T12:00:00.000Z',
  doc: {
    updatedAt: '2026-08-20',
    sections: [
      { id: 'overview', title: 'Overview', markdown: 'The books, in public.', blocks: ['pulse'] },
      { id: 'shipping', title: 'Shipping', markdown: 'The log is the git history.', blocks: ['shipping'] },
      { id: 'who-is-here', title: 'Who is here', markdown: 'Running on itself.', blocks: ['funnel'] },
    ],
  },
  evidence: {
    pulse: {
      weeklyActiveVerifiedTraders: 2,
      participants: 211,
      openMarkets: 24,
      tradesThisWeek: 29,
      source: '/api/marketplace/stats',
    },
    funnel: {
      steps: [
        { id: 'loads', n: 8000, shareOfAbove: null },
        { id: 'accounts', n: 40, shareOfAbove: 40 / 8000 },
        { id: 'verified', n: 10, shareOfAbove: 10 / 40 },
        // The last step's predecessor is present, but a step with no traffic
        // above it must publish no share rather than a percentage of nothing.
        { id: 'weeklyActive', n: 2, shareOfAbove: null },
      ],
      loadsSince: '2026-08-11',
    },
    traction: {
      participants: 211,
      accounts: 12,
      verifiedParticipants: 5,
      trades: 300,
      creditsTraded: 5000,
      openMarkets: 24,
      settledMarkets: 3,
      publicFloors: 2,
      signupsByDay: [],
    },
    contracts: { proposed: 10, approved: 2, declined: 1, pending: 7, withdrawn: 0, approvedUsd: 300 },
    traffic: {
      byDay: [
        { day: '2026-08-19', visits: 40, uniques: 12 },
        { day: '2026-08-20', visits: 61, uniques: 20 },
      ],
      keptSince: '2026-08-19',
      visits24h: 61,
      uniques24h: 20,
      visits7d: 101,
      uniques7d: 30,
      totalVisits: 101,
    },
    shipping: {
      days: [
        { date: '2026-08-19', changes: 9 },
        { date: '2026-08-20', changes: 12 },
      ],
      changes: [{ date: '2026-08-20', subject: 'Keep every question asked of a floor' }],
      total: 1055,
      builtAt: '2026-08-20',
    },
  },
};

function renderPage() {
  return render(
    <MemoryRouter>
      <DataRoomPage />
    </MemoryRouter>,
  );
}

describe('the data room page', () => {
  test('renders the prose it was given, section by section', async () => {
    vi.mocked(api.getDataRoom).mockResolvedValue(feed as never);
    renderPage();
    // 'Overview' appears twice by design: once in the index, once as the
    // section label.
    await waitFor(() => expect(screen.getAllByText('Overview').length).toBe(2));
    expect(screen.getByText('The books, in public.')).toBeInTheDocument();
    expect(screen.getByText('The log is the git history.')).toBeInTheDocument();
    // Every section is reachable from the index.
    expect(screen.getAllByText('Shipping').length).toBeGreaterThanOrEqual(2);
  });

  test('shows the live figures, and the change log as committed', async () => {
    vi.mocked(api.getDataRoom).mockResolvedValue(feed as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('1,055')).toBeInTheDocument());
    expect(screen.getByText('weekly active verified traders')).toBeInTheDocument();
    expect(screen.getByText('Keep every question asked of a floor')).toBeInTheDocument();
  });

  test('the funnel prints each step as a share of the one above it', async () => {
    vi.mocked(api.getDataRoom).mockResolvedValue(feed as never);
    renderPage();
    await waitFor(() => expect(screen.getByText('8,000')).toBeInTheDocument());
    expect(screen.getByText('0.5% of the step above')).toBeInTheDocument();
    expect(screen.getByText('25.0% of the step above')).toBeInTheDocument();
    // The first step has nothing above it, and a step whose share was refused
    // shows no percentage rather than 0%.
    expect(screen.queryByText('0.0% of the step above')).not.toBeInTheDocument();
  });

  test('says so when the feed cannot be read', async () => {
    vi.mocked(api.getDataRoom).mockRejectedValue(new Error('down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
