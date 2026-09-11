import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * A pending row keeps its place for its whole life (docs/ui-conventions.md,
 * "A pending row keeps its place for its whole life", 2026-09-11). The
 * report this pins: a click on "Turn left" with eight seconds left opened
 * the next minute's "Continue forward", because the list re-sorted between
 * the hover and the click and the row under the pointer became another
 * proposal.
 */
vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard, pendingBallot } from '../JobsBoard';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);
const MINUTE_1 = '2026-09-11T10:01:00Z';
const MINUTE_2 = '2026-09-11T10:02:00Z';

/** One snake proposal, as the floor's payload carries it. */
const proposal = (
  number: number,
  action: string,
  over: {
    decideBy?: string;
    createdAt?: string;
    status?: string;
    resolvedAt?: string;
    pool?: number;
    move?: number;
  } = {},
) =>
  ({
    id: `p${number}`,
    number,
    title: `Game 1, move ${over.move ?? 3}: ${action}`,
    description: '',
    askUsd: null,
    proposedByName: 'snake',
    proposedByHandle: 'snake',
    createdAt: over.createdAt ?? '2026-09-11T10:00:00Z',
    decideBy: over.decideBy ?? MINUTE_1,
    status: over.status ?? 'pending',
    resolvedAt: over.resolvedAt ?? null,
    marketPairCount: 1,
    markets: [
      {
        metricId: 'len',
        metricName: 'Reached length',
        targetDate: '2026-09-11T11:00',
        delta: 0.1,
        approvedPool: over.pool ?? 1000,
        declinedPool: over.pool ?? 1000,
      },
    ],
  }) as never;

/** The feed's own action order, the order of the chips under the grid. */
const feedOrder = (ids: string[]) => Object.fromEntries(ids.map((id, i) => [id, i]));

const base = {
  unit: '',
  selectedId: null,
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Snake',
  horizonDate: '2026-09-11T11:00',
  horizonMetricId: 'len',
};

function board(ps: unknown[], order: Record<string, number>, onSelect: (id: string) => void) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={ps as never} feedOrder={order} onSelect={onSelect} />
    </MemoryRouter>,
  );
}

