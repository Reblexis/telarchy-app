import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The cockpit is tabbed and only the open tab costs anything
 * (docs/ui-conventions.md). Opening outreach must not read the visitor log:
 * that read is what took the site down on 2026-09-09, and the cheapest query
 * is the one nobody asked for.
 */
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('../../lib/api', () => ({
  api: {
    getProfile: vi.fn(),
    getFloorStats: vi.fn(),
    getFeedback: vi.fn(),
    getFloorQuestions: vi.fn(),
    getJourneys: vi.fn(),
    resolveFeedback: vi.fn(),
    searchParticipants: vi.fn(),
  },
}));

const authUser = { id: 'u1', email: 'a@b.c' };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));
vi.mock('../../components/XWorkbench', () => ({ XWorkbench: () => <div>x workbench</div> }));
vi.mock('../../components/OutreachWorkbench', () => ({ OutreachWorkbench: () => <div>outreach workbench</div> }));
vi.mock('../../components/ManifoldUpdate', () => ({ ManifoldUpdate: () => null }));
vi.mock('../../components/EarnTableEditor', () => ({ EarnTableEditor: () => null }));

import { api } from '../../lib/api';
import { AdminPage } from '../AdminPage';

const mock = (f: unknown) => f as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
  mock(api.getProfile).mockResolvedValue({ platformAdmin: true });
  mock(api.getFloorStats).mockResolvedValue({ visits24h: 0, uniques24h: 0, visitsByDay: [], recentVisitors: [] });
  mock(api.getFeedback).mockResolvedValue({ items: [] });
  mock(api.getFloorQuestions).mockResolvedValue({ totalCostUsd: 0, questions: [] });
  mock(api.getJourneys).mockResolvedValue({
    summary: { journeys: 0, bounced: 0, visitors: 0, medianSteps: 0 },
    topExits: [],
    journeys: [],
  });
});

describe('the admin cockpit is tabbed', () => {
  test('it opens on outreach and does not touch the visitor log', async () => {
    render(<AdminPage />);
    expect(await screen.findByText('outreach workbench')).toBeInTheDocument();
    // The reads that caused the outage are not made for this tab.
    await waitFor(() => expect(api.getProfile).toHaveBeenCalled());
    expect(api.getJourneys).not.toHaveBeenCalled();
    expect(api.getFloorStats).not.toHaveBeenCalled();
  });

  test('the traffic tab is what reads the visitor log, and only when opened', async () => {
    render(<AdminPage />);
    await screen.findByText('outreach workbench');
    fireEvent.click(screen.getByRole('button', { name: /traffic/i }));
    await waitFor(() => expect(api.getFloorStats).toHaveBeenCalled());
    await waitFor(() => expect(api.getJourneys).toHaveBeenCalled());
  });

  test('one surface at a time: the X workbench is not mounted while outreach is open', async () => {
    render(<AdminPage />);
    await screen.findByText('outreach workbench');
    expect(screen.queryByText('x workbench')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^x$/i }));
    expect(await screen.findByText('x workbench')).toBeInTheDocument();
    expect(screen.queryByText('outreach workbench')).not.toBeInTheDocument();
  });

  test('the open tab is in the URL, so a reload comes back where he was', async () => {
    window.location.hash = '#traffic';
    render(<AdminPage />);
    await waitFor(() => expect(api.getFloorStats).toHaveBeenCalled());
    expect(screen.queryByText('outreach workbench')).not.toBeInTheDocument();
  });

  test('feedback reads its own two endpoints and not the visitor log', async () => {
    render(<AdminPage />);
    await screen.findByText('outreach workbench');
    fireEvent.click(screen.getByRole('button', { name: /reports/i }));
    await waitFor(() => expect(api.getFeedback).toHaveBeenCalled());
    expect(api.getJourneys).not.toHaveBeenCalled();
  });
});
