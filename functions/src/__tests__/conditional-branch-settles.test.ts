import { conditionalBranchToSettle } from '../services/predictions';

/**
 * A conditional pair is symmetric.
 *
 * Submitting a proposal opens two markets per baseline market: what the metric
 * does if this is approved, and what it does if it is declined. The owner
 * chooses one of those worlds, and the market on the world that happened
 * settles against the metric like any other. The other one is a counterfactual
 * with nothing to settle against, so it voids.
 *
 * Until 2026-08-30 the resolver voided every conditional whose proposal was not
 * `approved`. A declined proposal's surviving branch was therefore voided at
 * its date rather than paying the people who had priced the decline correctly,
 * which also withheld the calibration record that /api/help and the guides
 * promise. Owner, 2026-08-30: "on the declined branch it's the other way
 * around, so the declined market goes further, and the approved one is voided".
 */
describe('which branch of a conditional pair settles', () => {
  test('an approved proposal settles its approved branch', () => {
    expect(conditionalBranchToSettle('approved')).toBe('approved');
  });

  test('a declined proposal settles its declined branch', () => {
    expect(conditionalBranchToSettle('declined')).toBe('declined');
  });

  test('an undecided or cancelled proposal settles neither', () => {
    // Nothing happened, so neither world is the one we are in. Both void and
    // everyone is refunded their net cash.
    for (const status of ['pending', 'withdrawn', 'declined_spam', 'removed', undefined]) {
      expect(conditionalBranchToSettle(status)).toBeNull();
    }
  });

  test('the two decided statuses are mirror images, not a special case for approval', () => {
    // The bug was an asymmetry: approval was the only status that could settle.
    // Whatever the owner decides, the branch naming that decision is the one
    // that pays.
    for (const decision of ['approved', 'declined'] as const) {
      expect(conditionalBranchToSettle(decision)).toBe(decision);
    }
  });
});
