import { describe, expect, test } from 'vitest';

/**
 * The cockpit backs off when a request fails (docs/ui-conventions.md, "The
 * cockpit may never take the site down"). On 2026-09-09 the admin page
 * retried its failed polls at full speed, nine requests inside fifty
 * milliseconds, which kept the one instance saturated and turned a slow page
 * into a two-hour outage. A failing backend must never be hammered by its own
 * console.
 */
import { POLL_BASE_MS, POLL_MAX_MS, pollDelay } from '../lib/poll';

describe('pollDelay', () => {
  test('a healthy poll runs at the base interval', () => {
    expect(pollDelay(0)).toBe(POLL_BASE_MS);
  });

  test('the base interval is a minute, not the twenty seconds that caused the outage', () => {
    expect(POLL_BASE_MS).toBeGreaterThanOrEqual(60_000);
  });

  test('each consecutive failure doubles the wait', () => {
    expect(pollDelay(1)).toBe(POLL_BASE_MS * 2);
    expect(pollDelay(2)).toBe(POLL_BASE_MS * 4);
  });

  test('the wait is capped, so the page still recovers on its own', () => {
    expect(pollDelay(3)).toBe(POLL_MAX_MS);
    expect(pollDelay(50)).toBe(POLL_MAX_MS);
    expect(POLL_MAX_MS).toBeLessThanOrEqual(10 * 60_000);
  });

  test('a success resets it: the caller passes zero again', () => {
    expect(pollDelay(0)).toBe(POLL_BASE_MS);
  });

  test('nothing ever schedules a poll sooner than the base interval', () => {
    for (const f of [-5, 0, 1, 2, 3, 9]) expect(pollDelay(f)).toBeGreaterThanOrEqual(POLL_BASE_MS);
  });
});
