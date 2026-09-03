import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The cockpit's journeys block: what one visitor did, in order
 * (docs/ui-conventions.md, "Journeys"). The block exists to answer "where
 * did they stop", so the order of the pages and the bounce label are the
 * two things that must survive a redesign of it.
 */

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
    getAdminEarnTable: vi.fn(),
    setEarnRule: vi.fn(),
  },
}));

vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'u1' }, loading: false }),
}));
vi.mock('../TradePage', () => ({ TopBar: () => null }));
// The workbench has its own tests; stubbed here so the cockpit's own tests
// do not have to keep its API surface in their mock.
vi.mock('../../components/XWorkbench', () => ({ XWorkbench: () => null }));
vi.mock('../../components/ManifoldUpdate', () => ({ ManifoldUpdate: () => null }));

import { api } from '../../lib/api';
import { AdminPage } from '../AdminPage';

const emptyStats = {
  visits24h: 0,
  uniques24h: 0,
  botVisits: 0,
  visitsByDay: [],
  topReferers: [],
  topPaths: [],
  topCountries: [],
  recentVisitors: [],
  visitorSummary: { people: 0, servers: 0, proxies: 0 },
  signupsByDay: [],
  recentSignups: [],
  totalUsers: 0,
  waitlist: [],
};

const journey = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  ip: '1.1.1.1',
  userAgent: 'Firefox',
  country: 'CZ',
  referer: 'https://manifold.markets/q/telarchy',
  startedAt: '2026-09-01T10:00:00.000Z',
  entryPath: '/',
  exitPath: '/join',
  durationSeconds: 200,
  bounced: false,
  steps: [
    { path: '/', ts: '2026-09-01T10:00:00.000Z', secondsOnPage: 20 },
    {
      path: '/leaderboard',
      ts: '2026-09-01T10:00:20.000Z',
      secondsOnPage: 180,
    },
    { path: '/join', ts: '2026-09-01T10:03:20.000Z', secondsOnPage: null },
  ],
  ...over,
});

function mount(journeysBody: unknown) {
  (api.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
    platformAdmin: true,
  });
  (api.getFloorStats as ReturnType<typeof vi.fn>).mockResolvedValue(emptyStats);
  (api.getFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({
    items: [],
  });
  (api.getFloorQuestions as ReturnType<typeof vi.fn>).mockResolvedValue({
    totalCostUsd: 0,
    questions: [],
  });
  (api.getAdminEarnTable as ReturnType<typeof vi.fn>).mockResolvedValue({
    rules: [],
  });
  (api.getJourneys as ReturnType<typeof vi.fn>).mockResolvedValue(journeysBody);
  return render(
    <MemoryRouter>
      <AdminPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the journeys block', () => {
  test('shows the pages in the order the visitor saw them', async () => {
    const { container } = mount({
      summary: { journeys: 1, bounced: 0, visitors: 1, medianSteps: 3 },
      topExits: [{ path: '/join', journeys: 1 }],
      journeys: [journey()],
    });

    await waitFor(() => expect(container.querySelectorAll('.adm-step-path').length).toBe(3));
    expect([...container.querySelectorAll('.adm-step-path')].map(e => e.textContent)).toEqual([
      '/',
      '/leaderboard',
      '/join',
    ]);
  });

  test('labels a bounce, because it is the most common outcome and must not hide', async () => {
    mount({
      summary: { journeys: 1, bounced: 1, visitors: 1, medianSteps: 1 },
      topExits: [{ path: '/', journeys: 1 }],
      journeys: [
        journey({
          id: 'j2',
          exitPath: '/',
          durationSeconds: 0,
          bounced: true,
          steps: [{ path: '/', ts: '2026-09-01T10:00:00.000Z', secondsOnPage: null }],
        }),
      ],
    });

    expect(await screen.findByText('bounced')).toBeTruthy();
  });

  test('names where the visitor came from, by domain', async () => {
    mount({
      summary: { journeys: 1, bounced: 0, visitors: 1, medianSteps: 3 },
      topExits: [],
      journeys: [journey()],
    });

    expect(await screen.findByText(/manifold\.markets/)).toBeTruthy();
  });

  test('calls a journey with no referer direct', async () => {
    mount({
      summary: { journeys: 1, bounced: 0, visitors: 1, medianSteps: 3 },
      topExits: [],
      journeys: [journey({ referer: null })],
    });

    expect(await screen.findByText(/direct/)).toBeTruthy();
  });

  test('lists where journeys stopped, so the losing page is visible without reading each one', async () => {
    mount({
      summary: { journeys: 3, bounced: 1, visitors: 3, medianSteps: 2 },
      topExits: [
        { path: '/join', journeys: 2 },
        { path: '/', journeys: 1 },
      ],
      journeys: [journey()],
    });

    const heading = await screen.findByText('Where they stopped');
    const block = heading.closest('.adm-block')!;
    expect(block.textContent).toContain('/join');
  });

  test('says so plainly when nobody has visited yet', async () => {
    mount({
      summary: { journeys: 0, bounced: 0, visitors: 0, medianSteps: 0 },
      topExits: [],
      journeys: [],
    });

    // Scoped to this block: several other cockpit lists share the wording.
    const heading = await screen.findByText('Journeys');
    expect(heading.closest('.adm-block')!.textContent).toContain('No human visits yet.');
  });

  test('a throwing journeys call does not take the rest of the cockpit down', async () => {
    (api.getProfile as ReturnType<typeof vi.fn>).mockResolvedValue({
      platformAdmin: true,
    });
    (api.getFloorStats as ReturnType<typeof vi.fn>).mockResolvedValue(emptyStats);
    (api.getFeedback as ReturnType<typeof vi.fn>).mockResolvedValue({
      items: [],
    });
    (api.getFloorQuestions as ReturnType<typeof vi.fn>).mockResolvedValue({
      totalCostUsd: 0,
      questions: [],
    });
    (api.getAdminEarnTable as ReturnType<typeof vi.fn>).mockResolvedValue({
      rules: [],
    });
    // Thrown, not rejected: a rejected promise is caught and leaves the page
    // standing anyway, so it proves nothing. What actually took the cockpit
    // down on 2026-08-30 was a call that threw where it was made (an admin
    // method that did not exist), killing the poll for every other block
    // with it. See AdminPage's earn-table note.
    (api.getJourneys as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new TypeError('api.getJourneys is not a function');
    });

    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('Admin')).toBeTruthy();
    // And the blocks that load independently of it are still there.
    expect(await screen.findByText('Signups by day')).toBeTruthy();
  });

  test('counts pages in English, so one page is not "1 pages"', async () => {
    mount({
      summary: { journeys: 4, bounced: 3, visitors: 4, medianSteps: 1 },
      topExits: [],
      journeys: [journey()],
    });

    const heading = await screen.findByText('Journeys');
    const note = heading.closest('.adm-block')!.querySelector('.adm-note')!.textContent!;
    expect(note).toContain('1 page median');
    expect(note).not.toContain('1 pages');
  });

  test('still says pages when there is more than one', async () => {
    mount({
      summary: { journeys: 4, bounced: 1, visitors: 4, medianSteps: 3 },
      topExits: [],
      journeys: [journey()],
    });

    const heading = await screen.findByText('Journeys');
    expect(heading.closest('.adm-block')!.querySelector('.adm-note')!.textContent).toContain('3 pages median');
  });
});
