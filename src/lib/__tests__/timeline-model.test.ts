import { describe, expect, test } from 'vitest';
import { endMeta, layout, type TimelineItem, ticksFor, windowFor } from '../timeline-model';

/**
 * The pure geometry behind "What is planned" (docs/owner-on-the-floor.md,
 * "What is planned", "The axis"; docs/ui-conventions.md, the FloorTimeline
 * paragraph). One row per item, soonest end on top, a bar on a shared axis
 * under each title; no lanes and no label measurement, because the column
 * is 280px and a label next to its bar is a label that gets cut.
 */

const DAY = 864e5;
/** A Thursday, 10:00 local. Built by parts so the tests hold in any zone. */
const NOW = new Date(2026, 8, 11, 10, 0, 0, 0);
const iso = (d: Date | number) => new Date(d).toISOString();
const at = (offsetMs: number) => iso(NOW.getTime() + offsetMs);

const item = (over: Partial<TimelineItem> & { id: string }): TimelineItem => ({
  kind: 'plan',
  title: `Item ${over.id}`,
  start: null,
  end: null,
  href: null,
  ...over,
});

/** The same formatter the model uses, so the tests pin the naming rule and
 *  not ICU's spelling of September. */
const dayMonth = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

describe('the range windows', () => {
  test('today is the local day, midnight to midnight', () => {
    const w = windowFor('today', NOW);
    expect(new Date(w.from).getHours()).toBe(0);
    expect(new Date(w.from).getDate()).toBe(11);
    expect(w.to - w.from).toBe(DAY);
  });
  test('week is a day back and six ahead, so what just slipped is still visible', () => {
    const w = windowFor('week', NOW);
    expect(w.from).toBe(NOW.getTime() - DAY);
    expect(w.to).toBe(NOW.getTime() + 6 * DAY);
  });
  test('month is three days back and twenty-seven ahead', () => {
    const w = windowFor('month', NOW);
    expect(w.from).toBe(NOW.getTime() - 3 * DAY);
    expect(w.to).toBe(NOW.getTime() + 27 * DAY);
  });
});

describe('which items reach the window', () => {
  test('no items: no rows, no undated, a now-line', () => {
    const l = layout([], 'week', NOW, 280);
    expect(l.rows).toEqual([]);
    expect(l.undated).toEqual([]);
    expect(l.nowX).not.toBeNull();
  });
  test('an item entirely before the window is dropped', () => {
    expect(layout([item({ id: 'a', start: at(-10 * DAY), end: at(-8 * DAY) })], 'week', NOW, 280).rows).toEqual([]);
  });
  test('an item entirely after the window is dropped', () => {
    expect(layout([item({ id: 'a', start: at(10 * DAY), end: at(12 * DAY) })], 'week', NOW, 280).rows).toEqual([]);
  });
  test('an item spanning the whole window is clipped to its edges and marked open both ways', () => {
    const [row] = layout([item({ id: 'a', start: at(-30 * DAY), end: at(30 * DAY) })], 'week', NOW, 280).rows;
    expect(row.left).toBe(0);
    expect(row.left + row.width).toBe(280);
    expect(row.openLeft).toBe(true);
    expect(row.openRight).toBe(true);
  });
  test('a null start begins at the left edge of the window, and is not "open"', () => {
    const [row] = layout([item({ id: 'a', start: null, end: at(2 * DAY) })], 'week', NOW, 280).rows;
    expect(row.left).toBe(0);
    expect(row.openLeft).toBe(false);
  });
  test('a null end is not a bar: it is listed as undated', () => {
    const l = layout([item({ id: 'a', start: at(-DAY), end: null })], 'week', NOW, 280);
    expect(l.rows).toEqual([]);
    expect(l.undated.map(i => i.id)).toEqual(['a']);
  });
  test('a done plan leaves the axis', () => {
    const l = layout([item({ id: 'a', start: at(-DAY), end: at(DAY), done: true })], 'week', NOW, 280);
    expect(l.rows).toEqual([]);
    expect(l.undated).toEqual([]);
  });
  test('pixel extents follow the window linearly', () => {
    // week: from = now - 1d, span 7d, 700px wide => 100px a day.
    const [row] = layout([item({ id: 'a', start: at(0), end: at(2 * DAY) })], 'week', NOW, 700).rows;
    expect(row.left).toBeCloseTo(100, 5);
    expect(row.width).toBeCloseTo(200, 5);
  });
  test('a ten-minute item is still a visible bar', () => {
    const [row] = layout([item({ id: 'a', start: at(0), end: at(600e3) })], 'month', NOW, 280).rows;
    expect(row.width).toBeGreaterThanOrEqual(2);
  });
});

