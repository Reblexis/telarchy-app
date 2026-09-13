import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The floor's bell. What matters: the unread count is visible without
 * opening anything, the panel lists what happened with a link that lands on
 * the proposal itself, reading clears the count without emptying the list,
 * and an empty inbox says what will appear there rather than "no data".
 */

const getNotifications = vi.fn(async () => ({
  unread: 2,
  seenAt: '2026-08-19T09:00:00.000Z',
  notifications: [
    {
      id: 'pm-1',
      kind: 'comment' as const,
      at: new Date().toISOString(),
      actor: 'trader-9',
      subject: '$2000: Create a Telarchy tournament',
      detail: 'what is the deadline?',
      workspaceSlug: 'telarchy',
      proposalId: 'prop-1',
      marketId: null,
      commentId: 'msg-7',
      unread: true,
    },
    {
      id: 'dec-2',
      kind: 'decision' as const,
      at: new Date().toISOString(),
      actor: null,
      subject: 'Open source a trading agent',
      detail: 'out of scope this quarter',
      workspaceSlug: 'telarchy',
      proposalId: 'prop-2',
      marketId: null,
      commentId: null,
      unread: true,
    },
  ],
}));
const markNotificationsSeen = vi.fn(async () => ({ ok: true, seenAt: new Date().toISOString() }));
const markNotificationRead = vi.fn(async () => ({ ok: true }));

vi.mock('../../lib/api', () => ({
  api: {
    getNotifications: () => getNotifications(),
    markNotificationsSeen: () => markNotificationsSeen(),
    markNotificationRead: (id: string) => markNotificationRead(id),
  },
}));

import { NotificationsBell } from '../NotificationsBell';

/** The bell navigates through the router, so it is mounted in one. */
const bell = () =>
  render(
    <MemoryRouter>
      <NotificationsBell />
    </MemoryRouter>,
  );

beforeEach(() => {
  markNotificationsSeen.mockClear();
  markNotificationRead.mockClear();
});

describe('the notifications bell', () => {
  test('shows the unread count before anything is opened', async () => {
    bell();
    expect(await screen.findByText('2')).toBeTruthy();
  });

  test('lists what happened, and links a proposal row to that proposal', async () => {
    bell();
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }));
    expect(await screen.findByText('$2000: Create a Telarchy tournament')).toBeTruthy();
    expect(screen.getByText(/trader-9 commented on your proposal/)).toBeTruthy();
    const link = screen.getAllByRole('link')[0] as HTMLAnchorElement;
    // The comment row points at the COMMENT, so the floor can flash the line
    // rather than dropping the reader on the page it lives on.
    expect(link.getAttribute('href')).toBe('/telarchy#proposal=prop-1&comment=msg-7');
    // A decision has no comment, so it points at the proposal alone.
    expect((screen.getAllByRole('link')[1] as HTMLAnchorElement).getAttribute('href')).toBe(
      '/telarchy#proposal=prop-2',
    );
  });

  test('a decision on my own proposal reads as mine, with the reason', async () => {
    bell();
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }));
    expect(await screen.findByText(/A proposal was decided/)).toBeTruthy();
    expect(screen.getByText('out of scope this quarter')).toBeTruthy();
  });

  test('marking read clears the count and keeps the rows', async () => {
    bell();
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }));
    fireEvent.click(await screen.findByRole('button', { name: /mark all read/i }));
    await waitFor(() => expect(markNotificationsSeen).toHaveBeenCalled());
    expect(screen.queryByText('2')).toBeNull();
    expect(screen.getByText('$2000: Create a Telarchy tournament')).toBeTruthy();
  });

  test('an empty inbox says what will land there', async () => {
    getNotifications.mockImplementationOnce(async () => ({ unread: 0, seenAt: null, notifications: [] }));
    bell();
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }));
    expect(await screen.findByText(/Comments on your proposals/)).toBeTruthy();
  });
});

/**
 * Owner ask 2026-08-19: "one less per click on the new stuff". Opening a row
 * reads that row only, and reading it twice is not two decrements.
 */
describe('reading one row', () => {
  test('takes one off the count and clears that row', async () => {
    bell();
    fireEvent.click(await screen.findByRole('button', { name: /what's new/i }));
    fireEvent.click(await screen.findByText('$2000: Create a Telarchy tournament'));
    await waitFor(() => expect(markNotificationRead).toHaveBeenCalledWith('pm-1'));
    // Two unread became one, not zero: the other row is untouched.
    expect(await screen.findByText('1')).toBeTruthy();
  });
});
