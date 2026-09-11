import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';

/**
 * An option row names its options instead of Higher and Lower
 * proposal with options shows one world per option"): the row prints the
 * leader's lead prefixed with the leader's label, "open" until two options
 * are priced, the ruling band reads "Chose <label>", a manager chooses an
 * option from the row, and the form's "Options" row posts up to six labels.
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

const priced = () =>
  optionRow(
    [
      option('forward', 'Continue', 7.2, -1.7, 300),
      option('left', 'Turn left', 8.9, 1.7, 200),
      option('right', 'Turn right', 5.1, -3.8, 100),
    ],
    1.7,
  );
const onePriced = () =>
  optionRow([option('forward', 'Continue', null, null, 0), option('left', 'Turn left', 8.9, null, 200)], null);

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
    markets: [priced()],
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

const chips = (c: HTMLElement) => [...c.querySelectorAll('.pubws-optchip')] as HTMLElement[];

describe('AN OPTION ROW NAMES ITS OPTIONS INSTEAD OF HIGHER AND LOWER (docs/ui-conventions.md)', () => {
  test('an option row carries no Higher and no Lower', () => {
    renderBoard({ onTrade: () => {}, onOpenOption: () => {} });
    expect(screen.queryByRole('button', { name: /^Higher$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Lower$/ })).toBeNull();
  });

  test("one chip per option in the proposer's order, each its label and its own value, never a difference", () => {
    const { container } = renderBoard({ onTrade: () => {}, onOpenOption: () => {} });
    expect(chips(container).map(words)).toEqual(['Continue 7.2', 'Turn left 8.9', 'Turn right 5.1']);
    expect(container.querySelector('.pubws-optchips')?.textContent).not.toMatch(/[+]|-1\.7|-3\.8/);
  });

  test('an unpriced option\'s chip reads "open"', () => {
    const { container } = renderBoard({
      proposals: [proposal({ markets: [onePriced()] })],
      onTrade: () => {},
      onOpenOption: () => {},
    });
    expect(chips(container).map(words)).toEqual(['Continue open', 'Turn left 8.9', 'Turn right open']);
  });

  test("the leader's chip wears the green, and only the leader's", () => {
    const { container } = renderBoard({ onTrade: () => {}, onOpenOption: () => {} });
    expect(chips(container).map(c => c.classList.contains('is-leader'))).toEqual([false, true, false]);
  });

  test('a tie at the top has no leader, so no chip wears the green', () => {
    const tied = optionRow(
      [option('forward', 'Continue', 2, 0), option('left', 'Turn left', 2, 0), option('right', 'Turn right', 2, 0)],
      0,
    );
    const { container } = renderBoard({ proposals: [proposal({ markets: [tied] })], onOpenOption: () => {} });
    expect(chips(container).map(words)).toEqual(['Continue 2.0', 'Turn left 2.0', 'Turn right 2.0']);
    expect(chips(container).some(c => c.classList.contains('is-leader'))).toBe(false);
  });

  test('pressing a chip opens that proposal on that option', () => {
    const onOpenOption = vi.fn();
    const onSelect = vi.fn();
    const { container } = renderBoard({ onOpenOption, onSelect, onTrade: () => {} });
    fireEvent.click(chips(container)[2]);
    expect(onOpenOption).toHaveBeenCalledWith('c1', 'right');
    expect(onSelect).not.toHaveBeenCalled();
  });

  test('a two-branch row keeps Higher and Lower and has no option chips', () => {
    const plain = proposal({
      id: 'c2',
      number: 43,
      options: null,
      markets: [{ ...optionRow([], 0.4), options: null, approvedConsensus: 5.4, declinedConsensus: 5 }],
    });
    const { container } = renderBoard({ proposals: [plain], onTrade: () => {}, onOpenOption: () => {} });
    expect(screen.getByRole('button', { name: /^Higher$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Lower$/ })).toBeTruthy();
    expect(chips(container)).toHaveLength(0);
  });
});
