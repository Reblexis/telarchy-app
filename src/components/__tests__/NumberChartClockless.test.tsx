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