describe('row order', () => {
  test('rows are sorted by end, soonest on top, whatever order they arrived in', () => {
    const l = layout(
      [
        item({ id: 'late', start: at(-DAY), end: at(5 * DAY) }),
        item({ id: 'soon', start: at(0), end: at(DAY) }),
        item({ id: 'mid', start: null, end: at(3 * DAY) }),
      ],
      'week',
      NOW,
      280,
    );
    expect(l.rows.map(r => r.item.id)).toEqual(['soon', 'mid', 'late']);
  });
});

describe('the now-line', () => {
  test('sits at now within the window', () => {
    expect(layout([], 'week', NOW, 700).nowX).toBeCloseTo(100, 5);
  });
  test('is null when now is outside the window', () => {
    expect(layout([], 'today', NOW, 700, new Date(2026, 8, 13, 12)).nowX).toBeNull();
  });
  test('the past is everything left of it', () => {
    expect(layout([], 'week', NOW, 700).pastWidth).toBeCloseTo(100, 5);
  });
});

describe('the ticks, one rule per range', () => {
  test('today: every six hours, labelled as a time', () => {
    const w = windowFor('today', NOW);
    const ticks = ticksFor('today', w.from, w.to);
    expect(ticks.map(t => t.label)).toEqual(['00:00', '06:00', '12:00', '18:00', '00:00']);
    expect(new Date(ticks[1].t).getHours()).toBe(6);
  });
  test('week: every day at midnight, the day number, the first of a month named', () => {
    // 29 Sep to 4 Oct crosses a month boundary.
    const from = new Date(2026, 8, 29, 10).getTime();
    const ticks = ticksFor('week', from, from + 5 * DAY);
    expect(ticks.map(t => t.label)).toEqual(['30', dayMonth(new Date(2026, 9, 1)), '2', '3', '4']);
    expect(ticks.every(t => new Date(t.t).getHours() === 0)).toBe(true);
  });
  test('month: every Monday, day and month', () => {
    const w = windowFor('month', NOW);
    const ticks = ticksFor('month', w.from, w.to);
    expect(ticks.length).toBeGreaterThanOrEqual(4);
    expect(ticks.every(t => new Date(t.t).getDay() === 1)).toBe(true);
    expect(ticks[0].label).toBe(dayMonth(new Date(2026, 8, 14)));
  });
  test('layout places the ticks in pixels inside the axis', () => {
    const l = layout([], 'week', NOW, 280);
    expect(l.ticks.length).toBe(7);
    expect(l.ticks.every(t => t.x >= 0 && t.x <= 280)).toBe(true);
  });
});

describe('the meta at the end of a title line', () => {
  const on = (d: Date) => d.toISOString();
  test('one verb per kind, then the day', () => {
    const d = new Date(2026, 8, 15, 12);
    expect(endMeta({ ...item({ id: 'a', kind: 'decision' }), end: on(d) }, NOW)).toBe(`decides ${dayMonth(d)}`);
    expect(endMeta({ ...item({ id: 'a', kind: 'proposal' }), end: on(d) }, NOW)).toBe(`by ${dayMonth(d)}`);
    expect(endMeta({ ...item({ id: 'a', kind: 'book' }), end: on(d) }, NOW)).toBe(`settles ${dayMonth(d)}`);
    expect(endMeta({ ...item({ id: 'a', kind: 'plan' }), end: on(d) }, NOW)).toBe(`due ${dayMonth(d)}`);
  });
  test('today and tomorrow are written as words', () => {
    expect(endMeta({ ...item({ id: 'a', kind: 'plan' }), end: at(3 * 36e5) }, NOW)).toBe('due today');
    expect(endMeta({ ...item({ id: 'a', kind: 'decision' }), end: at(DAY) }, NOW)).toBe('decides tomorrow');
  });
  test('an undated item has no meta', () => {
    expect(endMeta(item({ id: 'a' }), NOW)).toBeNull();
  });
});
