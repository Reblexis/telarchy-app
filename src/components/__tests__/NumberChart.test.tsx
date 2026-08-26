import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { granularityOf, NumberChart, RANGE_WORDS, windowFor } from '../NumberChart';

/**
 * The number view follows the market on screen (docs/ui-conventions.md,
 * "The price and the chart"): its window ends at the selected settle instant
 * and spans the selected horizon, and the other open markets are grey
 * context, or a chevron when they fall outside the window.
 */
const NOW = new Date('2026-08-25T18:00:00Z');
const points = [
  { at: '2026-07-27T10:00:00Z', value: 2 },
  { at: '2026-08-10T10:00:00Z', value: 4 },
  { at: '2026-08-25T10:00:00Z', value: 5 },
];

describe('the window follows the selected horizon', () => {
  test('a day market shows about two days ending at its settle instant', () => {
    const [a, b] = windowFor('2026-08-26T00:00:00Z', RANGE_WORDS.day[0].ms, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-08-23T18:00:00.000Z');
    expect(b).toBeGreaterThan(new Date('2026-08-26T00:00:00Z').getTime());
  });

  test('a far market shows the last month of readings, then the future to its settle instant', () => {
    const [a, b] = windowFor('2026-10-01T00:00:00Z', RANGE_WORDS.month[0].ms, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-07-26T18:00:00.000Z');
    expect(b).toBeGreaterThan(new Date('2026-10-01T00:00:00Z').getTime());
  });

  test('ALL starts at the first reading', () => {
    const [a] = windowFor('2026-10-01T00:00:00Z', null, points, NOW);
    expect(new Date(a).toISOString()).toBe('2026-07-27T10:00:00.000Z');
  });

  test('a market that has passed its instant still shows the window up to now', () => {
    const [, b] = windowFor('2026-08-25T00:00:00Z', RANGE_WORDS.day[0].ms, points, NOW);
    expect(b).toBeGreaterThanOrEqual(NOW.getTime());
  });

  test('granularity comes from the target date', () => {
    expect(granularityOf('2026-08-26')).toBe('day');
    expect(granularityOf('2026-W35')).toBe('week');
    expect(granularityOf('2026-09')).toBe('month');
    expect(granularityOf('2026')).toBe('other');
  });
});

describe('the markers', () => {
  const markers = [
    { marketId: 'today', resolvesOn: '2026-08-26T00:00:00Z', consensus: 6, selected: true },
    { marketId: 'week', resolvesOn: '2026-08-31T00:00:00Z', consensus: 6.5, selected: false },
    { marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 19.8, selected: false },
  ];

  test('the selected market is the labeled one; the others are grey or beyond the edge', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-08-26T00:00:00Z"
        granularity="day"
        now={NOW}
      />,
    );
    const selected = container.querySelectorAll('.nchart-marker.is-selected');
    expect(selected.length).toBe(1);
    expect(selected[0].textContent).toContain('6');
    // Week and September lie beyond a two-day window and are simply not drawn.
    expect(container.querySelectorAll('.nchart-marker').length).toBe(1);
  });

  test('with September selected the near markers are in the window, unlabeled and grey', () => {
    const sel = markers.map(m => ({ ...m, selected: m.marketId === 'sep' }));
    const { container } = render(
      <NumberChart
        points={points}
        markers={sel}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        now={NOW}
      />,
    );
    expect(container.querySelectorAll('.nchart-marker').length).toBe(3);
    expect(container.querySelectorAll('.nchart-marker text').length).toBe(1);
  });

  test("the range words are the granularity's", () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={markers}
        selectedResolvesOn="2026-08-26T00:00:00Z"
        granularity="day"
        now={NOW}
      />,
    );
    expect([...container.querySelectorAll('.mchart-range')].map(b => b.textContent)).toEqual(['2D', '1W', 'ALL']);
  });
});

describe('a metric with no reading yet', () => {
  test('says so instead of drawing a line at zero', () => {
    const { container } = render(
      <NumberChart
        points={[]}
        markers={[{ marketId: 'sep', resolvesOn: '2026-10-01T00:00:00Z', consensus: 10_000_000, selected: true }]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    expect(container.querySelector('.nchart-empty')?.textContent).toBe('no reading yet');
    expect(container.querySelector('.nchart-line')).toBeNull();
    expect(container.querySelector('.nchart-marker.is-selected')?.textContent).toContain('$10,000,000');
  });
});

describe('hover', () => {
  test('snaps to the nearest reading, so the dot is on the line and the tooltip names that reading', () => {
    const { container } = render(
      <NumberChart
        points={points}
        markers={[]}
        selectedResolvesOn="2026-10-01T00:00:00Z"
        granularity="month"
        unit="$"
        now={NOW}
      />,
    );
    const svg = container.querySelector('svg')!;
    svg.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      width: 660,
      height: 200,
      right: 660,
      bottom: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    // On the past side, between readings: the tooltip must be one of them, never an interpolation.
    // jsdom has no PointerEvent; a MouseEvent of that type reaches React's onPointerMove with coordinates.
    fireEvent(svg, new MouseEvent('pointermove', { bubbles: true, clientX: 150, clientY: 100 }));
    const tip = container.querySelector('.mchart-tip')?.textContent ?? '';
    expect(tip).toMatch(/reading \$(2|4|5)$/);
    expect(tip).toMatch(/27 Jul|10 Aug|25 Aug/);
  });
});
