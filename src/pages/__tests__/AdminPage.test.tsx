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
    getFloorQuestions: vi.fn(),
    getJourneys: vi.fn(),
    // The earn table sits on this page too (2026-08-30). It has its own
    // spec; here it only has to not take the cockpit down with it, which
    // is exactly what an undefined method did.
    getAdminEarnTable: vi.fn(),
    setEarnRule: vi.fn(),
  },
}));

let authUser: { id: string } | null = { id: 'u1' };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
// The top bar drags in the whole floor page; the cockpit is what this spec
// is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { AdminPage } from '../AdminPage';

const questions = {
  totalCostUsd: 0.0123,
  questions: [
    {
      id: 'q1',
      workspaceId: 'ws1',
      slug: 'lookpilot',
      workspaceName: 'LookPilot',
      question: 'What does LookPilot sell?',
      answer: 'Webcam head tracking, $14.99 on Steam.',
      askedBy: null,
      askedByName: null,
      country: 'CZ',
      costUsd: 0.0009,
      model: 'openai/gpt-5.6-luna',
      error: null,
      createdAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'q2',
      workspaceId: 'ws1',
      slug: 'lookpilot',
      workspaceName: 'LookPilot',
      question: 'How many staff?',
      answer: '',
      askedBy: 'agent-7',
      askedByName: 'trader-7',
      country: null,
      costUsd: null,
      model: 'openai/gpt-5.6-luna',
      error: 'gateway 402 (budget spent)',
      createdAt: '2026-08-20T11:00:00.000Z',
    },
  ],
};

const stats = {
  visits24h: 12,
  uniques24h: 5,
  botVisits: 900,
  visitsByDay: [
    { day: '2026-08-18', visits: 4, uniques: 3 },
    { day: '2026-08-19', visits: 12, uniques: 5 },
  ],
  topReferers: [{ source: 'manifold.markets', visits: 9 }],
  topPaths: [{ path: '/lookpilot', visits: 11 }],
  topCountries: [{ country: 'CZ', visits: 7, uniques: 3 }],
  recentVisitors: [
    { ip: '1.2.3.4', country: 'CZ', visits: 3, lastSeen: '2026-08-19T10:00:00.000Z', kind: 'server', org: 'Hetzner' },
  ],
  visitorSummary: { people: 4, servers: 1, proxies: 0 },
  signupsByDay: [{ day: '2026-08-19', signups: 2 }],
  recentSignups: [{ email: 'new@example.com', name: 'New Person', createdAt: '2026-08-19T09:00:00.000Z' }],
  totalUsers: 41,
  waitlist: [{ email: 'waiting@example.com', createdAt: '2026-08-18T09:00:00.000Z', source: 'marketplace' }],
};

const reports = [
  {
    id: 'f1',
    kind: 'bug',
    subject: 'Chart is blank',
    body: 'Nothing draws.',
    status: 'open',
    email: 'a@b.c',
    url: '/lookpilot',
    agentId: null,
    workspaceId: null,
    createdAt: '2026-08-19T08:00:00.000Z',
    updatedAt: '2026-08-19T08:00:00.000Z',
  },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  authUser = { id: 'u1' };
  vi.mocked(api.getProfile).mockResolvedValue({ platformAdmin: true } as never);
  vi.mocked(api.getFloorStats).mockResolvedValue(stats as never);
  vi.mocked(api.getFeedback).mockResolvedValue({ items: reports } as never);
  vi.mocked(api.getFloorQuestions).mockResolvedValue(questions as never);
  vi.mocked(api.getAdminEarnTable).mockResolvedValue({ rules: [] } as never);
  vi.mocked(api.getJourneys).mockResolvedValue({
    summary: { journeys: 0, bounced: 0, visitors: 0, medianSteps: 0 },
    topExits: [],
    journeys: [],
  } as never);
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
    // Not even the headline: a page that paints "Admin" for a second before
    // bouncing has told the stranger it exists.
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });

  test('paints nothing while the admin check is still in flight', () => {
    // getProfile pending: the page must be blank, not a headline waiting to
    // be taken away.
    vi.mocked(api.getProfile).mockReturnValue(new Promise(() => {}) as never);
    const { container } = renderPage();
    expect(container.textContent).toBe('');
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

/**
 * The question log (owner ask 2026-08-20). What matters: the visitor's own
 * words are on screen, an unanswered question is not hidden behind a status,
 * and an anonymous asker reads as anonymous rather than as a blank.
 */
describe('/admin questions', () => {
  test('shows what was asked, what came back, and who asked', async () => {
    render(<AdminPage />);
    expect(await screen.findByText('What does LookPilot sell?')).toBeTruthy();
    expect(screen.getByText('Webcam head tracking, $14.99 on Steam.')).toBeTruthy();
    // The unanswered one says so, with the reason.
    expect(screen.getByText(/No answer: gateway 402/)).toBeTruthy();
    // Identity: a handle where there is one, "anonymous" where there is not.
    expect(screen.getByText(/anonymous · CZ/)).toBeTruthy();
    expect(screen.getByText(/trader-7/)).toBeTruthy();
  });
});
