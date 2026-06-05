import type { GraphInterval, MetricLog } from '../types';
import { endOfPeriod } from './date-utils';

export interface ChartPoint {
  x: number;
  y: number;
  label: string;
  interpolated?: boolean;
}

function startOfISOWeek(d: Date): Date {
  const out = new Date(d);
  const day = out.getDay() || 7;
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - day + 1);
  return out;
}

// A market settles at the END of its target period, and the rest of the UI
// (market list, market detail, "resolves" labels) dates a market by
// endOfPeriod(targetDate). Plot the chart marker on that same calendar day so
// the tooltip and the marker's x-position match what the user sees when they
// click through to the market. Previously a "2026-07" market plotted on Jul 1
// (period start), one period off from its Jul 31 resolution date.
function parseTargetDateToMs(date: string): number {
  // Hour-granularity market ("2026-06-05T14", UTC): plot at the end of its
  // hour, matching the settle-at-period-end convention below.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}$/.test(date)) {
    return new Date(`${date}:00:00Z`).getTime() + 3_600_000;
  }
  const endDay = endOfPeriod(date);
  if (/^\d{4}-\d{2}-\d{2}$/.test(endDay)) return new Date(`${endDay}T00:00:00`).getTime();
  // Fallback for inputs endOfPeriod did not normalize to YYYY-MM-DD (not a
  // recognized target-date format); should not happen for real markets.
  return Date.parse(date);
}

function formatDateShort(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatAxisValue(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1000) return v.toFixed(0);
  if (abs >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

export function formatXAxisTick(ms: number, spanMs: number): string {
  const d = new Date(ms);
  const dayMs = 86400000;
  if (spanMs <= dayMs * 45) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  // Always include both year and month once the span crosses ~45 days. Using
  // year-only at multi-year spans caused adjacent sub-year ticks to collapse to
  // duplicate year labels.
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
}

export function buildPointsFromTimeSeries(series: Array<{ date: string; value: number }>): ChartPoint[] {
  const points = series
    .map(s => ({ x: parseTargetDateToMs(s.date), y: s.value, label: s.date }))
    .filter(p => !Number.isNaN(p.x))
    .sort((a, b) => a.x - b.x);

  // Merge duplicates by source date string, keeping the latest seen value.
  // Dedup must key on the original label, not the parsed timestamp: distinct
  // buckets at different granularities can collide on the same end-of-period
  // calendar day (e.g. the month 2026-06 and the day 2026-06-30 both resolve on
  // 2026-06-30), and they are genuinely different markets that should both render.
  const dedup = new Map<string, ChartPoint>();
  for (const p of points) dedup.set(p.label, p);
  return Array.from(dedup.values()).sort((a, b) => a.x - b.x);
}

function alignTimestamp(date: Date, interval: GraphInterval): Date {
  const aligned = new Date(date);
  aligned.setMilliseconds(0);
  aligned.setSeconds(0);
  aligned.setMinutes(0);
  aligned.setHours(0);
  if (interval === 'day') return aligned;
  if (interval === 'week') return startOfISOWeek(aligned);
  aligned.setDate(1);
  if (interval === 'month') return aligned;
  aligned.setMonth(0);
  return aligned;
}

function nextIntervalStart(date: Date, interval: GraphInterval): Date {
  const d = new Date(date);
  if (interval === 'day') d.setDate(d.getDate() + 1);
  else if (interval === 'week') d.setDate(d.getDate() + 7);
  else if (interval === 'month') d.setMonth(d.getMonth() + 1);
  else d.setFullYear(d.getFullYear() + 1);
  return d;
}

function intervalLabel(d: Date, interval: GraphInterval): string {
  if (interval === 'day') return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  if (interval === 'week') return `Week of ${d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`;
  if (interval === 'month') return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' });
  return d.toLocaleDateString(undefined, { year: 'numeric' });
}

type LogPicker = (log: MetricLog) => number | null | undefined;

function buildPointsPicking(logs: MetricLog[], interval: GraphInterval, pick: LogPicker): ChartPoint[] {
  if (logs.length === 0) return [];
  const sorted = [...logs].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  // Skip leading rows where the picked field is missing so we don't open the
  // chart window on rows that contribute nothing (e.g. pre-0018 logs for an
  // outlook series).
  const firstPickable = sorted.findIndex(l => {
    const v = pick(l);
    return typeof v === 'number' && !Number.isNaN(v);
  });
  if (firstPickable === -1) return [];
  const start = alignTimestamp(sorted[firstPickable].timestamp, interval);
  const end = new Date();

  const points: ChartPoint[] = [];
  let cursor = new Date(start);
  let i = firstPickable;
  let lastKnown: number | null = null;

  while (cursor.getTime() <= end.getTime()) {
    const intervalStart = cursor.getTime();
    const intervalEnd = nextIntervalStart(cursor, interval).getTime();

    let valueInInterval: number | null = null;
    while (i < sorted.length && sorted[i].timestamp.getTime() < intervalEnd) {
      const v = pick(sorted[i]);
      if (typeof v === 'number' && !Number.isNaN(v)) {
        valueInInterval = v;
        lastKnown = v;
      }
      i++;
    }

    if (valueInInterval !== null) {
      points.push({ x: intervalStart, y: valueInInterval, label: intervalLabel(cursor, interval), interpolated: false });
    } else if (lastKnown !== null) {
      points.push({ x: intervalStart, y: lastKnown, label: intervalLabel(cursor, interval), interpolated: true });
    }

    cursor = nextIntervalStart(cursor, interval);
  }
  return points;
}

export function buildPointsFromLogs(logs: MetricLog[], interval: GraphInterval): ChartPoint[] {
  return buildPointsPicking(logs, interval, l => l.value);
}

export function buildOutlookPointsFromLogs(logs: MetricLog[], interval: GraphInterval): ChartPoint[] {
  return buildPointsPicking(logs, interval, l => l.outlook);
}

export function formatTooltipTitle(point: ChartPoint): string {
  return `${point.label} (${formatDateShort(point.x)})`;
}
