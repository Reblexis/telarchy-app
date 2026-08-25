import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The comment thread under the one market view, and specifically what a
 * notification link does to it: a row that says "someone commented on your
 * contract" must land on THAT comment, not near it. The panel opens even
 * when it was collapsed, scrolls the line into view, and flashes it once;
 * the flash is an arrival, never a selected state left behind.
 */

const getFloorComments = vi.fn(async () => [
  { id: 'c-old', fromName: 'trader-1', content: 'first thought', createdAt: new Date().toISOString() },
  { id: 'c-target', fromName: 'trader-9', content: 'how will you measure this?', createdAt: new Date().toISOString() },
]);
const getMarketActivity = vi.fn(async (_idOrSlug: string, _marketId: string) => ({
  positions: [] as unknown[],
  trades: [] as unknown[],
}));

vi.mock('../../lib/api', () => ({
  api: {
    getFloorComments: () => getFloorComments(),
    getMarketActivity: (idOrSlug: string, marketId: string) => getMarketActivity(idOrSlug, marketId),
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
    render(
      <MemoryRouter>
        <FloorComments {...props} focusCommentId="c-target" onFocusHandled={onFocusHandled} />
      </MemoryRouter>,
    );

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
    render(
      <MemoryRouter>
        <FloorComments {...props} focusCommentId="c-gone" onFocusHandled={onFocusHandled} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
    expect(document.querySelector('.is-flashed')).toBeNull();
  });

  test('with nothing pointed at, the panel stays closed', async () => {
    render(
      <MemoryRouter>
        <FloorComments {...props} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getFloorComments).toHaveBeenCalled());
    expect(screen.queryByText('how will you measure this?')).toBeNull();
  });
});

describe('a contract covers both branch markets', () => {
  // Owner report 2026-08-21: "why dont i see any trades made on the
  // conditional markets". A contract opens on "if approved"; when its only
  // trades sat on the declined branch, the branch-scoped panel answered
  // "Trades (0)", which read as the trades having been lost.
  const trade = (id: string, handle: string) => ({
    id,
    handle,
    direction: 'lower',
    kind: 'buy',
    shares: 338.9,
    cost: 221,
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    getMarketActivity.mockImplementation(async (_idOrSlug: string, marketId: string) =>
      marketId === 'mkt-declined'
        ? {
            positions: [{ handle: 'boss', id: 'boss', direction: 'lower', shares: 338.9, cost: 221, worth: 120 }],
            trades: [trade('t1', 'boss'), trade('t2', 'viktor')],
          }
        : { positions: [], trades: [] },
    );
  });

  const contractProps = {
    ...props,
    subject: {
      proposalId: 'prop-1',
      markets: [
        { marketId: 'mkt-approved', branch: 'approved' as const },
        { marketId: 'mkt-declined', branch: 'declined' as const },
      ],
    },
  };

  test('trades on the other branch still count and render, labeled with their world', async () => {
    const { getByText } = render(
      <MemoryRouter>
        <FloorComments {...contractProps} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getByText('Trades (2)')).toBeInTheDocument());
    expect(getByText('Positions (1)')).toBeInTheDocument();

    getByText('Trades (2)').click();
    const row = (await screen.findByText('boss')).closest('li')!;
    expect(row.textContent).toContain('if declined');
  });

  test('a baseline market has one world and carries no label', async () => {
    getMarketActivity.mockImplementation(async () => ({
      positions: [],
      trades: [trade('t1', 'boss')],
    }));
    const { getByText } = render(
      <MemoryRouter>
        <FloorComments {...props} subject={{ marketId: 'mkt-hero' }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getByText('Trades (1)')).toBeInTheDocument());
    getByText('Trades (1)').click();
    const row = (await screen.findByText('boss')).closest('li')!;
    expect(row.textContent).not.toContain('if ');
  });
});
