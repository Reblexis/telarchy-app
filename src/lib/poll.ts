/**
 * How long to wait before the next poll of a page that keeps itself current
 * (docs/ui-conventions.md, "The cockpit may never take the site down").
 *
 * A dashboard left open for hours is a running cost, not a page load, and a
 * failing backend must never be hammered by its own console: on 2026-09-09
 * the admin page retried failed polls at full speed and kept the site's one
 * instance saturated for two hours. So the interval is a minute while things
 * are healthy, doubles with each consecutive failure, and is capped so the
 * page still recovers by itself once the backend does.
 */
export const POLL_BASE_MS = 60_000;
export const POLL_MAX_MS = 300_000;

export function pollDelay(consecutiveFailures: number, baseMs = POLL_BASE_MS, maxMs = POLL_MAX_MS): number {
  if (consecutiveFailures <= 0) return baseMs;
  return Math.min(maxMs, baseMs * 2 ** consecutiveFailures);
}
