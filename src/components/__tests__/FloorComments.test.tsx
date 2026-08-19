import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/**
 * The comment thread under the one market view, and specifically what a
 * notification link does to it: a row that says "someone commented on your
 * contract" must land on THAT comment, not near it. The panel opens even
 * when it was collapsed, scrolls the line into view, and flashes it once;
 * the flash is an arrival, never a selected state left behind.
 */

const getFloorComments = vi.fn(async () => ([
  { id: 'c-old', fromName: 'trader-1', content: 'first thought', createdAt: new Date().toISOString() },
  { id: 'c-target', fromName: 'trader-9', content: 'how will you measure this?', createdAt: new Date().toISOString() },
]));
const getMarketActivity = vi.fn(async () => ({ positions: [], trades: [] }));

vi.mock('../../lib/api', () => ({
  api: {
    getFloorComments: () => getFloorComments(),
    getMarketActivity: () => getMarketActivity(),
    sendProposalMessage: vi.fn(),
    sendMarketMessage: vi.fn(),
  },
}));

import { FloorComments } from '../FloorComments';

beforeEach(() => {
  getFloorComments.mockClear();
  Element.prototype.scrollIntoView = vi.fn();
});

const props = {
  idOrSlug: 'telarchy',
  subject: { proposalId: 'prop-1' },
  canPost: false,
  onRequireSignup: () => {},
};

describe('a comment a notification points at', () => {
  test('opens the collapsed thread and flashes that comment', async () => {
    const onFocusHandled = vi.fn();
    render(<FloorComments {...props} focusCommentId="c-target" onFocusHandled={onFocusHandled} />);

    // The thread opens on its own: the reader was told about a line, not a tab.
    const target = await screen.findByText('how will you measure this?');
    const row = target.closest('li')!;
    await waitFor(() => expect(row.className).toContain('is-flashed'));
    expect(row.scrollIntoView).toHaveBeenCalled();

    // Only the named line flashes.
    expect(screen.getByText('first thought').closest('li')!.className).not.toContain('is-flashed');
    expect(onFocusHandled).toHaveBeenCalled();
  });

  test('a comment that no longer exists is handled, not waited on', async () => {
    const onFocusHandled = vi.fn();
    render(<FloorComments {...props} focusCommentId="c-gone" onFocusHandled={onFocusHandled} />);
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
    expect(document.querySelector('.is-flashed')).toBeNull();
  });

  test('with nothing pointed at, the panel stays closed', async () => {
    render(<FloorComments {...props} />);
    await waitFor(() => expect(getFloorComments).toHaveBeenCalled());
    expect(screen.queryByText('how will you measure this?')).toBeNull();
  });
});
