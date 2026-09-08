import { describe, expect, test } from 'vitest';
import { formatImpact } from '../formatImpact';

/**
 * One impact precision everywhere (docs/ui-conventions.md, "The decision
 * row, then the decision bar"): the since-open chip, the decision row's
 * difference cell and the proposals rail print the SAME difference at the
 * SAME precision. Two decimals under 1, one decimal under 100, whole
 * above; never "+0.0" for a number that is not zero.
 */
describe('formatImpact', () => {
  test('two decimals under 1', () => {
    expect(formatImpact(0.45, '$')).toBe('+$0.45');
    expect(formatImpact(-0.5, '')).toBe('-0.50');
  });

  test('one decimal under 100', () => {
    expect(formatImpact(7.8, '$')).toBe('+$7.8');
    expect(formatImpact(-42.25, '')).toBe('-42.3');
    expect(formatImpact(1, '')).toBe('+1.0');
  });

  test('whole from 100 up, with the thousands separator', () => {
    expect(formatImpact(100, '')).toBe('+100');
    expect(formatImpact(11_000, '$')).toBe('+$11,000');
    expect(formatImpact(-73_387.4, '$')).toBe('-$73,387');
  });

  test('the sign is on the number, the unit after it', () => {
    expect(formatImpact(-3, '$')).toBe('-$3.0');
    expect(formatImpact(3, '$')).toBe('+$3.0');
  });

  test('zero is bare: no sign', () => {
    expect(formatImpact(0, '$')).toBe('$0.00');
  });

  test('never "+0.0" for a number that is not zero', () => {
    expect(formatImpact(0.004, '')).not.toMatch(/^\+0\.0+$/);
    expect(formatImpact(0.004, '')).toBe('+0.004');
    expect(formatImpact(-0.0002, '$')).toBe('-$0.0002');
  });
});
