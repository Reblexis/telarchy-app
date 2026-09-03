import { render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

/** The card lives on /admin (docs/manifold-update.md, "What the owner does"). */
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => vi.fn() };
});
vi.mock('../../lib/api', () => ({
  api: {
    getProfile: vi.fn().mockResolvedValue({ platformAdmin: true }),
    getFloorStats: vi.fn().mockReturnValue(new Promise(() => {})),
    getFeedback: vi.fn().mockReturnValue(new Promise(() => {})),
    getFloorQuestions: vi.fn().mockReturnValue(new Promise(() => {})),
    getAdminEarnTable: vi.fn().mockResolvedValue({ rules: [] }),
    getJourneys: vi.fn().mockReturnValue(new Promise(() => {})),
    findParticipants: vi.fn(),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' }, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));
vi.mock('../../components/XWorkbench', () => ({ XWorkbench: () => null }));
vi.mock('../../components/EarnTableEditor', () => ({ EarnTableEditor: () => null }));
vi.mock('../../components/ManifoldUpdate', () => ({ ManifoldUpdate: () => <div>manifold update card</div> }));

import { MemoryRouter } from 'react-router-dom';
import { AdminPage } from '../AdminPage';

describe('/admin', () => {
  test('carries the Manifold update card', async () => {
    render(
      <MemoryRouter>
        <AdminPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('manifold update card')).toBeInTheDocument();
  });
});
