import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { MetricLog } from '../../types';
import {
  buildPointsFromLogs,
  buildOutlookPointsFromLogs,
  buildPointsFromTimeSeries,
  formatAxisValue,
  formatXAxisTick,
  formatTooltipTitle,
} from '../metrics-chart-model';

const DAY = 86400000;

function log(ts: string, value: number, outlook: number | null = null): MetricLog {
  return {
    metricId: 'm',
    metricName: 'M',
    value,
    outlook,
    timestamp: new Date(ts),
  };
}

describe('buildPointsFromLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Freeze "now" to a known local-midnight-friendly time.
    vi.setSystemTime(new Date('2026-04-22T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('empty logs returns empty array', () => {
    expect(buildPointsFromLogs([], 'day')).toEqual([]);
  });

  test('single log forward-fills daily to today', () => {
    const points = buildPointsFromLogs([log('2026-04-20T10:00:00', 42)], 'day');
    // From 2026-04-20 through 2026-04-22 = 3 points.
    expect(points.length).toBe(3);
    expect(points[0].y).toBe(42);
    expect(points[0].interpolated).toBe(false);
    expect(points[1].interpolated).toBe(true);
    expect(points[2].interpolated).toBe(true);
    expect(points.every(p => p.y === 42)).toBe(true);
  });

  test('multiple logs same interval collapse to last value', () => {
    const points = buildPointsFromLogs([
      log('2026-04-22T08:00:00', 10),
      log('2026-04-22T14:00:00', 20),
      log('2026-04-22T18:00:00', 30),
    ], 'day');
    expect(points.length).toBe(1);
    expect(points[0].y).toBe(30);
    expect(points[0].interpolated).toBe(false);
  });

  test('logs across days produce one point per day', () => {
    const points = buildPointsFromLogs([
      log('2026-04-20T10:00:00', 10),
      log('2026-04-21T10:00:00', 20),
      log('2026-04-22T10:00:00', 30),
    ], 'day');
    expect(points.map(p => p.y)).toEqual([10, 20, 30]);
    expect(points.every(p => !p.interpolated)).toBe(true);
  });

  test('sparse logs: gaps carry last known value forward', () => {
    const points = buildPointsFromLogs([
      log('2026-04-20T10:00:00', 5),
      // gap on 04-21
      log('2026-04-22T10:00:00', 15),
    ], 'day');
    expect(points.length).toBe(3);
    expect(points[0]).toMatchObject({ y: 5, interpolated: false });
    expect(points[1]).toMatchObject({ y: 5, interpolated: true });
    expect(points[2]).toMatchObject({ y: 15, interpolated: false });
  });

  test('points are returned in ascending x order', () => {
    const points = buildPointsFromLogs([
      log('2026-04-22T10:00:00', 30),
      log('2026-04-20T10:00:00', 10),
      log('2026-04-21T10:00:00', 20),
    ], 'day');
    for (let i = 1; i < points.length; i++) {
      expect(points[i].x).toBeGreaterThan(points[i - 1].x);
    }
  });

  test('weekly interval aligns to ISO week start', () => {
    // 2026-04-22 is a Wednesday; ISO week starts Mon 2026-04-20.
    const points = buildPointsFromLogs([log('2026-04-22T10:00:00', 7)], 'week');
    expect(points.length).toBe(1);
    const alignedDate = new Date(points[0].x);
    expect(alignedDate.getDay()).toBe(1); // Monday
  });

  test('monthly interval aligns to first of month', () => {
    const points = buildPointsFromLogs([
      log('2026-01-15T10:00:00', 1),
      log('2026-03-15T10:00:00', 3),
    ], 'month');
    // Jan, Feb (interpolated), Mar, Apr (interpolated) = 4 months.
    expect(points.length).toBe(4);
    expect(points.map(p => p.y)).toEqual([1, 1, 3, 3]);
    expect(points.map(p => p.interpolated)).toEqual([false, true, false, true]);
    for (const p of points) {
      expect(new Date(p.x).getDate()).toBe(1);
    }
  });

  test('log with future timestamp is included up to today only', () => {
    // Future log a week out shouldn't extend past today in the output.
    const points = buildPointsFromLogs([
      log('2026-04-20T10:00:00', 10),
      log('2026-04-30T10:00:00', 20),
    ], 'day');
    // Logs after "now" (2026-04-22) shouldn't produce points past today.
    const lastX = points[points.length - 1].x;
    expect(lastX).toBeLessThanOrEqual(Date.now());
  });

  test('label format matches the interval (daily)', () => {
    const points = buildPointsFromLogs([log('2026-04-20T10:00:00', 1)], 'day');
    // Should be a date label, not a week or month style.
    expect(points[0].label).toMatch(/2026/);
  });

  test('does not mutate the input array', () => {
    const input = [
      log('2026-04-22T10:00:00', 3),
      log('2026-04-20T10:00:00', 1),
      log('2026-04-21T10:00:00', 2),
    ];
    const snapshot = [...input];
    buildPointsFromLogs(input, 'day');
    expect(input).toEqual(snapshot);
  });

  test('returns points with required ChartPoint fields', () => {
    const points = buildPointsFromLogs([log('2026-04-20T10:00:00', 42)], 'day');
    for (const p of points) {
      expect(typeof p.x).toBe('number');
      expect(Number.isFinite(p.x)).toBe(true);
      expect(typeof p.y).toBe('number');
      expect(typeof p.label).toBe('string');
      expect(p.label.length).toBeGreaterThan(0);
    }
  });
});

