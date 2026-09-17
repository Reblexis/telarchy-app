import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { NumberChart, RANGE_WORDS, windowFor } from '../NumberChart';

/**
 * A DATE WITH NO CLOCK IS FILLED BY ITS READINGS.
 *
 * docs/ui-conventions.md, "The number chart": a book on an `until-settled`
 * date has no settle instant, so the chart has no future side at all: the
 * window ends exactly at now and begins at the first reading the range
 * holds. Owner report 2026-09-17, on the Snake floor: a few hours of
 * readings drew as a sliver at the right edge of a month-wide plot.
 */
const FAR = '9999-12-31T00:00:00.000Z';
const NOW = new Date('2026-09-17T09:30:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const month = RANGE_WORDS.month[0].ms;

const at = (msBeforeNow: number) => new Date(NOW.getTime() - msBeforeNow).toISOString();
const hours = [
  { at: at(8 * HOUR), value: 2 },
  { at: at(4 * HOUR), value: 30 },
  { at: at(1 * MIN), value: 19 },
];

describe('a date with no clock is filled by its readings', () => {
  test('the value graph was squished into a sliver (2026-09-17): a month range over eight hours of readings starts at the first reading', () => {
    const [a] = windowFor(FAR, month, hours, NOW);
    expect(a).toBe(NOW.getTime() - 8 * HOUR);
  });

  test('the window ends exactly at now: no future side, no padding', () => {
    const [, b] = windowFor(FAR, month, hours, NOW);
    expect(b).toBe(NOW.getTime());
    expect(windowFor(FAR, null, hours, NOW)[1]).toBe(NOW.getTime());
  });

  test('ALL starts at the first reading, not a day back', () => {
    expect(windowFor(FAR, null, hours, NOW)[0]).toBe(NOW.getTime() - 8 * HOUR);
  });

  test('a range still cuts readings older than itself: the range chips keep working', () => {
    const dense = Array.from({ length: 90 }, (_, i) => ({ at: at((90 - i) * DAY), value: i }));
    const [a] = windowFor(FAR, month, dense, NOW);
    expect(a).toBeGreaterThanOrEqual(NOW.getTime() - month);
    expect(a).toBeLessThan(NOW.getTime() - month + DAY);
    expect(windowFor(FAR, null, dense, NOW)[0]).toBe(NOW.getTime() - 90 * DAY);
  });

  test('the first reading INSIDE the range is the start, not an older one outside it', () => {
    const gap = [{ at: at(90 * DAY), value: 1 }, { at: at(3 * DAY), value: 5 }, ...hours];
    expect(windowFor(FAR, month, gap, NOW)[0]).toBe(NOW.getTime() - 3 * DAY);
  });

  test('no readings: the range itself, ending at now', () => {
    expect(windowFor(FAR, month, [], NOW)).toEqual([NOW.getTime() - month, NOW.getTime()]);
    expect(windowFor(FAR, null, [], NOW)).toEqual([NOW.getTime() - DAY, NOW.getTime()]);
  });

  test('a single reading seconds old still gets a window with width', () => {
    const [a, b] = windowFor(FAR, month, [{ at: at(5_000), value: 2 }], NOW);
    expect(b - a).toBeGreaterThanOrEqual(10 * MIN);
    expect(b).toBe(NOW.getTime());
  });

  test('a reading stamped after now does not push the window into the future', () => {
    const [a, b] = windowFor(FAR, month, [{ at: at(-5 * MIN), value: 2 }], NOW);
    expect(b).toBe(NOW.getTime());
    expect(a).toBeLessThan(b);
  });

  test('the literal until-settled target date, which parses as no instant, behaves the same', () => {
    expect(windowFor('until-settled', month, hours, NOW)).toEqual([NOW.getTime() - 8 * HOUR, NOW.getTime()]);
  });

  test('a dated book is untouched: it keeps its range and its future side', () => {
    const [a, b] = windowFor('2026-10-01T00:00:00Z', month, hours, NOW);
    expect(a).toBe(NOW.getTime() - month);
    expect(b).toBeGreaterThan(new Date('2026-10-01T00:00:00Z').getTime());
  });

  test('the drawn chart has no future band, and the now rule still stands', () => {
    const { container } = render(
      <NumberChart points={hours} markers={[]} selectedResolvesOn={FAR} granularity="other" unit="" now={NOW} />,
    );
    expect(container.querySelector('.nchart-future')).toBeNull();
    expect(container.querySelector('.nchart-now')).not.toBeNull();
  });
});

/**
 * THE LEGEND NAMES ONLY THE MARKS THE PLOT DRAWS (docs/ui-conventions.md,
 * "The price and the chart"). A date with no clock draws no call dot, so
 * its legend is the ink line alone (owner ask 2026-09-17).
 */
describe('the legend names only the marks the plot draws', () => {
  const chart = (resolvesOn: string, extra: Record<string, unknown> = {}) =>
    render(
      <NumberChart
        points={hours}
        markers={[]}
        selectedResolvesOn={resolvesOn}
        granularity="other"
        unit=""
        now={NOW}
        marksLegend
        {...extra}
      />,
    ).container;

  test("a date with no clock: the legend says actual and never market's call", () => {
    const legend = chart(FAR).querySelector('.nchart-legend');
    expect(legend?.textContent).toContain('actual');
    expect(legend?.textContent).not.toMatch(/market/i);
    expect(legend?.querySelector('.nchart-legend-dot')).toBeNull();
  });

  test("a dated book keeps market's call with its day", () => {
    const legend = chart('2026-10-01T00:00:00Z').querySelector('.nchart-legend');
    expect(legend?.textContent).toMatch(/market's call for 30 Sep/);
  });

  test('a proposal open on a date with no clock: its pair is not drawn, so its legend is the ink line alone too', () => {
    const legend = chart(FAR, { legend: { approved: 'if paid', declined: 'if not' } }).querySelector('.nchart-legend');
    expect(legend?.textContent).toContain('actual');
    expect(legend?.textContent).not.toMatch(/if paid|if not|market/i);
  });

  test('a proposal open on a dated book keeps its three-dot legend', () => {
    const legend = chart('2026-10-01T00:00:00Z', { legend: { approved: 'if paid', declined: 'if not' } }).querySelector(
      '.nchart-legend',
    );
    expect(legend?.textContent).toMatch(/if paid.*if not.*the market now/);
  });
});

/**
 * A DATE WITH NO CLOCK DRAWS ITS CALL AS A LEVEL ON A FUTURE SIDE THAT HAS NO
 * DATES (docs/ui-conventions.md, "The price and the chart", 2026-09-17).
 */
describe('A DATE WITH NO CLOCK DRAWS ITS CALL ON A DATELESS FUTURE SIDE', () => {
  const book = (consensus: number | null, more: Record<string, unknown> = {}) => [
    { marketId: 'attempt', resolvesOn: FAR, consensus, selected: true, ...more },
  ];
  const chart = (extra: Record<string, unknown> = {}) =>
    render(
      <NumberChart
        points={hours}
        markers={book(49.9)}
        selectedResolvesOn={FAR}
        granularity="other"
        unit=""
        now={NOW}
        marksLegend
        readingLabel
        {...extra}
      />,
    );
  const num = (el: Element | null, attr: string) => Number(el?.getAttribute(attr));

  test('the call is a line that starts at the now rule and runs right of it', () => {
    const { container } = chart();
    const line = container.querySelector('.nchart-call-line');
    const rule = container.querySelector('.nchart-now');
    expect(line).not.toBeNull();
    expect(num(line, 'x1')).toBe(num(rule, 'x1'));
    expect(num(line, 'x2')).toBeGreaterThan(num(rule, 'x1') + 90);
    expect(num(line, 'y1')).toBe(num(line, 'y2'));
  });

  test('NEVER A LINE ACROSS THE PAST: nothing of the call is left of now', () => {
    const { container } = chart();
    const nowX = num(container.querySelector('.nchart-now'), 'x1');
    for (const el of container.querySelectorAll('.nchart-call-line, .nchart-call-dot, .nchart-call-label')) {
      const xs = ['x', 'x1', 'x2', 'cx'].map(a => el.getAttribute(a)).filter(v => v !== null);
      for (const v of xs) expect(Number(v)).toBeGreaterThanOrEqual(nowX);
    }
  });

  test('the strip is tinted like a future side and captioned, with no date on it', () => {
    const { container } = chart();
    const band = container.querySelector('.nchart-future');
    expect(band).not.toBeNull();
    expect(num(band, 'x')).toBe(num(container.querySelector('.nchart-now'), 'x1'));
    expect(container.querySelector('.nchart-strip-cap')?.textContent).toBe('until it settles');
    expect(container.textContent).not.toContain('9999');
  });

  test('the time window still ends exactly at now: the strip is pixels, not time', () => {
    const { container } = chart();
    const last = [...container.querySelectorAll('.nchart-dot')].pop() as Element;
    // The newest reading is a minute old, so its dot sits just left of the rule.
    const nowX = num(container.querySelector('.nchart-now'), 'x1');
    expect(nowX - num(last, 'cx')).toBeLessThan(3);
    expect(nowX - num(last, 'cx')).toBeGreaterThanOrEqual(0);
  });

  test('the call is named inside the strip and the reading left of the rule, so they cannot collide', () => {
    const { container } = chart({ markers: book(19.4) });
    const nowX = num(container.querySelector('.nchart-now'), 'x1');
    const call = container.querySelector('.nchart-call-label') as Element;
    const reading = container.querySelector('.nchart-reading-label') as Element;
    expect(call.textContent).toBe("19.4 market's call");
    expect(num(call, 'x')).toBeGreaterThan(nowX);
    expect(call.getAttribute('text-anchor')).not.toBe('end');
    expect(num(reading, 'x')).toBeLessThan(nowX);
    expect(reading.getAttribute('text-anchor')).toBe('end');
  });

  test('the label carries the unit', () => {
    const { container } = chart({ unit: '$' });
    expect(container.querySelector('.nchart-call-label')?.textContent).toBe("$49.9 market's call");
  });

  test('THE Y AXIS ALWAYS INCLUDES THE CALL: a call far above every reading stays inside the plot', () => {
    const { container } = chart({ markers: book(400) });
    const line = container.querySelector('.nchart-call-line');
    expect(num(line, 'y1')).toBeGreaterThan(0);
    expect(num(line, 'y1')).toBeLessThan(num(container.querySelector('.nchart-now'), 'y2'));
  });

  test('the riser joins the reading to the call when they are apart, and is absent when they touch', () => {
    const apart = chart();
    expect(apart.container.querySelector('.nchart-call-gap')).not.toBeNull();
    apart.unmount();
    const touching = chart({ markers: book(19) });
    expect(touching.container.querySelector('.nchart-call-gap')).toBeNull();
  });

  test('the legend names the call line once it is drawn', () => {
    const { container } = chart();
    const legend = container.querySelector('.nchart-legend') as HTMLElement;
    expect(legend.textContent).toContain("market's call");
    expect(legend.querySelector('.nchart-legend-dash')).not.toBeNull();
    expect(legend.textContent).not.toContain('9999');
  });

  test('a bet being composed draws its ghost line in the same strip, in the side colour', () => {
    const { container } = chart({ preview: { value: 55, direction: 'higher' } });
    const ghost = container.querySelector('.mchart-ghost--higher .nchart-call-ghost');
    const nowX = num(container.querySelector('.nchart-now'), 'x1');
    expect(ghost).not.toBeNull();
    expect(num(ghost, 'x1')).toBe(nowX);
    expect(num(ghost, 'y1')).toBeLessThan(num(container.querySelector('.nchart-call-line'), 'y1'));
    expect(container.querySelector('.mchart-ghost-label')?.textContent).toBe('▲ 55');
  });

  test('a lower bet ghosts below the call', () => {
    const { container } = chart({ preview: { value: 30, direction: 'lower' } });
    const ghost = container.querySelector('.mchart-ghost--lower .nchart-call-ghost');
    expect(num(ghost, 'y1')).toBeGreaterThan(num(container.querySelector('.nchart-call-line'), 'y1'));
  });

  test('no call yet: no strip, no line, the legend is the ink line alone', () => {
    const { container } = chart({ markers: book(null) });
    expect(container.querySelector('.nchart-call-line')).toBeNull();
    expect(container.querySelector('.nchart-future')).toBeNull();
    expect(container.querySelector('.nchart-legend')?.textContent).toBe('actual');
  });

  test('a book carrying a pair draws no strip', () => {
    const { container } = chart({ markers: book(49.9, { pair: { approved: 52, declined: 48 } }) });
    expect(container.querySelector('.nchart-call-line')).toBeNull();
  });

  test('a zero call is still a call', () => {
    const { container } = chart({ markers: book(0) });
    expect(container.querySelector('.nchart-call-label')?.textContent).toBe("0 market's call");
  });

  test('no readings yet: the call is still drawn', () => {
    const { container } = chart({ points: [] });
    expect(container.querySelector('.nchart-call-line')).not.toBeNull();
    expect(container.querySelector('.nchart-call-gap')).toBeNull();
  });

  test('the now rule and the call vanished whenever the floor clock ticked (2026-09-17): a later now keeps both', () => {
    const props = {
      points: hours,
      markers: book(49.9),
      selectedResolvesOn: FAR,
      granularity: 'other' as const,
      unit: '',
      marksLegend: true,
    };
    const { container, rerender } = render(<NumberChart {...props} now={NOW} />);
    // The page hands the chart a new `now` every second; the tweened window
    // is still where the previous one ended.
    rerender(<NumberChart {...props} now={new Date(NOW.getTime() + 1000)} />);
    expect(container.querySelector('.nchart-now')).not.toBeNull();
    expect(container.querySelector('.nchart-call-line')).not.toBeNull();
    expect(container.querySelector('.nchart-future')).not.toBeNull();
  });

  test('a dated book draws none of this', () => {
    const { container } = chart({
      selectedResolvesOn: '2026-10-01T00:00:00Z',
      markers: [{ marketId: 'oct', resolvesOn: '2026-10-01T00:00:00Z', consensus: 49.9, selected: true }],
    });
    expect(container.querySelector('.nchart-call-line')).toBeNull();
    expect(container.querySelector('.nchart-strip-cap')).toBeNull();
  });
});
