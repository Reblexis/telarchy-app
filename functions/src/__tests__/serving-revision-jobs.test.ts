/**
 * THE RULE: only the revision serving telarchy.com runs the scheduled jobs.
 *
 * Every revision arms every timer in server.ts at boot, and background work is
 * outside the per-request store swap BY CONSTRUCTION (db/client.ts: "everything
 * outside a request gets production"). So the candidate - always warm at
 * --min-instances 1 - and every branch preview CI smoke-tests were running
 * settlement, the 12-second limit sweep, the daily refresh and daily
 * maintenance against LIVE MARKETS, with code nobody had reviewed yet
 * (bug hunt 2026-08-31, P0-3).
 *
 * The candidate is the sharp end: every merge to main lands one and it starts
 * immediately, hours before anyone presses Publish.
 *
 * Two things this rule must NOT do, which is why the fallbacks are tested as
 * hard as the rule:
 *
 *  - stop a self-hosted instance running its own jobs. There is no K_REVISION
 *    off Cloud Run, and that instance is the only thing that will ever settle
 *    its markets.
 *  - stop settling because the answer could not be fetched. Failing closed
 *    here means markets silently never pay out, which is worse than the
 *    problem being fixed - especially now that the settlement claim
 *    (services/predictions.ts) makes a second resolver harmless rather than
 *    a double payout.
 */

import { revisionRunsScheduledJobs } from '../services/release';

describe('only the serving revision runs the scheduled jobs', () => {
  test('the revision serving traffic runs them', () => {
    expect(revisionRunsScheduledJobs('api-01160-tag', 'api-01160-tag')).toBe(true);
  });

  test('the candidate does not, which is the case that mattered', () => {
    expect(revisionRunsScheduledJobs('api-01161-new', 'api-01160-tag')).toBe(false);
  });

  test('a branch preview does not', () => {
    expect(revisionRunsScheduledJobs('api-01158-br-some-branch', 'api-01160-tag')).toBe(false);
  });
});

describe('the fallbacks keep markets settling', () => {
  test('off Cloud Run there is no revision, so the instance runs its own jobs', () => {
    expect(revisionRunsScheduledJobs(null, null)).toBe(true);
    expect(revisionRunsScheduledJobs(null, 'api-01160-tag')).toBe(true);
  });

  test('an unknown serving revision fails OPEN, because nothing settling is worse', () => {
    expect(revisionRunsScheduledJobs('api-01160-tag', null)).toBe(true);
  });
});
