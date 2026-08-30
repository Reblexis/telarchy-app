import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The record, on its own page (owner direction 2026-08-20). The behaviour
 * that matters is not that prose renders: it is that an edited announcement
 * cannot pass for an untouched one. A reader must see that it was corrected,
 * when, and what it said before, because otherwise the surface is the owner's
 * word again and the charter promise it exists to keep is unverifiable.
 */

const getWorkspaceAnnouncements = vi.fn(async () => ({
  announcements: [
    { id: 'a2', body: 'Newer news', publishedAt: '2026-08-15T09:00:00Z', editedAt: null, originalBody: null },
    { id: 'a1', body: 'Older news', publishedAt: '2026-08-01T09:00:00Z', editedAt: null, originalBody: null },
  ],
}));
const getMarketplaceWorkspace = vi.fn(async () => ({ workspaceId: 'ws', name: 'Telarchy', slug: 'telarchy' }));
const getProfile = vi.fn(async () => ({ authRole: 'admin' }));
const publishAnnouncement = vi.fn(async () => ({
  id: 'a3',
  body: 'Just published',
  publishedAt: '2026-08-17T09:00:00Z',
  editedAt: null,
  originalBody: null,
}));
const editAnnouncement = vi.fn(async () => ({
  id: 'a2',
  body: 'Corrected',
  publishedAt: '2026-08-15T09:00:00Z',
  editedAt: '2026-08-16T09:00:00Z',
  originalBody: 'Newer news',
}));

vi.mock('../../lib/api', () => ({
  api: {
    getWorkspaceAnnouncements: () => getWorkspaceAnnouncements(),
    getMarketplaceWorkspace: () => getMarketplaceWorkspace(),
    getProfile: () => getProfile(),
    publishAnnouncement: (...a: unknown[]) => publishAnnouncement(...(a as [])),
    editAnnouncement: (...a: unknown[]) => editAnnouncement(...(a as [])),
  },
}));
let signedIn = true;
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: signedIn ? { id: 'u' } : null, loading: false }) }));
// The top bar drags in the whole floor page; the record is what this is about.
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { AnnouncementsPage } from '../AnnouncementsPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/telarchy/announcements']}>
      <Routes>
        <Route path="/:slug/announcements" element={<AnnouncementsPage />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  signedIn = true;
  getWorkspaceAnnouncements.mockClear();
  publishAnnouncement.mockClear();
  editAnnouncement.mockClear();
});

describe('the announcements page', () => {
  test('shows every announcement, newest first, in full', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Newer news')).toBeTruthy());
    expect(screen.getByText('Older news')).toBeTruthy();
    const bodies = [...document.querySelectorAll('.pubws-ann-body')].map(n => n.textContent);
    expect(bodies).toEqual(['Newer news', 'Older news']);
  });

  test('names the guarantee that makes it a record, and links back to the floor', async () => {
    renderPage();
    expect(screen.getByText(/cannot be deleted or backdated/)).toBeTruthy();
    // The slug labels the way back before the workspace payload arrives (the
    // label is uppercased in CSS, so the name replacing it is invisible), and
    // the link works either way.
    expect(screen.getByText('telarchy').getAttribute('href')).toBe('/telarchy');
    await waitFor(() => expect(screen.getByText('Telarchy').getAttribute('href')).toBe('/telarchy'));
  });

  test('an edited announcement says so, and can show what it replaced', async () => {
    getWorkspaceAnnouncements.mockResolvedValueOnce({
      announcements: [
        {
          id: 'a2',
          body: 'Corrected',
          publishedAt: '2026-08-15T09:00:00Z',
          editedAt: '2026-08-16T09:00:00Z',
          originalBody: 'Newer news',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText(/^edited /)).toBeTruthy());
    fireEvent.click(screen.getByText('what it said before'));
    expect(screen.getByText('As first published')).toBeTruthy();
    expect(screen.getByText('Newer news')).toBeTruthy();
  });

  test('a visitor gets no compose box and no edit control', async () => {
    signedIn = false;
    renderPage();
    await waitFor(() => expect(screen.getByText('Newer news')).toBeTruthy());
    expect(screen.queryByText('Write one')).toBeNull();
    expect(screen.queryByText('Edit')).toBeNull();
  });

  test('the owner publishes, and is told first that it cannot be taken back', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Write one')).toBeTruthy());
    fireEvent.click(screen.getByText('Write one'));
    expect(screen.getByText(/cannot be deleted, and the server stamps the time/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New announcement'), { target: { value: 'Something material' } });
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(screen.getByText('Just published')).toBeTruthy());
    expect(publishAnnouncement).toHaveBeenCalledWith('ws', 'Something material');
  });

  test('an owner edit renders as an edit, original and all', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Edit').length).toBe(2));
    fireEvent.click(screen.getAllByText('Edit')[0]);
    fireEvent.change(screen.getByLabelText('Edit announcement'), { target: { value: 'Corrected' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByText(/^edited /)).toBeTruthy());
    fireEvent.click(screen.getByText('what it said before'));
    expect(screen.getByText('Newer news')).toBeTruthy();
  });
});
