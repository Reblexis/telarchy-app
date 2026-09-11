/**
 * Every clock on the floor reads in the viewer's zone (docs/ui-conventions.md,
 * "Every clock on the floor reads in the viewer's zone"). One place formats
 * an instant; the zone is a parameter so a test can pin one, and the floor
 * passes none and gets the browser's.
 */

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The zone the page renders in: the browser's, or UTC where there is none. */
export function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function partsOf(iso: string | Date, zone?: string): Record<string, string> | null {
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone ?? viewerZone(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZoneName: 'short',
  });
  const out: Record<string, string> = {};
  for (const part of fmt.formatToParts(d)) out[part.type] = part.value;
  // Midnight prints as "24" in some ICU builds under hour12:false.
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** "12:38": the local hour and minute, no zone word. "" for nothing. */
export function clockOf(iso: string | Date | null | undefined, zone?: string): string {
  if (!iso) return '';
  const p = partsOf(iso, zone);
  return p ? `${p.hour}:${p.minute}` : '';
}

/** "11 Sep": the local day, own month names (en-GB ICU prints "Sept"). */
export function dayOf(iso: string | Date | null | undefined, zone?: string): string {
  if (!iso) return '';
  const p = partsOf(iso, zone);
  return p ? `${Number(p.day)} ${SHORT_MONTHS[Number(p.month) - 1]}` : '';
}

/** "11 Sep 2026, 12:38 CEST": the instant written out, the zone named once. */
export function instantOf(iso: string | Date | null | undefined, zone?: string): string {
  if (!iso) return '';
  const p = partsOf(iso, zone);
  if (!p) return '';
  return `${Number(p.day)} ${SHORT_MONTHS[Number(p.month) - 1]} ${p.year}, ${p.hour}:${p.minute} ${p.timeZoneName}`;
}

/**
 * "6d", "5h", "5:31", "0:09", "now": how long until the owner has to decide
 * (docs/ui-conventions.md, "The deadline is said ONCE"). Days and hours are
 * rounded up (with six days to go it says 6d until the sixth day is over);
 * under an hour it is minutes and seconds, rounded down, so it never reads a
 * minute the reader does not have.
 */
export function countdownTo(iso: string, now = Date.now()): { label: string; urgent: boolean } {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return { label: 'now', urgent: true };
  const hours = ms / 3_600_000;
  if (hours >= 24) return { label: `${Math.ceil(hours / 24)}d`, urgent: false };
  if (hours >= 1) return { label: `${Math.ceil(hours)}h`, urgent: true };
  const seconds = Math.floor(ms / 1000);
  return { label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, urgent: true };
}

type Clocked = { status?: string | null; decideBy?: string | null };

function soonestPendingMs(proposals: readonly Clocked[], now: number): number | null {
  let best: number | null = null;
  for (const p of proposals) {
    if (p.status !== 'pending' || !p.decideBy) continue;
    const ms = new Date(p.decideBy).getTime() - now;
    if (!Number.isFinite(ms)) continue;
    if (best === null || ms < best) best = ms;
  }
  return best;
}

/** The clocks tick every second while a pending deadline is under an hour, else every minute. */
export function tickIntervalFor(proposals: readonly Clocked[], now = Date.now()): number {
  const ms = soonestPendingMs(proposals, now);
  return ms !== null && ms < 3_600_000 ? 1000 : 60_000;
}

/**
 * The floor polls every fifteen seconds, every five while a pending proposal
 * decides within five minutes (docs/ui-conventions.md, "The board is at most
 * five seconds behind the trades"). A lapsed deadline is nothing to watch.
 */
export function pollIntervalFor(proposals: readonly Clocked[], now = Date.now()): number {
  const ms = soonestPendingMs(proposals, now);
  return ms !== null && ms > 0 && ms <= 5 * 60_000 ? 5000 : 15_000;
}
