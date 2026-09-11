import { describe, expect, test } from 'vitest';
import { kindWord, layout, pickStep, type TimelineItem, tickTimes, windowFor } from '../timeline-model';

/**
 * The pure geometry behind "What is planned" (docs/owner-on-the-floor.md,
 * "What is planned"; docs/ui-conventions.md, the FloorTimeline paragraph).
 * Everything here is arithmetic on a fixed clock so the component can be
 * a thin painter of what this returns.
 */

const DAY = 864e5;
const HOUR = 36e5;
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

/** The same formatter the model uses, so the test pins the naming rule (day
 *  at midnight, month on the first) and not ICU's spelling of September. */
const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
const month = (d: Date) => d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });

/** Six and a half pixels a character: the jsdom fallback the component uses. */
const measure = (s: string) => s.length * 6.5;

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
  test('no items: no lanes, no undated, a now-line', () => {
    const l = layout([], 'week', NOW, 600, measure);
    expect(l.lanes).toEqual([]);
    expect(l.undated).toEqual([]);
    expect(l.nowX).not.toBeNull();
  });
  test('an item entirely before the window is dropped', () => {
    const l = layout([item({ id: 'a', start: at(-10 * DAY), end: at(-8 * DAY) })], 'week', NOW, 600, measure);
    expect(l.lanes).toEqual([]);
  });
  test('an item entirely after the window is dropped', () => {
    const l = layout([item({ id: 'a', start: at(10 * DAY), end: at(12 * DAY) })], 'week', NOW, 600, measure);
    expect(l.lanes).toEqual([]);
  });
  test('an item spanning the whole window is clipped to its edges', () => {
    const l = layout([item({ id: 'a', start: at(-30 * DAY), end: at(30 * DAY) })], 'week', NOW, 600, measure);
    const bar = l.lanes[0][0];
    expect(bar.left).toBe(0);
    expect(bar.left + bar.width).toBe(600);
    expect(bar.openLeft).toBe(true);
    expect(bar.openRight).toBe(true);
  });
  test('a null start begins at the left edge of the window', () => {
    const l = layout([item({ id: 'a', start: null, end: at(2 * DAY) })], 'week', NOW, 600, measure);
    const bar = l.lanes[0][0];
    expect(bar.left).toBe(0);
    expect(bar.openLeft).toBe(false);
  });
  test('a null end is not a bar: it is listed as undated', () => {
    const l = layout([item({ id: 'a', start: at(-DAY), end: null })], 'week', NOW, 600, measure);
    expect(l.lanes).toEqual([]);
    expect(l.undated.map(i => i.id)).toEqual(['a']);
  });
  test('a done plan leaves the axis', () => {
    const l = layout([item({ id: 'a', start: at(-DAY), end: at(DAY), done: true })], 'week', NOW, 600, measure);
    expect(l.lanes).toEqual([]);
    expect(l.undated).toEqual([]);
  });
  test('pixel extents follow the window linearly', () => {
    // week: from = now - 1d, span 7d, 700px wide => 100px a day.
    const l = layout([item({ id: 'a', start: at(0), end: at(2 * DAY) })], 'week', NOW, 700, measure);
    const bar = l.lanes[0][0];
    expect(bar.left).toBeCloseTo(100, 5);
    expect(bar.width).toBeCloseTo(200, 5);
  });
});

