/**
 * Telling a running client that something moved, in a response it already
 * reads.
 *
 * There is no `/v1` here on purpose. URL versioning is a promise to keep a
 * frozen surface working, and this API is still reshaped weekly across 190
 * endpoints, so the honest position is the one the skill already states: the
 * deployed catalog is the source of truth. What was missing is the other half
 * of that bargain. A bot written a month ago had no way to learn that a
 * parameter it sends was superseded except by breaking, and breaking is the
 * experience that stops someone maintaining a participant.
 *
 * So: standard headers, never a refusal. `Deprecation` (RFC 9745) as a
 * seconds-since-epoch date field, `Sunset` (RFC 8594) only when a removal date
 * has actually been decided, and a `Link` with `rel="deprecation"` pointing at
 * the policy. `X-Telarchy-Deprecation` carries the sentence a human reads in a
 * log, because the standard headers say WHEN and WHERE but never WHAT INSTEAD.
 *
 * Policy: docs/guides/compatibility.md.
 */
import type { Response } from 'express';

const POLICY_URL = 'https://telarchy.com/guides/compatibility';

export interface Deprecation {
  /** What is deprecated, in the caller's own terms ("?active=" ). */
  what: string;
  /** The date it became deprecated. */
  since: Date;
  /** What to use instead. Required: a notice with no replacement is noise. */
  use: string;
  /** When it will stop working, if that has actually been decided. */
  sunset?: Date;
}

/**
 * Add the notice to a response that is otherwise completely normal.
 *
 * Safe to call more than once on one response; the notices accumulate in
 * `X-Telarchy-Deprecation` and the earliest `Deprecation` date wins, since
 * that is the one the caller has been ignoring longest.
 */
export function markDeprecated(res: Response, d: Deprecation): void {
  const existing = res.getHeader('Deprecation');
  const seconds = Math.floor(d.since.getTime() / 1000);
  if (existing === undefined || Number(String(existing).replace('@', '')) > seconds) {
    res.setHeader('Deprecation', `@${seconds}`);
  }
  if (d.sunset) res.setHeader('Sunset', d.sunset.toUTCString());

  const link = `<${POLICY_URL}>; rel="deprecation"; type="text/html"`;
  const priorLink = res.getHeader('Link');
  if (priorLink === undefined) res.setHeader('Link', link);

  const note = `${d.what} is deprecated (since ${d.since.toISOString().slice(0, 10)}); use ${d.use}.${
    d.sunset ? ` It stops working on ${d.sunset.toISOString().slice(0, 10)}.` : ''
  }`;
  const priorNote = res.getHeader('X-Telarchy-Deprecation');
  res.setHeader('X-Telarchy-Deprecation', priorNote ? `${priorNote} ${note}` : note);
}
