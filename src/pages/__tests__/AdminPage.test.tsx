import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../../lib/api', () => ({
  api: {
    getProfile: vi.fn(),
    getFloorStats: vi.fn(),
    getFeedback: vi.fn(),
  },
}));

let authUser: { id: string } | null = { id: 'u1' };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
// The top bar drags in the whole floor page; the cockpit is what this spec
// is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { AdminPage } from '../AdminPage';

const stats = {
  visits24h: 12, uniques24h: 5, botVisits: 900,
  visitsByDay: [{ day: '2026-08-18', visits: 4, uniques: 3 }, { day: '2026-08-19', visits: 12, uniques: 5 }],
  topReferers: [{ source: 'manifold.markets', visits: 9 }],
  topPaths: [{ path: '/lookpilot', visits: 11 }],
  topCountries: [{ country: 'CZ', visits: 7, uniques: 3 }],
  recentVisitors: [{ ip: '1.2.3.4', country: 'CZ', visits: 3, lastSeen: '2026-08-19T10:00:00.000Z', kind: 'server', org: 'Hetzner' }],
  visitorSummary: { people: 4, servers: 1, proxies: 0 },
  signupsByDay: [{ day: '2026-08-19', signups: 2 }],
  recentSignups: [{ email: 'new@example.com', name: 'New Person', createdAt: '2026-08-19T09:00:00.000Z' }],
  totalUsers: 41,
  waitlist: [{ email: 'waiting@example.com', createdAt: '2026-08-18T09:00:00.000Z', source: 'marketplace' }],
};

const reports = [
  { id: 'f1', kind: 'bug', subject: 'Chart is blank', body: 'Nothing draws.', status: 'open', email: 'a@b.c', url: '/lookpilot', agentId: null, workspaceId: null, createdAt: '2026-08-19T08:00:00.000Z', updatedAt: '2026-08-19T08:00:00.000Z' },
];

const renderPage = () => render(<MemoryRouter><AdminPage /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'u1' };
  vi.mocked(api.getProfile).mockResolvedValue({ platformAdmin: true } as never);
  vi.mocked(api.getFloorStats).mockResolvedValue(stats as never);
  vi.mocked(api.getFeedback).mockResolvedValue({ items: reports } as never);
});

describe('/admin', () => {
  test('shows the platform admin traffic, signups, waitlist and reports', async () => {
    renderPage();
    // The glance.
    expect(await screen.findByText('41')).toBeInTheDocument();
    // Traffic, in every cut the page claims to show.
    expect(screen.getByText('manifold.markets')).toBeInTheDocument();
    expect(screen.getByText('/lookpilot')).toBeInTheDocument();
    expect(screen.getAllByText(/Czechia|Czech Republic|CZ/).length).toBeGreaterThan(0);
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
    // People, whole: a waitlist row is someone awaiting a reply.
    expect(screen.getByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText('waiting@example.com')).toBeInTheDocument();
    expect(screen.getByText('marketplace')).toBeInTheDocument();
    // Reports render their body inline, not behind a click.
    expect(screen.getByText('Chart is blank')).toBeInTheDocument();
    expect(screen.getByText('Nothing draws.')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });

  // The gate is the point of the page: anyone who is not a platform admin
  // must land on the floor exactly the way an unrecognised URL does, and
  // must never see a stat.
  test('sends a signed-in non-admin to the floor without loading anything', async () => {
    vi.mocked(api.getProfile).mockResolvedValue({ platformAdmin: false } as never);
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(screen.queryByText('waiting@example.com')).not.toBeInTheDocument();
  });

  test('sends a signed-out visitor to the floor', async () => {
    authUser = null;
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
    expect(api.getFloorStats).not.toHaveBeenCalled();
  });

  test('a failing profile check is a bounce, never an open page', async () => {
    vi.mocked(api.getProfile).mockRejectedValue(new Error('nope'));
    renderPage();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/', { replace: true }));
  });
});
