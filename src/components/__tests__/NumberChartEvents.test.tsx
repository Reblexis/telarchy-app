import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { NumberChart } from '../NumberChart';

/**
 * The events on the number chart (docs/ui-conventions.md, "The price and the
 * chart"): the dated things the owner did, marked against the line they
 * moved.
 *
 * A jump on a particular day had a cause; the cause was in the database with
 * a date on it and the chart said nothing. What is pinned here is that a mark
 * only appears where a reader can see the line under it: inside the window,
 * on the past side, numbered so the list beneath can be read against it.
 */
const NOW = new Date('2026-09-09T12:00:00.000Z');

const points = [
  { at: '2026-08-01T00:00:00.000Z', value: 0 },
  { at: '2026-08-22T00:00:00.000Z', value: 4 },
  { at: '2026-09-08T00:00:00.000Z', value: 9 },
];

const base = {
  points,
  markers: [],
  selectedResolvesOn: '2026-09-30T00:00:00.000Z',
  granularity: 'month' as const,
  now: NOW,
};

function chart(events?: Array<{ at: string; kind: string; label: string }>) {
  const { container } = render(<NumberChart {...base} events={events as never} />);
  return container;
}

describe('the marks', () => {
  test('an event inside the window is a numbered mark', () => {
    const c = chart([{ at: '2026-08-22T00:00:00.000Z', kind: 'announcement', label: 'Season 0 opened' }]);
    expect(c.querySelectorAll('.numchart-event')).toHaveLength(1);
    expect(c.querySelector('.numchart-event-num')?.textContent).toBe('1');
  });

  test('an event before the window has no line under it and is not drawn', () => {
    const c = chart([{ at: '2020-01-01T00:00:00.000Z', kind: 'announcement', label: 'Ancient' }]);
    expect(c.querySelectorAll('.numchart-event')).toHaveLength(0);
  });

  test('an event in the future is not something that moved the line', () => {
    const c = chart([{ at: '2026-09-20T00:00:00.000Z', kind: 'approved', label: 'Not yet' }]);
    expect(c.querySelectorAll('.numchart-event')).toHaveLength(0);
  });

  test('the numbers run oldest to newest, so the list beneath can be read against them', () => {
    const c = chart([
      { at: '2026-09-04T00:00:00.000Z', kind: 'approved', label: 'Newer' },
      { at: '2026-08-22T00:00:00.000Z', kind: 'announcement', label: 'Older' },
    ]);
    const nums = [...c.querySelectorAll('.numchart-event-num')].map(n => n.textContent);
    expect(nums).toEqual(['1', '2']);
    const titles = [...c.querySelectorAll('.numchart-event title')].map(t => t.textContent);
    expect(titles[0]).toContain('Older');
  });

  test('a chart with no events is the chart it always was', () => {
    expect(chart().querySelectorAll('.numchart-event')).toHaveLength(0);
    expect(chart([]).querySelectorAll('.numchart-event')).toHaveLength(0);
  });
});
