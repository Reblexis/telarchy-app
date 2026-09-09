import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { TimeChart } from '../TimeChart';

/**
 * The data room's one chart (docs/data-room.md, "How the page draws things").
 *
 * Every number with a history is drawn over time by this component, so what
 * is pinned here is the promise it makes to a reader: the line follows the
 * dates, a day nobody measured is a gap rather than a straight segment across
 * it, the dated things the owner did are marked on the day they happened, and
 * the pointer always answers with the day under it.
 */
const SERIES = [
  {
    key: 'traders',
    label: 'Active traders',
    points: [
      { at: '2026-08-01', value: 0 },
      { at: '2026-08-15', value: 4 },
      { at: '2026-08-22', value: 6 },
      { at: '2026-09-01', value: 9 },
    ],
  },
];

const EVENTS = [
  { at: '2026-08-22T10:00:00.000Z', kind: 'announcement', label: 'Season 0 opened' },
  { at: '2026-09-01T10:00:00.000Z', kind: 'approved', label: 'Trader rewards' },
];

function chart(props: Partial<React.ComponentProps<typeof TimeChart>> = {}) {
  const { container } = render(<TimeChart series={SERIES} label="Active traders over time" {...props} />);
  return container;
}

describe('the line', () => {
  test('one point per reading, drawn in date order', () => {
    const c = chart({ gapDays: 30 });
    const pts = c.querySelector('.tchart-line')?.getAttribute('points') ?? '';
    const xs = pts.trim().split(/\s+/);
    expect(xs).toHaveLength(4);
    const lefts = xs.map(p => Number(p.split(',')[0]));
    expect(lefts).toEqual([...lefts].sort((a, b) => a - b));
  });

  test('a gap in the readings breaks the line rather than drawing across it', () => {
    const c = chart({
      series: [
        {
          key: 'x',
          label: 'X',
          points: [
            { at: '2026-08-01', value: 1 },
            { at: '2026-08-02', value: 2 },
            // Eleven days with no reading: not a straight segment across.
            { at: '2026-08-13', value: 3 },
          ],
        },
      ],
      gapDays: 3,
    });
    expect(c.querySelectorAll('.tchart-line')).toHaveLength(2);
  });

  test('a series with nothing in it says so instead of drawing an empty box', () => {
    const c = chart({ series: [{ key: 'x', label: 'X', points: [] }] });
    expect(c.querySelector('svg')).toBeNull();
    expect(c.textContent).toContain('Nothing recorded yet');
  });
});

describe('the axes', () => {
  test('the value axis is labelled on round numbers', () => {
    const c = chart();
    const ticks = [...c.querySelectorAll('.tchart-ylabel')].map(t => t.textContent);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    expect(ticks.every(t => /^[\d,.$kM+-]+$/.test(t ?? ''))).toBe(true);
  });

  test('the date axis names the first and last day drawn', () => {
    const c = chart();
    const xs = [...c.querySelectorAll('.tchart-xlabel')].map(t => t.textContent ?? '');
    expect(xs[0]).toContain('Aug 1');
    expect(xs[xs.length - 1]).toContain('Sep 1');
  });
});

describe('the marks', () => {
  test('an event inside the window is a numbered mark on its own day', () => {
    const c = chart({ events: EVENTS });
    expect(c.querySelectorAll('.tchart-event')).toHaveLength(2);
    expect(c.querySelector('.tchart-event-num')?.textContent).toBe('1');
  });

  test('an event outside the drawn range is not marked, because there is no line under it', () => {
    const c = chart({ events: [{ at: '2020-01-01T00:00:00Z', kind: 'announcement', label: 'Ancient' }] });
    expect(c.querySelectorAll('.tchart-event')).toHaveLength(0);
  });

  test('no events, no marks and no legend clutter', () => {
    const c = chart();
    expect(c.querySelectorAll('.tchart-event')).toHaveLength(0);
  });
});

describe('the pointer', () => {
  test('hovering names the day and the value under it', () => {
    const c = chart();
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 200 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 690, clientY: 50 });
    const tip = c.querySelector('.tchart-tip');
    expect(tip?.textContent).toContain('Sep 1');
    expect(tip?.textContent).toContain('9');
  });

  test('the day it names carries any event that happened on it', () => {
    const c = chart({ events: EVENTS });
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 200 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 690, clientY: 50 });
    expect(c.querySelector('.tchart-tip')?.textContent).toContain('Trader rewards');
  });

  test('leaving the chart takes the crosshair with it', () => {
    const c = chart();
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 200 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 50 });
    expect(c.querySelector('.tchart-tip')).toBeTruthy();
    fireEvent.pointerLeave(svg);
    expect(c.querySelector('.tchart-tip')).toBeNull();
  });
});

