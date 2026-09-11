import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The deadline on a board row counts down by the second under an hour and
 * ticks (docs/ui-conventions.md, "The deadline is said ONCE"; Viktor
 * 2026-09-11 of the snake floor's static "<1h": "show it realtime up till
 * seconds"). Its hover names the instant in the viewer's zone.
 */
vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard } from '../JobsBoard';

const NOW = Date.UTC(2026, 8, 11, 10, 0, 0);

const proposal = (decideBy: string, over: Record<string, unknown> = {}) =>
  ({
    id: 'c1',
    number: 2823,
    title: 'Game 1, move 178: Turn right',
    description: '',
    askUsd: null,
    proposedByName: 'snake',
    proposedByHandle: 'snake',
    createdAt: '2026-09-11T09:59:00Z',
    decideBy,
    status: 'pending',
    marketPairCount: 1,
    markets: [],
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
  horizonDate: '2026-09-11T10:44',
  horizonMetricId: 'len',
};

function board(ps: unknown[]) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} proposals={ps as never} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the row clock under an hour', () => {
  test('reads m:ss and ticks every second', () => {
    const { container } = board([proposal(new Date(NOW + 40_000).toISOString())]);
    const clock = () => container.querySelector('.pubws-ballot-clock') as HTMLElement;
    expect(clock().textContent).toBe('0:40');
    expect(clock().className).toContain('is-urgent');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(clock().textContent).toBe('0:39');
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(clock().textContent).toBe('0:09');
  });
  test('a deadline days away keeps the day count and does not tick by the second', () => {
    const { container } = board([proposal(new Date(NOW + 5 * 24 * 3600_000).toISOString())]);
    const clock = () => container.querySelector('.pubws-ballot-clock') as HTMLElement;
    expect(clock().textContent).toBe('5d');
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(clock().textContent).toBe('5d');
  });
  test('the hover names the instant in the viewer zone, never in UTC words', () => {
    const { container } = board([proposal('2026-09-11T10:44:00Z')]);
    const title = (container.querySelector('.pubws-ballot-clock') as HTMLElement).getAttribute('title') ?? '';
    expect(title).not.toMatch(/GMT|UTC/);
    expect(title).toMatch(/decides by 11 Sep 2026, \d\d:\d\d [A-Z]/);
  });
  test('"impact by" names the cell as a local clock, not a UTC one', () => {
    const { container } = board([proposal('2026-09-11T10:44:00Z')]);
    const meta = container.querySelector('.pubws-lb-meta')?.textContent ?? '';
    expect(meta).toMatch(/^impact by \d\d:\d\d$/);
    expect(meta).not.toContain('UTC');
  });
});
