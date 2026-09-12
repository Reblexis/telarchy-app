import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * A workspace's own log (docs/data-room.md, "A workspace's log"): the data
 * room's log with the workspace fixed, in the floor's light palette, under a
 * back link and "<name> log", UTC like the room.
 */

vi.mock('../../lib/api', async importOriginal => ({
  ...(await importOriginal<typeof import('../../lib/api')>()),
  api: {
    getActions: vi.fn(async () => ({
      generatedAt: '2026-09-12T20:22:00Z',
      kinds: [
        { id: 'trade', label: 'Trades', description: 'A trade.' },
        { id: 'decision', label: 'Decisions', description: 'A decision.' },
      ],
      workspaces: [
        { slug: 'telarchy', name: 'Telarchy', hidden: false },
        { slug: 'snake', name: 'Snake', hidden: true },
      ],
      rows: [
        {
          id: 'trade:t1',
          at: '2026-09-12T20:21:06.000Z',
          kind: 'trade',
          workspace: { slug: 'snake', name: 'Snake' },
          actor: { id: 'v', handle: 'vi0' },
          text: 'bought 306.34 higher shares on Reached length for 151.18 cr, call 16.71 to 18.82',
          detail: {},
          href: '/snake#market=m&trade=t1',
        },
      ],
      next: null,
    })),
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { WorkspaceLogPage } from '../WorkspaceLogPage';

function open(path = '/snake/log') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/:slug/log" element={<WorkspaceLogPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('a workspace log page', () => {
  test('reads the log with the workspace fixed from the address', async () => {
    open();
    await waitFor(() => expect(api.getActions).toHaveBeenCalled());
    expect(vi.mocked(api.getActions).mock.calls[0][0]).toMatchObject({ workspace: 'snake' });
  });

  test('titles itself "<name> log" under a back link to the workspace, in the light palette', async () => {
    const { container } = open();
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Snake log' })).toBeTruthy());
    expect(screen.getByRole('link', { name: /Back to Snake/ }).getAttribute('href')).toBe('/snake');
    expect(container.querySelector('[data-theme="dark"]')).toBeNull();
  });

  test("has no floor select and names no floor on a row, since every row is this workspace's", async () => {
    const { container } = open();
    await waitFor(() => expect(container.querySelector('.dr-row')).toBeTruthy());
    expect(screen.queryByLabelText('Floor')).toBeNull();
    expect(container.querySelector('.dr-row-floor')).toBeNull();
    expect(screen.getByText('vi0')).toBeTruthy();
  });

  test('says its times are UTC, like the room', async () => {
    open();
    await waitFor(() => expect(screen.getByText(/times are UTC/i)).toBeTruthy());
  });
});