describe('a running total is never broken', () => {
  const SPARSE = [
    { at: '2026-08-01', value: 1 },
    { at: '2026-08-02', value: 3 },
    { at: '2026-08-20', value: 9 },
  ];

  test('a series that is defined between its points draws one line through the quiet days', () => {
    const c = chart({ series: [{ key: 'total', label: 'Accounts, running total', points: SPARSE, connect: true }] });
    expect(c.querySelectorAll('.tchart-line')).toHaveLength(1);
  });

  test('without that, a gap still breaks it: a reading is not defined between readings', () => {
    const c = chart({ series: [{ key: 'reading', label: 'Reading', points: SPARSE }] });
    expect(c.querySelectorAll('.tchart-line')).toHaveLength(2);
  });
});

describe('the value axis', () => {
  test('a range of about sixty gets more than two ticks to read against', () => {
    const c = chart({
      series: [
        {
          key: 'x',
          label: 'X',
          points: [
            { at: '2026-08-01', value: 0 },
            { at: '2026-08-02', value: 59 },
          ],
        },
      ],
    });
    expect(c.querySelectorAll('.tchart-ylabel').length).toBeGreaterThanOrEqual(3);
  });

  test('a range of about seventeen too', () => {
    const c = chart({
      series: [
        {
          key: 'x',
          label: 'X',
          points: [
            { at: '2026-08-01', value: 0 },
            { at: '2026-08-02', value: 17 },
          ],
        },
      ],
    });
    expect(c.querySelectorAll('.tchart-ylabel').length).toBeGreaterThanOrEqual(3);
  });
});

describe('a heavy tail', () => {
  const SPIKY = [
    {
      key: 'credits',
      label: 'Credits',
      points: [
        { at: '2026-08-01', value: 20 },
        { at: '2026-08-02', value: 40 },
        { at: '2026-08-03', value: 230000 },
        { at: '2026-08-04', value: 60 },
      ],
    },
  ];

  test('a log axis is labelled in powers, so the small days are readable at all', () => {
    const c = chart({ series: SPIKY, scale: 'log', gapDays: 30 });
    const ticks = [...c.querySelectorAll('.tchart-ylabel')].map(t => t.textContent);
    expect(ticks).toContain('100k');
    expect(ticks).toContain('10');
  });

  test('on a log axis the quiet days are off the floor, not flattened onto it', () => {
    const c = chart({ series: SPIKY, scale: 'log', gapDays: 30 });
    const ys = ((c.querySelector('.tchart-line')?.getAttribute('points') ?? '').trim().split(/\s+/) ?? []).map(p =>
      Number(p.split(',')[1]),
    );
    // The 20-credit day and the 40-credit day are visibly apart, which is the
    // whole reason for the axis; on a linear one they are the same pixel.
    expect(Math.abs(ys[0] - ys[1])).toBeGreaterThan(4);
  });

  test('a zero day still draws, at the bottom of the axis', () => {
    const c = chart({
      series: [
        {
          key: 'z',
          label: 'Z',
          points: [
            { at: '2026-08-01', value: 0 },
            { at: '2026-08-02', value: 100 },
          ],
        },
      ],
      scale: 'log',
    });
    expect((c.querySelector('.tchart-line')?.getAttribute('points') ?? '').trim().split(/\s+/)).toHaveLength(2);
  });
});

describe('more than one series', () => {
  const TWO = [
    SERIES[0],
    {
      key: 'verified',
      label: 'Verified',
      points: [
        { at: '2026-08-01', value: 2 },
        { at: '2026-09-01', value: 25 },
      ],
    },
  ];

  test('a legend names them, because identity is never colour alone', () => {
    const c = chart({ series: TWO });
    const legend = c.querySelector('.tchart-legend')?.textContent ?? '';
    expect(legend).toContain('Active traders');
    expect(legend).toContain('Verified');
  });

  test('one series needs no legend: the caption names it', () => {
    const c = chart();
    expect(c.querySelector('.tchart-legend')).toBeNull();
  });

  test('the pointer answers with every series at that day', () => {
    const c = chart({ series: TWO });
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 200 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 690, clientY: 50 });
    const tip = c.querySelector('.tchart-tip')?.textContent ?? '';
    expect(tip).toContain('Active traders');
    expect(tip).toContain('Verified');
  });
});
