/**
 * The master API key check, in one place.
 *
 * `API_KEY` is the platform master key (all capabilities, every workspace, the
 * cron endpoints). `API_KEY_PREVIOUS`, when set, is honoured too: during a
 * rotation the new key goes live while every caller (fleet, box, laptop, cron,
 * collectors) is moved over, and the old one is unset once they are. Without
 * the grace window a rotation was a simultaneous cutover of five readers and
 * any lag stalled the watcher control plane mid-season. Runbook:
 * docs/infra/deploy.md ("Master key rotation").
 *
 * Every reader of the master key goes through here; a test asserts that
 * `process.env.API_KEY` is read nowhere else under functions/src.
 */
import { timingSafeEqual } from 'crypto';

function equal(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  try {
    return timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

/** True when `candidate` is the current master key or, during a rotation, the previous one. */
export function isMasterKey(candidate: string | undefined | null): boolean {
  if (!candidate) return false;
  const current = process.env.API_KEY;
  if (current && equal(candidate, current)) return true;
  const previous = process.env.API_KEY_PREVIOUS;
  if (previous && equal(candidate, previous)) return true;
  return false;
}

/** True when a master key is configured at all (an instance with none has no platform admin key). */
export function masterKeyConfigured(): boolean {
  return Boolean(process.env.API_KEY);
}
