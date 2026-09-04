import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The comment thread under the one market view, and specifically what a
 * notification link does to it: a row that says "someone commented on your
 * proposal" must land on THAT comment, not near it. The panel opens even
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

describe('a proposal covers both branch markets', () => {
  // Owner report 2026-08-21: "why dont i see any trades made on the
  // conditional markets". A proposal opens on "if approved"; when its only
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
            pool: [],
          }
        : { positions: [], trades: [], pool: [] },
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
    await waitFor(() => expect(getByText('Activity (2)')).toBeInTheDocument());
    expect(getByText('Positions (1)')).toBeInTheDocument();

    getByText('Activity (2)').click();
    const row = (await screen.findByText('boss')).closest('li')!;
    expect(row.textContent).toContain('if declined');
  });

  // Owner ask 2026-08-31: the pool is the other half of every price in this
  // list, so it belongs in it. The tab counts both, and a reader who counts
  // the rows finds the number on the tab.
  test('the pool moving is in the same list, in the same order, and counts', async () => {
    getMarketActivity.mockImplementation(async () => ({
      positions: [],
      trades: [{ ...trade('t1', 'boss'), createdAt: '2026-08-30T10:00:00.000Z' }],
      pool: [
        {
          id: 'l1',
          handle: 'harbour-roasters',
          kind: 'deepened',
          amount: 1000,
          pool: 2386,
          createdAt: '2026-08-30T12:00:00.000Z',
        },
        { id: 'l0', handle: null, kind: 'opened', amount: 150, pool: 150, createdAt: '2026-08-29T09:00:00.000Z' },
      ],
    }));
    const { getByText } = render(
      <MemoryRouter>
        <FloorComments {...props} subject={{ marketId: 'mkt-hero' }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getByText('Activity (3)')).toBeInTheDocument());
    getByText('Activity (3)').click();

    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll('.pubws-mkt-list li')];
      expect(found).toHaveLength(3);
      return found;
    });
    // Newest first, both kinds in one order: the injection above the trade is
    // why that trade moved the price less than it would have.
    expect(rows[0].textContent).toContain('deepened the pool by 1,000');
    expect(rows[0].textContent).toContain('pool 2,386 cr');
    expect(rows[1].textContent).toContain('bought');
    // The platform's own opening liquidity has no funder to name.
    expect(rows[2].textContent).toContain('the house');
    expect(rows[2].textContent).toContain('opened it with 150');
  });

  test('a baseline market has one world and carries no label', async () => {
    getMarketActivity.mockImplementation(async () => ({
      positions: [],
      trades: [trade('t1', 'boss')],
      pool: [],
    }));
    const { getByText } = render(
      <MemoryRouter>
        <FloorComments {...props} subject={{ marketId: 'mkt-hero' }} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(getByText('Activity (1)')).toBeInTheDocument());
    getByText('Activity (1)').click();
    const row = (await screen.findByText('boss')).closest('li')!;
    expect(row.textContent).not.toContain('if ');
  });
});

describe('a trade a profile points at', () => {
  // docs/ui-conventions.md, "A trade has an address": #trade=<id> opens the
  // Activity tab, scrolls that row into view and flashes it once, the way a
  // pointed-at comment does. A trade no longer in the list is handled, not
  // waited on.
  const trade = (id: string, handle: string, shares: number, cost: number) => ({
    id,
    handle,
    direction: 'higher',
    kind: 'buy',
    shares,
    cost,
    createdAt: new Date().toISOString(),
  });

  beforeEach(() => {
    getMarketActivity.mockImplementation(async () => ({
      positions: [],
      trades: [trade('t-new', 'genzy', 1204, 855), trade('t-target', 'vire', 21191.72, 6300)],
      pool: [],
    }));
  });

  const marketProps = { ...props, subject: { marketId: 'mkt-1' } };

  test('opens the Activity tab and flashes that trade', async () => {
    const onFocusHandled = vi.fn();
    render(
      <MemoryRouter>
        <FloorComments {...marketProps} focusTradeId="t-target" onFocusHandled={onFocusHandled} />
      </MemoryRouter>,
    );
    const row = (await screen.findByText('vire')).closest('li')!;
    expect(row.getAttribute('data-trade-id')).toBe('t-target');
    await waitFor(() => expect(row.className).toContain('is-flashed'));
    expect(row.scrollIntoView).toHaveBeenCalled();
    expect(screen.getByText('genzy').closest('li')!.className).not.toContain('is-flashed');
    expect(onFocusHandled).toHaveBeenCalled();
  });

  test('a trade that is no longer listed is handled, not waited on', async () => {
    const onFocusHandled = vi.fn();
    render(
      <MemoryRouter>
        <FloorComments {...marketProps} focusTradeId="t-gone" onFocusHandled={onFocusHandled} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(onFocusHandled).toHaveBeenCalled());
    expect(document.querySelector('.is-flashed')).toBeNull();
    // The tab is still open on the right market.
    expect(await screen.findByText('genzy')).toBeInTheDocument();
  });

  test('an Activity row names the price per share', async () => {
    render(
      <MemoryRouter>
        <FloorComments {...marketProps} />
      </MemoryRouter>,
    );
    (await screen.findByText('Activity (2)')).click();
    const row = (await screen.findByText('vire')).closest('li')!;
    expect(row.textContent).toContain('bought 21,192 at 0.297 cr');
  });
});