describe('lane packing', () => {
  test('two overlapping items take two lanes', () => {
    const l = layout(
      [item({ id: 'a', start: at(0), end: at(2 * DAY) }), item({ id: 'b', start: at(DAY), end: at(3 * DAY) })],
      'week',
      NOW,
      700,
      measure,
    );
    expect(l.lanes.length).toBe(2);
  });
  test('two items that do not overlap share one lane', () => {
    const l = layout(
      [item({ id: 'a', start: at(0), end: at(DAY) }), item({ id: 'b', start: at(2 * DAY), end: at(3 * DAY) })],
      'week',
      NOW,
      700,
      measure,
    );
    expect(l.lanes.length).toBe(1);
    expect(l.lanes[0].map(b => b.item.id).sort()).toEqual(['a', 'b']);
  });
  test('a label spilling past a narrow bar reserves the lane too', () => {
    // 'a' is a 10-minute sliver (about 5px at 100px a day) with a long title;
    // its label sits past the bar and would run straight through 'b'.
    const l = layout(
      [
        item({ id: 'a', title: 'A very long plan title that spills', start: at(0), end: at(10 * 60e3) }),
        item({ id: 'b', start: at(HOUR), end: at(3 * HOUR) }),
      ],
      'week',
      NOW,
      700,
      measure,
    );
    expect(l.lanes.length).toBe(2);
    const a = l.lanes.flat().find(b => b.item.id === 'a')!;
    expect(a.labelInside).toBe(false);
  });
  test('a wide bar carries its label inside', () => {
    const l = layout([item({ id: 'a', title: 'Short', start: at(0), end: at(3 * DAY) })], 'week', NOW, 700, measure);
    const a = l.lanes[0][0];
    expect(a.labelInside).toBe(true);
    expect(a.labelX).toBe(a.left);
  });
  test('an outside label starts where the bar ends', () => {
    const l = layout(
      [item({ id: 'a', title: 'A very long plan title that spills', start: at(0), end: at(10 * 60e3) })],
      'week',
      NOW,
      700,
      measure,
    );
    const a = l.lanes[0][0];
    expect(a.labelInside).toBe(false);
    expect(a.labelX).toBeCloseTo(a.left + a.width, 5);
  });
  test('lanes are ordered by their soonest end, so the top is what is due first', () => {
    // 'late' starts first, so greedy packing puts it in lane 0; 'soon' ends
    // first and must come out on top regardless.
    const l = layout(
      [item({ id: 'late', start: at(-DAY), end: at(5 * DAY) }), item({ id: 'soon', start: at(0), end: at(DAY) })],
      'week',
      NOW,
      700,
      measure,
    );
    expect(l.lanes[0][0].item.id).toBe('soon');
    expect(l.lanes[1][0].item.id).toBe('late');
  });
});

describe('the now-line', () => {
  test('sits at now within the window', () => {
    const l = layout([], 'week', NOW, 700, measure);
    expect(l.nowX).toBeCloseTo(100, 5);
  });
  test('is null when now is outside the window', () => {
    // "today" for a clock that is not today: the window is built from `now`,
    // so push the clock instead by laying out with a different reference.
    const l = layout([], 'today', NOW, 700, measure, new Date(2026, 8, 13, 12));
    expect(l.nowX).toBeNull();
  });
  test('the past is everything left of it', () => {
    const l = layout([], 'week', NOW, 700, measure);
    expect(l.pastWidth).toBeCloseTo(100, 5);
  });
});

describe('the tick ladder', () => {
  test('today on a narrow rail steps six hours', () => {
    expect(pickStep(DAY, 280)).toEqual({ u: 'hour', n: 6 });
  });
  test('today on a wide rail steps three hours', () => {
    expect(pickStep(DAY, 600)).toEqual({ u: 'hour', n: 3 });
  });
  test('a week at 600px steps a day', () => {
    expect(pickStep(7 * DAY, 600)).toEqual({ u: 'day', n: 1 });
  });
  test('a week on a narrow rail falls back to weeks rather than crowding', () => {
    expect(pickStep(7 * DAY, 280)).toEqual({ u: 'day', n: 7 });
  });
  test('a month at 600px steps a week', () => {
    expect(pickStep(30 * DAY, 600)).toEqual({ u: 'day', n: 7 });
  });
  test('ticks land on the unit boundary and name the day at midnight', () => {
    const w = windowFor('today', NOW);
    const ticks = tickTimes(w.from, w.to, { u: 'hour', n: 6 });
    const labels = ticks.map(t => t.label);
    const midnight = day(new Date(2026, 8, 11));
    expect(labels[0]).toBe(midnight);
    expect(labels).toContain('06:00');
    expect(ticks.find(t => t.label === midnight)?.major).toBe(true);
    expect(ticks.find(t => t.label === '06:00')?.major).toBe(false);
  });
  test('day ticks name the month on the first', () => {
    const from = new Date(2026, 8, 29).getTime();
    const ticks = tickTimes(from, from + 4 * DAY, { u: 'day', n: 1 });
    expect(ticks.map(t => t.label)).toEqual([
      day(new Date(2026, 8, 29)),
      day(new Date(2026, 8, 30)),
      month(new Date(2026, 9, 1)),
      day(new Date(2026, 9, 2)),
      day(new Date(2026, 9, 3)),
    ]);
    expect(ticks[2].major).toBe(true);
  });
  test('layout drops the tick that would be sliced at the left edge', () => {
    const l = layout([], 'week', NOW, 600, measure);
    expect(l.ticks.every(t => t.x >= 0 && t.x <= 600)).toBe(true);
  });
});

describe('the type word on a bar', () => {
  test('one short word per kind', () => {
    expect(kindWord('proposal')).toBe('proposal');
    expect(kindWord('decision')).toBe('decides');
    expect(kindWord('book')).toBe('book');
    expect(kindWord('plan')).toBe('plan');
  });
});
