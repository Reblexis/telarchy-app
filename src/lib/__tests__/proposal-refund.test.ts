import { describe, expect, test } from 'vitest';
import { refundLine } from '../proposal-refund';

/**
 * The ticket says what happens to the bet if the other world wins
 * (docs/ui-conventions.md, "A proposal is a decision with a price",
 * direction A, 2026-09-18). One line, on a pending proposal only.
 */
describe('a bet on the world that does not happen is refunded, and the ticket says so', () => {
  test('on the approved branch the other world is a decline', () => {
    expect(refundLine({ pending: true, optioned: false, branch: 'approved' })).toBe(
      'If this is declined, your bet is refunded.',
    );
  });
  test('on the declined branch the other world is an approval', () => {
    expect(refundLine({ pending: true, optioned: false, branch: 'declined' })).toBe(
      'If this is approved, your bet is refunded.',
    );
  });
  test('with options the other world is another option, whichever one is on screen', () => {
    expect(refundLine({ pending: true, optioned: true, branch: 'opt-2' })).toBe(
      'If another option is chosen, your bet is refunded.',
    );
  });
  test('a decided or lapsed proposal promises no refund: the ruling already happened', () => {
    expect(refundLine({ pending: false, optioned: false, branch: 'approved' })).toBeNull();
    expect(refundLine({ pending: false, optioned: true, branch: 'opt-1' })).toBeNull();
  });
});
