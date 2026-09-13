import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * The title owns the proposal row's first line (docs/ui-conventions.md, "The
 * proposals board", "The row is two lines, and only one of them is loud";
 * record notes/decisions/ui-conventions.md, revised 2026-09-13).
 *
 * Every control on the row used to share the title's line, so a manager
 * looking at a snake proposal got Choose, Decline and three option chips at
 * their natural width and the title was left about 40px: "6..." ("why sis
 * this still so clipped", Viktor, 2026-09-13). The first line now holds the
 * title and the impact only; the facts and every control share the second.
 * jsdom has no layout, so the widths are read from the stylesheet and the
 * lines from the markup.
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

const option = (id: string, label: string, consensus: number, delta: number, pool: number) => ({
  id,
  label,
  marketId: `m-${id}`,
  consensus,
  probability: 0.5,
  liquidity: 100,
  pool,
  traders: 1,
  volume: 0,
  delta,
});

const plain = (over: Record<string, unknown> = {}) =>
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

const snakeStep = (over: Record<string, unknown> = {}) =>
  ({
    id: 's1',
    number: 69,
    title: 'Game 3, attempt 3, move 74',
    description: '',
    askUsd: 0,
    proposedByName: 'snake',
    proposedByHandle: 'snake',
    createdAt: '2026-09-13T15:06:00Z',
    decideBy: new Date(Date.now() + 60_000).toISOString(),
    status: 'pending',
    options: [
      { id: 'forward', label: 'Continue forward' },
      { id: 'left', label: 'Turn left' },
      { id: 'right', label: 'Turn right' },
    ],
    decidedOption: null,
    marketPairCount: 1,
    markets: [
      pair({
        metricId: 'len',
        targetDate: '2026-09-13T17:07',
        delta: 0.1,
        approvedConsensus: null,
        declinedConsensus: null,
        options: [
          option('forward', 'Continue forward', 18.1, 0.1, 1_100),
          option('left', 'Turn left', 14.0, -4.0, 1_000),
          option('right', 'Turn right', 18.0, -0.1, 1_086),
        ],
        rangeMax: 64,
      }),
    ],
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
};

function row(props: Record<string, unknown>, p: never) {
  const { container } = render(
    <MemoryRouter>
      <JobsBoard {...base} {...props} proposals={[p]} />
    </MemoryRouter>,
  );
  return container.querySelector('.pubws-prow') as HTMLElement;
}

const words = (el: Element | null) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const lineOf = (r: HTMLElement, n: 1 | 2) =>
  r.querySelector(n === 1 ? ':scope > .pubws-prow-top' : ':scope > .pubws-prow-bottom') as HTMLElement | null;

describe('THE TITLE OWNS THE FIRST LINE: nothing but the impact shares it', () => {
  const cases: Array<[string, Record<string, unknown>, () => never]> = [
    [
      'a manager on a snake step (Choose, Decline, three options)',
      {
        canManage: true,
        onRule: vi.fn(),
        onOpenOption: vi.fn(),
        horizonDate: '2026-09-13T17:07',
        horizonMetricId: 'len',
      },
      snakeStep,
    ],
    [
      'a visitor on a snake step (three options)',
      { onOpenOption: vi.fn(), horizonDate: '2026-09-13T17:07', horizonMetricId: 'len' },
      snakeStep,
    ],
    [
      'a manager on a two-branch proposal (Approve, Decline, Higher, Lower)',
      { canManage: true, onRule: vi.fn(), onTrade: vi.fn(), horizonDate: '2026-12', horizonMetricId: 'rev' },
      plain,
    ],
    [
      'a trader on a two-branch proposal (Higher, Lower)',
      { onTrade: vi.fn(), horizonDate: '2026-12', horizonMetricId: 'rev' },
      plain,
    ],
  ];

  test.each(cases)('%s: the first line is the title and the impact, and no control', (_name, props, make) => {
    const r = row(props, make());
    const top = lineOf(r, 1);
    expect(top).toBeTruthy();
    expect(top!.querySelector('.pubws-ballot-title')).toBeTruthy();
    expect(top!.querySelector('.pubws-prow-impact')).toBeTruthy();
    // The one button on the first line is the title itself, which opens the proposal.
    const buttons = [...top!.querySelectorAll('button')];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].classList.contains('pubws-ballot-row')).toBe(true);
    expect(top!.querySelector('.pubws-prow-acts')).toBeNull();
    expect(top!.querySelector('.pubws-prow-meta')).toBeNull();
  });

  test.each(cases)('%s: the facts and every control are on the second line', (_name, props, make) => {
    const r = row(props, make());
    const bottom = lineOf(r, 2);
    expect(bottom).toBeTruthy();
    expect(bottom!.querySelector('.pubws-prow-meta')).toBeTruthy();
    const all = [...r.querySelectorAll('.pubws-prow-acts button')];
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const b of all) expect(bottom!.contains(b)).toBe(true);
    // Nothing loose on the row outside its two lines.
    expect([...r.children].map(c => c.className)).toEqual(['pubws-prow-top', 'pubws-prow-bottom']);
  });

  test('the snake step a manager sees carries all five controls on the second line, in order', () => {
    const r = row(
      {
        canManage: true,
        onRule: vi.fn(),
        onOpenOption: vi.fn(),
        horizonDate: '2026-09-13T17:07',
        horizonMetricId: 'len',
      },
      snakeStep(),
    );
    const names = [...lineOf(r, 2)!.querySelectorAll('button')].map(words);
    expect(names).toEqual(['Choose', 'Decline', 'Continue forward 18.1', 'Turn left 14.0', 'Turn right 18.0']);
    // The whole title is on the first line, and the leader's lead beside it.
    expect(words(lineOf(r, 1)!.querySelector('.pubws-ballot-title'))).toBe('#69Game 3, attempt 3, move 74');
    expect(words(lineOf(r, 1)!.querySelector('.pubws-prow-impact'))).toBe('Continue forward +0.1');
  });

  test('a decided proposal keeps the two lines, with only the facts on the second', () => {
    const r = row(
      { onTrade: vi.fn(), horizonDate: '2026-12', horizonMetricId: 'rev' },
      plain({ status: 'approved', resolvedAt: '2026-09-05' }),
    );
    expect(lineOf(r, 1)!.querySelector('.pubws-ballot-title')).toBeTruthy();
    expect(lineOf(r, 2)!.querySelector('.pubws-prow-meta')).toBeTruthy();
    expect(r.querySelector('.pubws-prow-acts')).toBeNull();
  });

  test('the title still opens the proposal, and a control on the second line does not', () => {
    const onSelect = vi.fn();
    const onOpenOption = vi.fn();
    const r = row({ onSelect, onOpenOption, horizonDate: '2026-09-13T17:07', horizonMetricId: 'len' }, snakeStep());
    fireEvent.click(within(lineOf(r, 2)!).getByRole('button', { name: /Turn left/ }));
    expect(onOpenOption).toHaveBeenCalledWith('s1', 'left');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(lineOf(r, 1)!.querySelector('.pubws-ballot-row') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith('s1');
  });
});

