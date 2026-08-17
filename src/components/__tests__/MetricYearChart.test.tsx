import { describe, it, expect } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
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

describe('an axis bound has to be plausible', () => {
  it('ignores an epoch period start instead of drawing 56 years', () => {
    // periodStartInstant returns the epoch for a target date it does not
    // recognise, on purpose: it is a safe floor for a FILTER and a terrible
    // axis, squashing every reading into the last pixel.
    const { container } = render(
      <MetricYearChart {...WEEK} periodStart="1970-01-01T00:00:00.000Z" unit="$" />,
    );
    expect(lineXs(container)[0]).toBeCloseTo(PAD_L, 1);
    const labels = xLabels(container);
    expect(labels.length).toBeLessThan(12);
    expect(labels[0]).toMatch(/Aug/);
  });

  it('ignores a period start absurdly far before the data', () => {
    const { container } = render(
      <MetricYearChart {...WEEK} periodStart="2019-01-01T00:00:00.000Z" unit="$" />,
    );
    expect(lineXs(container)[0]).toBeCloseTo(PAD_L, 1);
  });
});

describe('the crosshair over a stretch with no readings', () => {
  const withRect = (fn: () => void) => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: W, height: 260, right: W, bottom: 260, x: 0, y: 0, toJSON: () => ({}) };
    } as typeof original;
    try { fn(); } finally { Element.prototype.getBoundingClientRect = original; }
  };

  it('says there is no reading yet instead of quoting the first one', () => {
    // Opening the axis on the period start made Monday-to-Friday hoverable on
    // a chart whose first reading is Saturday. Reporting $887 as the "actual"
    // for a Monday, on a metric that resets each Monday, is a made-up number.
    withRect(() => {
      const { container } = render(<MetricYearChart {...WEEK} unit="$" />);
      const svg = container.querySelector('svg')!;
      fireEvent.pointerMove(svg, { clientX: PAD_L + 5 });
      const tip = container.querySelector('.mchart-tip')!;
      expect(tip.textContent).toContain('no reading yet');
      expect(tip.textContent).not.toContain('887');
      expect(container.querySelector('.mchart-cross-mkt')).toBeNull();
    });
  });

  it('still reports the actual where there is data', () => {
    withRect(() => {
      const { container } = render(<MetricYearChart {...WEEK} unit="$" />);
      const svg = container.querySelector('svg')!;
      fireEvent.pointerMove(svg, { clientX: W - PAD_R - 12 });
      const tip = container.querySelector('.mchart-tip')!;
      expect(tip.textContent).not.toContain('no reading yet');
      expect(container.querySelector('.mchart-cross-mkt')).toBeTruthy();
    });
  });
});

describe('a period with nothing measured yet', () => {
  const EMPTY = {
    history: [],
    forecastValue: 1176,
    forecastAt: '2026-08-24T00:00:00Z',
    periodStart: '2026-08-17T00:00:00.000Z',
  };

  it('draws the week and the call, and no invented actual line', () => {
    // A metric that restarts each Monday has nothing measured on Monday
    // morning. It used to draw last period's total here (owner report
    // 2026-08-17); the honest chart has an axis, a forecast, and no line.
    const { container } = render(<MetricYearChart {...EMPTY} unit="$" />);
    expect(container.querySelector('.mchart-mline')).toBeNull();
    expect(container.querySelector('.mchart-fill-area')).toBeNull();
    expect(container.querySelector('.myear-nowdot')).toBeNull();
    // The call is still there, at the settle date.
    expect(container.querySelector('.mchart-calldot')).toBeTruthy();
    expect(container.querySelector('.mchart-calllabel')!.textContent).toBe('$1,176');
    // And the axis is the whole week.
    const labels = xLabels(container);
    expect(labels[0]).toBe('Aug 17');
    expect(labels).toContain('Aug 24');
  });

  it('reports no reading anywhere in the empty period', () => {
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      return { left: 0, top: 0, width: W, height: 260, right: W, bottom: 260, x: 0, y: 0, toJSON: () => ({}) };
    } as typeof original;
    try {
      const { container } = render(<MetricYearChart {...EMPTY} unit="$" />);
      fireEvent.pointerMove(container.querySelector('svg')!, { clientX: W / 2 });
      expect(container.querySelector('.mchart-tip')!.textContent).toContain('no reading yet');
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it('renders nothing at all when there is neither a reading nor a period', () => {
    const { container } = render(
      <MetricYearChart history={[]} forecastValue={1176} forecastAt="2026-08-24T00:00:00Z" unit="$" />,
    );
    expect(container.querySelector('svg')).toBeNull();
  });
});

/**
 * The event marker. It exists so a year of trajectory can say what changed and
 * when, and the rule that matters is the one that keeps it honest: a marker
 * outside the drawn domain is not drawn at all, rather than clamped to an edge
 * where it would assert the event happened at the start of a window it
 * actually predates.
 */
const YEAR = {
  history: [
    { at: '2026-01-01T00:00:00Z', value: 137 },
    { at: '2026-06-01T00:00:00Z', value: 30000 },
    { at: '2026-08-17T00:00:00Z', value: 45783 },
  ],
  forecastValue: 78570,
  forecastAt: '2026-12-31T23:59:59Z',
  periodStart: '2026-01-01T00:00:00Z',
};
const marker = { at: '2026-08-13T00:00:00Z', label: 'Started using Telarchy' };

describe('the event marker', () => {
  it('draws a labelled line inside the domain, at the right fraction of it', () => {
    const { container } = render(<MetricYearChart {...YEAR} marker={marker} unit="$" />);
    const line = container.querySelector('.myear-marker line');
    expect(line).toBeTruthy();
    expect(container.querySelector('.myear-marker text')?.textContent).toBe('Started using Telarchy');

    // 13 Aug is 224 days into a 1 Jan -> 31 Dec domain of 365 days, so the
    // line sits at PAD_L + 224/365 of the plot width. Derived from the domain,
    // not copied from a run, so a domain change fails this rather than
    // silently moving the line.
    const span = new Date(YEAR.forecastAt).getTime() - new Date('2026-01-01T00:00:00Z').getTime();
    const into = new Date(marker.at).getTime() - new Date('2026-01-01T00:00:00Z').getTime();
    const expected = PAD_L + (into / span) * (W - PAD_L - PAD_R);
    expect(parseFloat(line!.getAttribute('x1')!)).toBeCloseTo(expected, 0);
  });

  it('says nothing on a chart whose period predates the event', () => {
    // The weekly horizon: 10-16 August. An August-13 marker is inside THAT
    // week, so use a week that ended before it to pin the exclusion.
    const earlierWeek = {
      ...WEEK,
      history: [{ at: '2026-08-01T10:00:00Z', value: 500 }],
      forecastAt: '2026-08-03T00:00:00Z',
      periodStart: '2026-07-27T00:00:00Z',
    };
    const { container } = render(<MetricYearChart {...earlierWeek} marker={marker} unit="$" />);
    expect(container.querySelector('.myear-marker')).toBeNull();
  });

  it('is absent when the owner never named a date', () => {
    const { container } = render(<MetricYearChart {...YEAR} unit="$" />);
    expect(container.querySelector('.myear-marker')).toBeNull();
  });
});
