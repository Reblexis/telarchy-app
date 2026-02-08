import type { GraphInterval, MetricLog } from '../types';

export function alignTimestamp(date: Date, interval: GraphInterval): Date {
  const aligned = new Date(date);
  aligned.setMilliseconds(0);
  aligned.setSeconds(0);
  aligned.setMinutes(0);
  aligned.setHours(0);

  if (interval === 'day') {
    return aligned;
  }

  if (interval === 'week') {
    const day = aligned.getDay();
    const diff = (day === 0 ? -6 : 1) - day;
    aligned.setDate(aligned.getDate() + diff);
    return aligned;
  }

  aligned.setDate(1);

  if (interval === 'month') {
    return aligned;
  }

  aligned.setMonth(0);
  return aligned;
}

export function generateIntervals(startDate: Date, endDate: Date, interval: GraphInterval): Date[] {
  const intervals: Date[] = [];
  const current = alignTimestamp(startDate, interval);
  const end = endDate.getTime();

  while (current.getTime() <= end) {
    intervals.push(new Date(current));

    if (interval === 'day') {
      current.setDate(current.getDate() + 1);
    } else if (interval === 'week') {
      current.setDate(current.getDate() + 7);
    } else if (interval === 'month') {
      current.setMonth(current.getMonth() + 1);
    } else if (interval === 'year') {
      current.setFullYear(current.getFullYear() + 1);
    }
  }

  return intervals;
}

export function getIntervalValue(logs: MetricLog[], intervalStart: number, intervalEnd: number): number | null {
  let lastValueInInterval: number | null = null;

  for (const log of logs) {
    const logTime = log.timestamp.getTime();
    if (logTime >= intervalStart && logTime < intervalEnd) {
      lastValueInInterval = log.value;
    } else if (logTime >= intervalEnd) {
      break;
    }
  }

  return lastValueInInterval;
}

export function getLastKnownValue(logs: MetricLog[], beforeTime: number): number | null {
  let lastValue: number | null = null;
  for (const log of logs) {
    if (log.timestamp.getTime() <= beforeTime) {
      lastValue = log.value;
    } else {
      break;
    }
  }
  return lastValue;
}

export function buildChartData(
  logs: MetricLog[],
  interval: GraphInterval
): { labels: string[]; barData: number[]; isInterpolated: boolean[] } | null {
  if (logs.length === 0) return null;

  const now = new Date();
  const intervals = generateIntervals(logs[0].timestamp, now, interval);

  const rawValues: (number | null)[] = [];
  const labels: string[] = [];

  for (let i = 0; i < intervals.length; i++) {
    const intervalStart = intervals[i].getTime();
    const intervalEnd = i < intervals.length - 1 ? intervals[i + 1].getTime() : now.getTime();

    const valueInInterval = getIntervalValue(logs, intervalStart, intervalEnd);
    rawValues.push(valueInInterval);

    if (interval === 'day') {
      labels.push(intervals[i].toLocaleDateString());
    } else if (interval === 'week') {
      labels.push('Week ' + intervals[i].toLocaleDateString());
    } else if (interval === 'month') {
      labels.push(intervals[i].toLocaleDateString('default', { month: 'short', year: 'numeric' }));
    } else if (interval === 'year') {
      labels.push(intervals[i].getFullYear().toString());
    }
  }

  const barData: number[] = [];
  const isInterpolated: boolean[] = [];

  for (let i = 0; i < rawValues.length; i++) {
    if (rawValues[i] !== null) {
      barData.push(rawValues[i]!);
      isInterpolated.push(false);
    } else {
      let prevIdx = -1;
      let nextIdx = -1;

      for (let j = i - 1; j >= 0; j--) {
        if (rawValues[j] !== null) { prevIdx = j; break; }
      }
      for (let j = i + 1; j < rawValues.length; j++) {
        if (rawValues[j] !== null) { nextIdx = j; break; }
      }

      if (prevIdx !== -1 && nextIdx !== -1) {
        const prevVal = rawValues[prevIdx]!;
        const nextVal = rawValues[nextIdx]!;
        const ratio = (i - prevIdx) / (nextIdx - prevIdx);
        barData.push(prevVal + (nextVal - prevVal) * ratio);
      } else if (prevIdx !== -1) {
        barData.push(rawValues[prevIdx]!);
      } else if (nextIdx !== -1) {
        barData.push(rawValues[nextIdx]!);
      } else {
        barData.push(getLastKnownValue(logs, intervals[i].getTime()) || 0);
      }
      isInterpolated.push(true);
    }
  }

  if (barData.length === 0) return null;

  return { labels, barData, isInterpolated };
}