describe('THE CONTROLS NEVER TAKE WIDTH FROM THE TITLE (the stylesheet)', () => {
  const CSS = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
  /** The declarations of every top-level rule whose selector is exactly `sel`. */
  const rule = (sel: string) =>
    [...CSS.matchAll(new RegExp(`(^|\\})\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'gm'))]
      .map(m => m[2])
      .join('\n');

  test('the row stacks its two lines', () => {
    expect(rule('.pubws-prow')).toMatch(/flex-direction:\s*column/);
  });

  test('on the first line the title takes the room and may shrink; the impact never wraps', () => {
    expect(rule('.pubws-prow-top')).toMatch(/display:\s*flex/);
    const title = rule('.pubws-prow-top .pubws-ballot-row');
    expect(title).toMatch(/flex:\s*1/);
    expect(title).toMatch(/min-width:\s*0/);
    expect(rule('.pubws-prow-impact')).toMatch(/flex:\s*none/);
    expect(rule('.pubws-prow-impact')).toMatch(/white-space:\s*nowrap/);
    // The leader's label and its lead read as one phrase on one baseline,
    // "Continue forward +1.6", never the label stacked over the number (the
    // older .pubws-ballot-impact rule is a column; production showed it
    // stacked on the snake row, 2026-09-13).
    expect(rule('.pubws-prow-impact')).toMatch(/flex-direction:\s*row/);
  });

  test('on the second line the controls wrap under the facts, right-aligned', () => {
    const bottom = rule('.pubws-prow-bottom');
    expect(bottom).toMatch(/display:\s*flex/);
    expect(bottom).toMatch(/flex-wrap:\s*wrap/);
    const controls = rule('.pubws-prow-controls');
    expect(controls).toMatch(/margin-left:\s*auto/);
    expect(controls).toMatch(/flex-wrap:\s*wrap/);
    expect(controls).toMatch(/justify-content:\s*flex-end/);
  });
});
