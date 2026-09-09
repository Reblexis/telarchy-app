import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * The board, ordered by what needs a ruling first and ruled on from the row
 * (docs/ui-conventions.md, "The proposals board", revised 2026-09-09; record
 * notes/decisions/ui-conventions.md).
 *
 * Four pending proposals is a morning's work, not four page loads. The order
 * answers the question a reader has, which is which of these needs me, not
 * which is deepest.
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const pair = (over: Record<string, unknown> = {}) => ({
  metricId: 'rev',
  metricName: 'Net revenue (USD)',
  targetDate: '2026-12',
  resolvesOn: '2026-12-31T00:00:00Z',
  approvedConsensus: 5_100,
  declinedConsensus: 5_000,
  delta: 100,
  approvedMarketId: 'm-a',
  declinedMarketId: 'm-d',
  approvedProbability: 0.5,
  approvedLiquidity: 100,
  declinedProbability: 0.5,
  declinedLiquidity: 100,
  approvedPool: 1_500,
  declinedPool: 1_500,
  approvedTraders: 1,
  declinedTraders: 0,
  approvedVolume: 0,
  declinedVolume: 0,
  rangeMin: 0,
  rangeMax: 25_000,
  ...over,
});

const proposal = (over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    number: 7,
    title: 'Open source a trading agent',
    description: '',
    askUsd: 80,
    proposedByName: 'Jason',
    proposedByHandle: 'jason-handle',
    createdAt: '2026-09-01T10:00:00Z',
    decideBy: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(),
    status: 'pending',
    marketPairCount: 1,
    markets: [pair()],
    ...over,
  }) as never;

const base = {
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
  horizonDate: '2026-12',
  horizonMetricId: 'rev',
};

const DAY = 24 * 60 * 60 * 1000;
const inDays = (n: number) => new Date(Date.now() + n * DAY).toISOString();

const p = (id: string, over: Record<string, unknown> = {}) =>
  proposal({ id, number: Number(id.replace(/\D/g, '')) || 1, ...over });

function ruleBoard(props: Record<string, unknown> = {}, ps = [p('c1')]) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} canManage onRule={async () => {}} {...props} proposals={ps} />
    </MemoryRouter>,
  );
}

describe('the board says what is on it before a row is read', () => {
  test('one line: how many are open, how many decide today, and that anyone can post', () => {
    const { container } = ruleBoard({}, [
      p('c1', { decideBy: inDays(0.4) }),
      p('c2', { decideBy: inDays(4) }),
      p('c3', { decideBy: inDays(5) }),
    ]);
    const line = container.querySelector('.pubws-propsum') as HTMLElement;
    expect(line.textContent).toContain('3 proposals open');
    expect(line.textContent).toContain('1 decides today');
    expect(line.textContent).toContain('anyone can post one');
  });

  test('nothing decides today, nothing says it does', () => {
    const { container } = ruleBoard({}, [p('c1', { decideBy: inDays(4) })]);
    expect(container.querySelector('.pubws-propsum')?.textContent).not.toMatch(/today/);
  });

  test('an empty ballot has no summary line to draw', () => {
    const { container } = ruleBoard({}, []);
    expect(container.querySelector('.pubws-propsum')).toBeNull();
  });
});

describe('the board is ordered by what needs a ruling first', () => {
  test('soonest decision leads, and the pool breaks a tie', () => {
    // The same instant, not "the same day": two proposals closing together
    // are what the pool is there to separate.
    const far = inDays(6);
    const { container } = ruleBoard({}, [
      p('c1', {
        title: 'Deep and far',
        decideBy: far,
        markets: [pair({ approvedPool: 20_000, declinedPool: 20_000 })],
      }),
      p('c2', {
        title: 'Thin and soon',
        decideBy: inDays(1),
        markets: [pair({ approvedPool: 100, declinedPool: 100 })],
      }),
      p('c3', {
        title: 'Also far but deeper',
        decideBy: far,
        markets: [pair({ approvedPool: 40_000, declinedPool: 40_000 })],
      }),
    ]);
    const titles = [...container.querySelectorAll('.pubws-ballot-title')].map(t => t.textContent ?? '');
    expect(titles.map(t => t.replace(/^#\d+/, '').trim())).toEqual([
      'Thin and soon',
      'Also far but deeper',
      'Deep and far',
    ]);
  });

  test('a proposal with no deadline sorts last, not first', () => {
    const { container } = ruleBoard({}, [
      p('c1', { title: 'No deadline', decideBy: null }),
      p('c2', { title: 'Next week', decideBy: inDays(6) }),
    ]);
    const titles = [...container.querySelectorAll('.pubws-ballot-title')].map(t => t.textContent ?? '');
    expect(titles[0]).toContain('Next week');
  });

  test('five rows, then a line for the rest', () => {
    const many = Array.from({ length: 8 }, (_, i) => p(`c${i + 1}`, { decideBy: inDays(i + 1) }));
    const { container } = ruleBoard({}, many);
    expect(container.querySelectorAll('.pubws-prow')).toHaveLength(5);
    const more = container.querySelector('.pubws-ballot-all') as HTMLElement;
    expect(more.textContent).toContain('3 more');
    fireEvent.click(more);
    expect(container.querySelectorAll('.pubws-prow')).toHaveLength(8);
  });
});

describe('a manager rules from the row', () => {
  test('Approve asks for a confirm on the row, naming the money', () => {
    const ruled: unknown[] = [];
    const { container } = ruleBoard({ onRule: (...a: unknown[]) => ruled.push(a) });
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    // A list is a place to mis-click, so the money is confirmed in place.
    expect(ruled).toHaveLength(0);
    const confirm = container.querySelector('.pubws-rule') as HTMLElement;
    expect(confirm.textContent).toContain('$80');
    fireEvent.click(within(confirm).getByRole('button', { name: /Approve and pay/ }));
    expect(ruled).toEqual([['c1', 'approve', undefined]]);
  });

  test('Decline opens its published reason on the row, and will not confirm until it is typed', () => {
    const ruled: unknown[] = [];
    const { container } = ruleBoard({ onRule: (...a: unknown[]) => ruled.push(a) });
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    const confirm = container.querySelector('.pubws-rule') as HTMLElement;
    const go = within(confirm).getByRole('button', { name: /Decline and publish/ }) as HTMLButtonElement;
    expect(go.disabled).toBe(true);
    fireEvent.change(within(confirm).getByRole('textbox'), { target: { value: 'Covered already.' } });
    expect(go.disabled).toBe(false);
    fireEvent.click(go);
    expect(ruled).toEqual([['c1', 'decline', 'Covered already.']]);
  });

  test('Cancel leaves the row as it was', () => {
    const { container } = ruleBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.click(
      within(container.querySelector('.pubws-rule') as HTMLElement).getByRole('button', { name: 'Cancel' }),
    );
    expect(container.querySelector('.pubws-rule')).toBeNull();
  });

  test('a visitor is offered no ruling at all', () => {
    const { container } = ruleBoard({ canManage: false, onRule: undefined });
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
    expect(container.querySelector('.pubws-rule')).toBeNull();
  });

  test('the selected row shows no ruling: its own band is on screen', () => {
    const { container } = ruleBoard({ selectedId: 'c1' });
    expect(container.querySelector('.pubws-prow-acts .pubws-dir--approve')).toBeNull();
  });

  test('a decided proposal is not ruled on again', () => {
    ruleBoard({}, [p('c1', { status: 'approved', resolvedAt: '2026-09-05' })]);
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });
});
