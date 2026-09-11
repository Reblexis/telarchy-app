import { describe, expect, test } from 'vitest';
import { pendingBallot } from '../JobsBoard';

/**
 * Pending rows keep a stable order (docs/ui-conventions.md, "The feed drives
 * the floor", 2026-09-11): deadline, then pool, then number, so three
 * proposals posted together do not swap places under the pointer as their
 * prices refresh.
 */
const row = (number: number, delta: number) =>
  ({
    id: `p${number}`,
    number,
    title: `move ${number}`,
    status: 'pending',
    decideBy: '2026-09-11T16:31:00Z',
    markets: [{ metricId: 'len', targetDate: '2026-09-11T17:30', delta, approvedPool: 1000, declinedPool: 1000 }],
  }) as never;

describe('pending rows keep a stable order', () => {
  test('same deadline and pool: by number, ascending, whatever the impacts do', () => {
    const impact = () => 0;
    const a = pendingBallot([row(123, 0.1), row(121, 0.4), row(122, -0.2)], impact).map(p => p.number);
    expect(a).toEqual([121, 122, 123]);
    const b = pendingBallot([row(122, 0.9), row(123, 0.9), row(121, 0.9)], impact).map(p => p.number);
    expect(b).toEqual([121, 122, 123]);
  });
});
