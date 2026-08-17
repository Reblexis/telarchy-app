import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The floor's announcements section. The behaviour that matters is not that
 * prose renders: it is that an edited announcement cannot pass for an
 * untouched one. A reader must see that it was corrected, when, and what it
 * said before, because otherwise the surface is the owner's word again and
 * the charter promise it exists to keep is unverifiable.
 */

const getWorkspaceAnnouncements = vi.fn(async () => ({
  announcements: [
    { id: 'a2', body: 'Newer news', publishedAt: '2026-08-15T09:00:00Z', editedAt: null, originalBody: null },
    { id: 'a1', body: 'Older news', publishedAt: '2026-08-01T09:00:00Z', editedAt: null, originalBody: null },
  ],
}));
const publishAnnouncement = vi.fn(async () => ({
  id: 'a3', body: 'Just published', publishedAt: '2026-08-17T09:00:00Z', editedAt: null, originalBody: null,
}));
const editAnnouncement = vi.fn(async () => ({
  id: 'a2', body: 'Corrected', publishedAt: '2026-08-15T09:00:00Z',
  editedAt: '2026-08-16T09:00:00Z', originalBody: 'Newer news',
}));

vi.mock('../../lib/api', () => ({
  api: {
    getWorkspaceAnnouncements: () => getWorkspaceAnnouncements(),
    publishAnnouncement: (...a: unknown[]) => publishAnnouncement(...a as []),
    editAnnouncement: (...a: unknown[]) => editAnnouncement(...a as []),
  },
}));

import { FloorAnnouncements } from '../FloorAnnouncements';

const LATEST = {
  id: 'a2', body: 'Newer news', publishedAt: '2026-08-15T09:00:00Z', editedAt: null, originalBody: null,
};

beforeEach(() => {
  getWorkspaceAnnouncements.mockClear();
  publishAnnouncement.mockClear();
  editAnnouncement.mockClear();
});

describe('announcements on the floor', () => {
  test('the latest is open and the rest are one click away', async () => {
    render(<FloorAnnouncements workspaceId="ws" idOrSlug="floor" latest={LATEST} total={2} canManage={false} />);
    expect(screen.getByText('Newer news')).toBeTruthy();
    expect(screen.queryByText('Older news')).toBeNull();

    fireEvent.click(screen.getByText('1 earlier'));
    await waitFor(() => expect(screen.getByText('Older news')).toBeTruthy());
  });

  test('an edited announcement says so, and can show what it replaced', () => {
    render(
      <FloorAnnouncements
        workspaceId="ws"
        idOrSlug="floor"
        latest={{
          id: 'a2', body: 'Corrected', publishedAt: '2026-08-15T09:00:00Z',
          editedAt: '2026-08-16T09:00:00Z', originalBody: 'Newer news',
        }}
        total={1}
        canManage={false}
      />,
    );
    // The edit marker is the point: without it, an owner who rewrote a
    // disclosure after the fact reads identically to one who did not.
    expect(screen.getByText(/^edited /)).toBeTruthy();
    fireEvent.click(screen.getByText('what it said before'));
    expect(screen.getByText('As first published')).toBeTruthy();
    expect(screen.getByText('Newer news')).toBeTruthy();
  });

  test('a visitor gets no compose box, and no section at all on an empty floor', () => {
    const { container } = render(
      <FloorAnnouncements workspaceId="ws" idOrSlug="floor" latest={null} total={0} canManage={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  test('the owner publishes, and is told first that it cannot be taken back', async () => {
    render(<FloorAnnouncements workspaceId="ws" idOrSlug="floor" latest={null} total={0} canManage />);
    fireEvent.click(screen.getByText('New'));
    expect(screen.getByText(/cannot be deleted/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('New announcement'), { target: { value: 'Sale locked in' } });
    fireEvent.click(screen.getByText('Publish'));
    await waitFor(() => expect(screen.getByText('Just published')).toBeTruthy());
    expect(publishAnnouncement).toHaveBeenCalledWith('ws', 'Sale locked in');
  });

  test('an owner edit renders as an edit, original and all', async () => {
    render(<FloorAnnouncements workspaceId="ws" idOrSlug="floor" latest={LATEST} total={1} canManage />);
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('Edit announcement'), { target: { value: 'Corrected' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(screen.getByText('Corrected')).toBeTruthy());
    expect(editAnnouncement).toHaveBeenCalledWith('ws', 'a2', 'Corrected');
    expect(screen.getByText(/^edited /)).toBeTruthy();
  });
});
