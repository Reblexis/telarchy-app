/**
 * What a stored horizon entry means, in the words the dates dialog says it
 * (docs/owner-on-the-floor.md, "The dates a metric is priced on").
 *
 * A metric's `timePreference.customHorizons` is a list of two kinds of thing
 * that look alike and behave nothing alike: a ROLLING offset ("+0d", "+1m")
 * that opens a fresh market every period, and an ABSOLUTE date ("2026-12",
 * "2026-12-31") that happens once and is done. On the floor they render the
 * same way, as a date chip, which is why an owner could add a daily market
 * without ever being told it was daily.
 *
 * The resolver mirrors `functions/src/lib/date-utils.ts`. It is duplicated
 * rather than shared because the two run in different bundles; the tests pin
 * them to the same answers.
 */

export type Every = 'hour' | 'day' | 'week' | 'month' | 'year' | 'once';

const RELATIVE = /^\+(\d+)([hdwmy])$/;

const UNIT_TO_EVERY: Record<string, Every> = {
  h: 'hour',
  d: 'day',
  w: 'week',
  m: 'month',
  y: 'year',
};

const EVERY_TO_UNIT: Record<Exclude<Every, 'once'>, string> = {
  hour: 'h',
  day: 'd',
  week: 'w',
  month: 'm',
  year: 'y',
};

export interface HorizonEntry {
  /** The entry exactly as stored, which is what a stop removes. */
  entry: string;
  every: Every;
  /** 0 for the current period, 1 for the next one. Meaningless when once. */
  ahead: number;
  /** "Every day", "Every month", "31 December 2026, once". */
  label: string;
}

function isoWeekOf(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** The absolute date a stored entry points at right now. Absolute entries are
 *  returned unchanged, which is the whole difference between the two kinds. */
export function resolveEntry(entry: string, now: Date = new Date()): string {
  const m = entry.trim().match(RELATIVE);
  if (!m) return entry.trim();
  const amount = Number(m[1]);
  const unit = m[2];
  const d = new Date(now);
  switch (unit) {
    case 'h':
      d.setUTCHours(d.getUTCHours() + amount);
      return d.toISOString().slice(0, 13);
    case 'd':
      d.setDate(d.getDate() + amount);
      return d.toISOString().slice(0, 10);
    case 'w':
      d.setDate(d.getDate() + amount * 7);
      return isoWeekOf(d);
    case 'm':
      d.setMonth(d.getMonth() + amount);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    default:
      d.setFullYear(d.getFullYear() + amount);
      return String(d.getFullYear());
  }
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** An absolute entry in words ("31 December 2026", "December 2026"), the way
 *  the dialog's list promises it (docs/owner-on-the-floor.md, dialog 2). An
 *  entry in a shape the server never writes is shown as stored. */
function absoluteInWords(raw: string): string {
  let m = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}, ${m[4]}:00 UTC`;
  m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  m = raw.match(/^(\d{4})-W(\d{2})$/);
  if (m) return `Week ${Number(m[2])} of ${m[1]}`;
  m = raw.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  return raw;
}

/** A stored entry read back as the sentence the dialog shows. */
export function describeEntry(entry: string): HorizonEntry {
  const raw = entry.trim();
  const m = raw.match(RELATIVE);
  if (m) {
    const every = UNIT_TO_EVERY[m[2]];
    return { entry: raw, every, ahead: Number(m[1]), label: `Every ${every}` };
  }
  return { entry: raw, every: 'once', ahead: 0, label: `${absoluteInWords(raw)}, once` };
}

/** The entry to store for a choice made in the dialog. */
export function entryFor(every: Every, ahead: number, day: string, hour: string): string {
  if (every === 'once') return hour ? `${day}T${hour.slice(0, 2)}` : day;
  return `+${ahead}${EVERY_TO_UNIT[every]}`;
}

/** What the button promises: the market this choice opens, and whether
 *  another one follows it. */
export function repeatSentence(every: Every): string {
  if (every === 'once') return 'One market, on that date, and nothing after it.';
  return `A new market every ${every}, each opening with the liquidity below.`;
}