describe('buildOutlookPointsFromLogs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-22T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('empty logs returns empty array', () => {
    expect(buildOutlookPointsFromLogs([], 'day')).toEqual([]);
  });

  test('logs with only null outlook produce no points', () => {
    const points = buildOutlookPointsFromLogs([
      log('2026-04-20T10:00:00', 10, null),
      log('2026-04-21T10:00:00', 20, null),
    ], 'day');
    expect(points).toEqual([]);
  });

  test('leading null outlook rows are skipped, series starts at first real outlook', () => {
    const points = buildOutlookPointsFromLogs([
      log('2026-04-20T10:00:00', 10, null),
      log('2026-04-22T10:00:00', 20, 25),
    ], 'day');
    // Start 2026-04-22; no carry-forward before the first outlook.
    expect(points.length).toBe(1);
    expect(points[0]).toMatchObject({ y: 25, interpolated: false });
  });

  test('outlook forward-fills across gaps like value does', () => {
    const points = buildOutlookPointsFromLogs([
      log('2026-04-20T10:00:00', 5, 7),
      log('2026-04-22T10:00:00', 15, 17),
    ], 'day');
    expect(points.length).toBe(3);
    expect(points.map(p => p.y)).toEqual([7, 7, 17]);
    expect(points.map(p => p.interpolated)).toEqual([false, true, false]);
  });

  test('value and outlook builders produce independent series', () => {
    const logs = [
      log('2026-04-20T10:00:00', 5, 7),
      log('2026-04-21T10:00:00', 10, 12),
    ];
    const valuePts = buildPointsFromLogs(logs, 'day');
    const outlookPts = buildOutlookPointsFromLogs(logs, 'day');
    // Non-interpolated points reflect the original per-field values.
    const valueReal = valuePts.filter(p => !p.interpolated).map(p => p.y);
    const outlookReal = outlookPts.filter(p => !p.interpolated).map(p => p.y);
    expect(valueReal).toEqual([5, 10]);
    expect(outlookReal).toEqual([7, 12]);
  });
});