function rowNumbers(): number[] {
  return [...document.querySelectorAll('.pubws-ballot-num')].map(e => Number((e.textContent ?? '').replace('#', '')));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

/* The three of one minute, in the feed's order: continue, left, right. */
const minute1 = [proposal(4023, 'Continue forward'), proposal(4022, 'Turn left'), proposal(4024, 'Turn right')];
const order1 = feedOrder(['p4023', 'p4022', 'p4024']);
/* The next minute's three, created later and decided later. */
const minute2 = [
  proposal(4026, 'Turn left', { decideBy: MINUTE_2, createdAt: '2026-09-11T10:01:00Z', move: 4 }),
  proposal(4027, 'Continue forward', { decideBy: MINUTE_2, createdAt: '2026-09-11T10:01:00Z', move: 4 }),
  proposal(4025, 'Turn right', { decideBy: MINUTE_2, createdAt: '2026-09-11T10:01:00Z', move: 4 }),
];
const order2 = { ...feedOrder(['p4027', 'p4026', 'p4025']) };
/* The same first minute, ruled on: forward played, the turns declined. */
const minute1Decided = [
  proposal(4023, 'Continue forward', { status: 'approved', resolvedAt: '2026-09-11T10:00:58Z' }),
  proposal(4022, 'Turn left', { status: 'declined', resolvedAt: '2026-09-11T10:00:58Z' }),
  proposal(4024, 'Turn right', { status: 'declined', resolvedAt: '2026-09-11T10:00:58Z' }),
];

describe('a click on a row lands on that proposal even if the list refreshes between hover and click', () => {
  test('the row under the pointer is still the same proposal after the next minute arrives', () => {
    const onSelect = vi.fn();
    const { rerender } = board(minute1, order1, onSelect);
    const left = screen.getByTitle('Game 1, move 3: Turn left');
    // The refresh the click races: this minute ruled on, next minute posted.
    rerender(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={[...minute1Decided, ...minute2] as never}
          feedOrder={{ ...order1, ...order2 }}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );
    // The very same DOM node, still naming the proposal it named.
    expect(document.contains(left)).toBe(true);
    expect(left.getAttribute('title')).toBe('Game 1, move 3: Turn left');
    expect(left.textContent).toContain('#4022');
    fireEvent.click(left);
    expect(onSelect).toHaveBeenCalledWith('p4022');
  });

  test("the next minute's rows are added under the ones already there", () => {
    const onSelect = vi.fn();
    const { rerender } = board(minute1, order1, onSelect);
    expect(rowNumbers()).toEqual([4023, 4022, 4024]);
    rerender(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={[...minute1Decided, ...minute2] as never}
          feedOrder={{ ...order1, ...order2 }}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );
    // The held minute first, in its own order, then the new one under it,
    // and the fold does not eat the sixth row.
    expect(rowNumbers()).toEqual([4023, 4022, 4024, 4027, 4026, 4025]);
  });

  test('a row decided under the reader holds its place for ten seconds, then joins the fold', () => {
    const onSelect = vi.fn();
    const { rerender } = board(minute1, order1, onSelect);
    const refresh = () =>
      rerender(
        <MemoryRouter>
          <JobsBoard
            {...base}
            proposals={[...minute1Decided, ...minute2] as never}
            feedOrder={{ ...order1, ...order2 }}
            onSelect={onSelect}
          />
        </MemoryRouter>,
      );
    refresh();
    expect(rowNumbers()).toContain(4022);
    // The row says what happened to it where it stands.
    const held = screen.getByTitle('Game 1, move 3: Turn left');
    expect(held.closest('li')?.textContent).toMatch(/declined/i);
    act(() => {
      vi.setSystemTime(NOW + 11_000);
      vi.advanceTimersByTime(11_000);
    });
    refresh();
    expect(rowNumbers()).toEqual([4027, 4026, 4025]);
  });
});

describe('rows never re-sort between refreshes', () => {
  test('a trade that changes the pools and the impacts moves nothing', () => {
    const onSelect = vi.fn();
    const { rerender } = board(minute1, order1, onSelect);
    expect(rowNumbers()).toEqual([4023, 4022, 4024]);
    // Somebody funds Turn right and drains Continue: the old order put the
    // deepest pool first, which is what moved a row under the pointer.
    rerender(
      <MemoryRouter>
        <JobsBoard
          {...base}
          proposals={
            [
              proposal(4023, 'Continue forward', { pool: 10 }),
              proposal(4022, 'Turn left', { pool: 400 }),
              proposal(4024, 'Turn right', { pool: 90_000 }),
            ] as never
          }
          feedOrder={order1}
          onSelect={onSelect}
        />
      </MemoryRouter>,
    );
    expect(rowNumbers()).toEqual([4023, 4022, 4024]);
  });

  test('pendingBallot: the deadline, then the feed order, then creation and number; never the pool', () => {
    const impact = (p: { number?: number }) => (p.number === 4022 ? 9 : 0);
    const rows = [proposal(4024, 'Turn right'), proposal(4022, 'Turn left'), proposal(4023, 'Continue forward')];
    expect(pendingBallot(rows as never, impact as never, order1).map(p => p.number)).toEqual([4023, 4022, 4024]);
    // With no feed to name an order, creation time then the number decide.
    expect(pendingBallot(rows as never, impact as never).map(p => p.number)).toEqual([4022, 4023, 4024]);
    // An earlier deadline always reads first.
    const mixed = [...minute2, ...rows];
    expect(pendingBallot(mixed as never, impact as never, { ...order1, ...order2 }).map(p => p.number)).toEqual([
      4023, 4022, 4024, 4027, 4026, 4025,
    ]);
  });
});
