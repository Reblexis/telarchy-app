import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { MetricYearChart } from '../MetricYearChart';

/**
 * What the x-axis covers.
 *
 * The chart opened at its first reading, which is right for a metric that has
 * been accumulating all year and wrong for one that resets every Monday: the
 * LookPilot weekly floor drew a week-long market across the day and a half of
 * readings it happened to have, so the week looked like it had just started
 * (owner report 2026-08-16, "the whole week should be on X axis").
 *
 * Wide geometry, because jsdom reports innerWidth 1024.
 */
const W = 720, PAD_L = 46, PAD_R = 58;
const RIGHT_EDGE = W - PAD_R;

const xLabels = (c: HTMLElement) =>
  [...c.querySelectorAll('.mchart-xlabel')].map(n => n.textContent ?? '');
const lineXs = (c: HTMLElement) =>
  [...(c.querySelector('.mchart-mline')?.getAttribute('d') ?? '').matchAll(/[ML]([\d.]+),/g)]
    .map(m => parseFloat(m[1]));

// A week-long market: ISO week 33 of 2026, Monday 10 August to Sunday the 16th,
// with readings only from the Saturday on.
const WEEK = {
  history: [
    { at: '2026-08-15T20:42:51Z', value: 887.29 },
    { at: '2026-08-15T23:31:24Z', value: 887.29 },
    { at: '2026-08-16T10:02:09Z', value: 1179.72 },
  ],
  forecastValue: 1179.72,
  forecastAt: '2026-08-17T00:00:00Z',
  periodStart: '2026-08-10T00:00:00Z',
};

describe('the x-axis spans the period being settled on', () => {
  it('opens the week on its Monday, not on the first reading', () => {
    const { container } = render(<MetricYearChart {...WEEK} unit="$" />);
    // Monday is the left edge, so Saturday's first reading sits well inside
    // the canvas rather than on it. Five of seven days precede it.
    const xs = lineXs(container);
    const firstReading = xs[0];
    const usable = RIGHT_EDGE - PAD_L;
    expect(firstReading).toBeGreaterThan(PAD_L + usable * 0.6);
    expect(firstReading).toBeLessThan(RIGHT_EDGE);
  });

  it('without a period start, it still opens at the first reading', () => {
    const { periodStart: _unused, ...noPeriod } = WEEK;
    const { container } = render(<MetricYearChart {...noPeriod} unit="$" />);
    expect(lineXs(container)[0]).toBeCloseTo(PAD_L, 1);
  });

  it('labels a week in days, since "Aug" three times is not an axis', () => {
    const { container } = render(<MetricYearChart {...WEEK} unit="$" />);
    const labels = xLabels(container);
    expect(labels.length).toBeGreaterThanOrEqual(5);
    expect(labels.every(l => /^[A-Z][a-z]{2} \d{1,2}$/.test(l))).toBe(true);
    expect(labels[0]).toBe('Aug 10');
    expect(labels).toContain('Aug 16');
  });

  it('never drops a reading that predates the period: the year keeps January', () => {
    // The cumulative case. "LookPilot net 2026" accumulates all year while its
    // market targets 2026-12, so the period starts in December and every
    // reading is older than it. Filtering on the period emptied both charts
    // off the floor once already; opening the axis must not repeat it.
    const history = [
      { at: '2026-01-04T12:00:00Z', value: 1200 },
      { at: '2026-05-01T12:00:00Z', value: 30_000 },
      { at: '2026-08-16T10:00:00Z', value: 45_339 },
    ];
    const { container } = render(
      <MetricYearChart
        history={history}
        forecastValue={78_571}
        forecastAt="2027-01-01T00:00:00Z"
        periodStart="2026-12-01T00:00:00Z"
        unit="$"
      />,
    );
    expect(lineXs(container)).toHaveLength(3);
    expect(lineXs(container)[0]).toBeCloseTo(PAD_L, 1);
    // A year still gets month labels, not 365 day labels.
    const labels = xLabels(container);
    expect(labels).toContain('Feb');
    expect(labels.every(l => /^[A-Z][a-z]{2}$/.test(l))).toBe(true);
  });
});