describe('buildPointsFromTimeSeries', () => {
  test('empty array returns empty', () => {
    expect(buildPointsFromTimeSeries([])).toEqual([]);
  });

  test('accepts YYYY-MM-DD dates', () => {
    const points = buildPointsFromTimeSeries([
      { date: '2026-01-01', value: 10 },
      { date: '2026-02-01', value: 20 },
    ]);
    expect(points.length).toBe(2);
    expect(points[0].label).toBe('2026-01-01');
  });

  test('accepts ISO week dates (YYYY-WNN)', () => {
    const points = buildPointsFromTimeSeries([
      { date: '2026-W01', value: 10 },
      { date: '2026-W10', value: 20 },
    ]);
    expect(points.length).toBe(2);
    for (const p of points) expect(Number.isFinite(p.x)).toBe(true);
  });

  test('accepts month-only (YYYY-MM) and year-only (YYYY) dates', () => {
    const points = buildPointsFromTimeSeries([
      { date: '2026-05', value: 1 },
      { date: '2027', value: 2 },
    ]);
    expect(points.length).toBe(2);
    for (const p of points) expect(Number.isFinite(p.x)).toBe(true);
  });

  test('skips entries whose dates cannot be parsed', () => {
    const points = buildPointsFromTimeSeries([
      { date: 'not-a-date', value: 1 },
      { date: '2026-01-01', value: 2 },
    ]);
    expect(points.length).toBe(1);
    expect(points[0].y).toBe(2);
  });

  test('deduplicates same x, keeping latest', () => {
    const points = buildPointsFromTimeSeries([
      { date: '2026-01-01', value: 10 },
      { date: '2026-01-01', value: 20 },
    ]);
    expect(points.length).toBe(1);
    expect(points[0].y).toBe(20);
  });

  test('plots a period marker on its end-of-period (resolution) day, not the start', () => {
    // A 2026-07 market resolves on 2026-07-31; the marker (and so its tooltip
    // date) must sit on Jul 31, matching what the user sees on click, not Jul 1.
    const [p] = buildPointsFromTimeSeries([{ date: '2026-07', value: 42 }]);
    expect(p.x).toBe(new Date('2026-07-31T00:00:00').getTime());
    expect(p.x).not.toBe(new Date('2026-07-01T00:00:00').getTime());
  });

  test('keeps distinct labels that resolve on the same end-of-period day (month + day boundary)', () => {
    // The month 2026-06 and the day 2026-06-30 both resolve on 2026-06-30.
    // They are different markets at different granularities and both must
    // appear on the chart; dedup-by-x would silently drop one, so we key on label.
    const points = buildPointsFromTimeSeries([
      { date: '2026-06-30', value: 20015.11 },
      { date: '2026-06', value: 4853.52 },
    ]);
    expect(points.length).toBe(2);
    const labels = points.map(p => p.label).sort();
    expect(labels).toEqual(['2026-06', '2026-06-30']);
    const ys = points.map(p => p.y).sort((a, b) => a - b);
    expect(ys).toEqual([4853.52, 20015.11]);
  });

  test('sorts output by x ascending even if input is out of order', () => {
    const points = buildPointsFromTimeSeries([
      { date: '2026-03-01', value: 3 },
      { date: '2026-01-01', value: 1 },
      { date: '2026-02-01', value: 2 },
    ]);
    expect(points.map(p => p.y)).toEqual([1, 2, 3]);
  });
});

describe('formatAxisValue', () => {
  test('values >= 1000 use no decimals', () => {
    expect(formatAxisValue(1234)).toBe('1234');
    expect(formatAxisValue(-1500)).toBe('-1500');
  });
  test('values in [100, 1000) use one decimal', () => {
    expect(formatAxisValue(123.456)).toBe('123.5');
  });
  test('small values use two decimals', () => {
    expect(formatAxisValue(0.1234)).toBe('0.12');
    expect(formatAxisValue(-12.345)).toBe('-12.35');
  });
});

describe('formatXAxisTick', () => {
  const aprilDay = new Date('2026-04-22').getTime();
  test('short spans show month+day', () => {
    const label = formatXAxisTick(aprilDay, DAY * 30);
    expect(label).toMatch(/Apr|4/);
    expect(label).not.toMatch(/2026/);
  });
  test('medium spans show year+month', () => {
    const label = formatXAxisTick(aprilDay, DAY * 200);
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/Apr|4/);
  });
  test('multi-year spans still show year+month (no bare year duplicates)', () => {
    const label = formatXAxisTick(aprilDay, DAY * 365 * 3);
    expect(label).toMatch(/2026/);
    expect(label).toMatch(/Apr|4/);
  });
});

describe('formatTooltipTitle', () => {
  test('includes label and a date', () => {
    const out = formatTooltipTitle({ x: Date.parse('2026-04-22'), y: 1, label: '2026-04-22' });
    expect(out).toContain('2026-04-22');
    expect(out).toMatch(/\(/);
  });
});

