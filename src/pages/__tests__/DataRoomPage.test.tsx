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
      { id: 'the-market-on-itself', title: 'The market on itself', markdown: 'Running on itself.', blocks: ['market'] },
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
    market: {
      workspaceId: 'ws',
      name: 'Telarchy',
      slug: 'telarchy',
      market: {
        metricName: 'Active traders @1st October',
        metricDescription: null,
        consensus: null,
        currentValue: 4,
        rangeMin: 0,
        rangeMax: 50,
        targetDate: '2026-09',
        resolvesOn: '2026-10-01T00:00:00Z',
        liquidity: 360,
        tradedVolume: 120,
        history: [
          { at: '2026-08-01T00:00:00Z', value: 2 },
          { at: '2026-08-10T00:00:00Z', value: 4 },
        ],
      },
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

  test('a refused number reads as refused, never as zero', async () => {
    vi.mocked(api.getDataRoom).mockResolvedValue(feed as never);
    renderPage();
    // consensus is null in the feed: the market could not be priced, and a 0
    // there would be a forecast the market never made.
    await waitFor(() => expect(screen.getByText('not published')).toBeInTheDocument());
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  test('says so when the feed cannot be read', async () => {
    vi.mocked(api.getDataRoom).mockRejectedValue(new Error('down'));
    renderPage();
    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
  });
});
