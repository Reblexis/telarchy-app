import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * The board opens on the live ballot (docs/ui-conventions.md, "The board
 * opens on the live ballot; decided proposals are folded away").
 *
 * Owner report 2026-09-01, on a floor with four pending proposals and seven
 * approved ones: "there are too many proposals visible". The approved ones
 * are history AND carry the largest impacts, so the impact ranking put the
 * whole archive above the fold and the four proposals a visitor could still
 * act on in the top corner.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const HORIZON = '2026-09';

/** One proposal with one priced pair on the horizon the board is reading. */
const proposal = (id: string, title: string, delta: number, status: string) =>
  ({
    id,
    title,
    description: '',
    askUsd: 10,
    proposedByName: 'Jason',
    createdAt: '2026-08-25T10:00:00Z',
    status,
    marketPairCount: 1,
    markets: [
      {
        metricId: 'rev',
        metricName: 'net revenue',
        targetDate: HORIZON,
        resolvesOn: '2026-09-01T00:00:00Z',
        approvedConsensus: 100 + delta,
        declinedConsensus: 100,
        delta,
        approvedMarketId: `${id}-a`,
        declinedMarketId: `${id}-d`,
        approvedProbability: 0.5,
        approvedLiquidity: 100,
        declinedProbability: 0.5,
        declinedLiquidity: 100,
        rangeMin: 0,
        rangeMax: 1000,
      },
    ],
  }) as never;

// The owner's own board, in miniature: the pending ones are small, the
// decided ones are the big numbers that were burying them.
const PENDING = [
  proposal('p1', 'Publish a LessWrong post', 2.5, 'pending'),
  proposal('p2', 'Add Manifold workspace', 1.5, 'pending'),
];
const DECIDED = [
  proposal('d1', 'Trade 100 credits every week', 18.9, 'approved'),
  proposal('d2', 'Ten minutes of best advice', 9.9, 'approved'),
  proposal('d3', 'A market on Manifold', 7.8, 'declined'),
];

const base = {
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
  horizonDate: HORIZON,
  horizonMetricId: 'rev',
};

function board(props: Partial<React.ComponentProps<typeof JobsBoard>> = {}) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={[...PENDING, ...DECIDED]} {...props} />
    </MemoryRouter>,
  );
}

const titles = () => screen.getAllByRole('button').map(b => b.textContent ?? '');

describe('the board opens on the live ballot', () => {
  test('the pending proposals are the list, and the decided ones are not on it', () => {
    board();
    expect(screen.getByText('Publish a LessWrong post')).toBeTruthy();
    expect(screen.getByText('Add Manifold workspace')).toBeTruthy();
    expect(screen.queryByText('Trade 100 credits every week')).toBeNull();
    expect(screen.queryByText('Ten minutes of best advice')).toBeNull();
    expect(screen.queryByText('A market on Manifold')).toBeNull();
  });

  test('one row stands for the rest, and counts what it is hiding', () => {
    board();
    expect(screen.getByText('3 decided')).toBeTruthy();
    expect(screen.getByText('Show')).toBeTruthy();
  });

  test('pressing it reveals them, still ranked by impact, and it says Hide', () => {
    board();
    fireEvent.click(screen.getByText('Show'));
    expect(screen.getByText('Trade 100 credits every week')).toBeTruthy();
    expect(screen.getByText('Hide')).toBeTruthy();
    expect(screen.queryByText('Show')).toBeNull();
    const shown = titles().filter(
      t => t.includes('credits') || t.includes('advice') || t.includes('Manifold on') || t.includes('A market'),
    );
    expect(shown[shown.length - 3]).toContain('Trade 100 credits');
    expect(shown[shown.length - 2]).toContain('Ten minutes');
    expect(shown[shown.length - 1]).toContain('A market on Manifold');
  });

  test('pressing it again folds them back away', () => {
    board();
    fireEvent.click(screen.getByText('Show'));
    fireEvent.click(screen.getByText('Hide'));
    expect(screen.queryByText('Trade 100 credits every week')).toBeNull();
    expect(screen.getByText('Show')).toBeTruthy();
  });

  test('no fold row on a board with nothing decided', () => {
    board({ proposals: PENDING });
    expect(screen.queryByText('Show')).toBeNull();
    expect(screen.queryByText(/decided/)).toBeNull();
    expect(screen.getByText('Publish a LessWrong post')).toBeTruthy();
  });

  test('a board with nothing pending has no ballot to bury: the decided ones ARE the list', () => {
    board({ proposals: DECIDED });
    expect(screen.getByText('Trade 100 credits every week')).toBeTruthy();
    expect(screen.getByText('A market on Manifold')).toBeTruthy();
    expect(screen.queryByText('Show')).toBeNull();
    expect(screen.queryByText('3 decided')).toBeNull();
  });

  test('a board with no proposals at all still shows the empty line, not a fold', () => {
    board({ proposals: [] });
    expect(screen.getByText(/Nothing on the ballot yet/)).toBeTruthy();
    expect(screen.queryByText(/decided/)).toBeNull();
  });

  test('the pending proposals keep their impact ranking', () => {
    board({
      proposals: [
        proposal('p2', 'Add Manifold workspace', 1.5, 'pending'),
        proposal('p1', 'Publish a LessWrong post', 2.5, 'pending'),
      ],
    });
    const rows = titles().filter(t => t.includes('Manifold workspace') || t.includes('LessWrong'));
    expect(rows[0]).toContain('LessWrong');
    expect(rows[1]).toContain('Manifold workspace');
  });
});

describe('the fold never hides the proposal the page is pointed at', () => {
  test('a selected decided proposal is visible on the first paint', () => {
    board({ selectedId: 'd2' });
    expect(screen.getByText('Ten minutes of best advice')).toBeTruthy();
    expect(screen.getByText('Hide')).toBeTruthy();
  });

  test('hiding while a decided proposal is selected releases the selection', () => {
    const onSelect = vi.fn();
    board({ selectedId: 'd2', onSelect });
    fireEvent.click(screen.getByText('Hide'));
    expect(onSelect).toHaveBeenCalledWith('d2');
  });

  test('hiding with a pending proposal selected leaves the selection alone', () => {
    const onSelect = vi.fn();
    board({ selectedId: 'p1', onSelect });
    fireEvent.click(screen.getByText('Show'));
    fireEvent.click(screen.getByText('Hide'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
