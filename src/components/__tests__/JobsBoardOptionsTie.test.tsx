import { fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * A tie at the top has no leader on the board either (docs/ui-conventions.md,
 * "A proposal with options shows one world per option" and "The decision bar
 * has one button per option"): where two or more priced options share the
 * highest consensus, the row prints "tied" where it prints "<leader> +lead",
 * and a manager's Choose band keeps the proposer's order with no button green.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const option = (id: string, label: string, consensus: number | null, delta: number | null, pool = 100) => ({
  id,
  label,
  marketId: `m-${id}`,
  consensus,
  probability: consensus === null ? null : 0.5,
  liquidity: consensus === null ? 0 : 100,
  pool,
  traders: 1,
  volume: 0,
  delta,
});

const optionRow = (options: ReturnType<typeof option>[], delta: number | null) => ({
  metricId: 'len',
  metricName: 'Reached length',
  targetDate: '2026-09-11T17:30',
  resolvesOn: '2026-09-11T17:31:00Z',
  approvedConsensus: null,
  declinedConsensus: null,
  delta,
  approvedMarketId: null,
  declinedMarketId: null,
  approvedProbability: null,
  approvedLiquidity: null,
  declinedProbability: null,
  declinedLiquidity: null,
  approvedPool: null,
  declinedPool: null,
  approvedTraders: null,
  declinedTraders: null,
  approvedVolume: null,
  declinedVolume: null,
  options,
  rangeMin: 0,
  rangeMax: 144,
});

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    number: 42,
    title: 'Step 42: which way?',
    description: '',
    askUsd: 0,
    proposedByName: 'snake-operator',
    proposedByHandle: 'snake-operator',
    createdAt: '2026-09-11T16:00:00Z',
    decideBy: new Date(Date.now() + 30 * 60_000).toISOString(),
    status: 'pending',
    options: [
      { id: 'forward', label: 'Continue' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ],
    decidedOption: null,
    marketPairCount: 1,
    markets: [led()],
    ...over,
  }) as never;

const base = {
  unit: '',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Snake',
  horizonDate: '2026-09-11T17:30',
  horizonMetricId: 'len',
};

const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const renderBoard = (props: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={[proposal()]} {...(props as object)} />
    </MemoryRouter>,
  );

afterEach(() => vi.clearAllMocks());

/** Continue 7.2, Turn left 8.9 (the leader, by 1.7), Turn right 5.1. */
function led() {
  return optionRow(
    [
      option('forward', 'Continue', 7.2, -1.7),
      option('left', 'Turn left', 8.9, 1.7),
      option('right', 'Turn right', 5.1, -3.8),
    ],
    1.7,
  );
}
/** A row at these prices, each delta its gap to the best other; the row delta 0 at a tie. */
function at(fwd: number, left: number, right: number) {
  const top = Math.max(fwd, left, right);
  return optionRow(
    [
      option('forward', 'Continue', fwd, fwd - Math.max(left, right)),
      option('left', 'Turn left', left, left - Math.max(fwd, right)),
      option('right', 'Turn right', right, right - Math.max(fwd, left)),
    ],
    top - top,
  );
}
const impactOf = (c: HTMLElement) => c.querySelector('.pubws-ballot-impact') as HTMLElement;

describe('A TIE AT THE TOP HAS NO LEADER ON THE BOARD', () => {
  test('a tie at the top is not a lead: three options at one price print "tied", no label in front', () => {
    const { container } = renderBoard({ proposals: [proposal({ markets: [at(7.2, 7.2, 7.2)] })] });
    expect(words(impactOf(container))).toBe('tied');
    expect(impactOf(container).querySelector('.pubws-ballot-lead')).toBeNull();
    expect(impactOf(container).querySelector('.is-up, .is-down')).toBeNull();
  });

  test('a tie at the top is not a lead: two sharing the top above a third print "tied"', () => {
    const { container } = renderBoard({ proposals: [proposal({ markets: [at(8.9, 8.9, 5.1)] })] });
    expect(words(impactOf(container))).toBe('tied');
  });

  test('a tie at the top is not a lead: float noise between the top two is still "tied"', () => {
    const { container } = renderBoard({ proposals: [proposal({ markets: [at(5.1, 8.9, 8.9 + 1e-12)] })] });
    expect(words(impactOf(container))).toBe('tied');
  });

  test('a clear leader still prints "<leader> +lead"', () => {
    const { container } = renderBoard();
    expect(words(impactOf(container))).toBe('Turn left +1.7');
  });

  test("a tie at the top has no leader, so no Choose button is green and they keep the proposer's order", () => {
    const { container } = renderBoard({
      proposals: [proposal({ markets: [at(5.1, 8.9, 8.9)] })],
      canManage: true,
      onRule: vi.fn(),
    });
    const acts = container.querySelector('.pubws-prow-acts') as HTMLElement;
    fireEvent.click(within(acts).getByRole('button', { name: 'Choose' }));
    const band = container.querySelector('.pubws-rule') as HTMLElement;
    expect([...band.querySelectorAll('button')].map(words)).toEqual([
      'Choose Continue',
      'Choose Turn left',
      'Choose Turn right',
      'Cancel',
    ]);
    expect(band.querySelectorAll('.pubws-decide--approve')).toHaveLength(0);
  });
});
