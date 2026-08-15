/**
 * The ask-adjustment gate (2026-08-15). A conditional pair's approved
 * branch opens at baseline minus the contract's ask only when the metric is
 * denominated in that money; applied to a metric counted in people it drove
 * every approved branch to the range floor and printed the same fake
 * negative impact on every contract.
 */

import { isMonetaryMetric, metricCurrencyUnit } from '../lib/metric-unit';

describe('metric unit from the name tail', () => {
  test.each([
    ['LookPilot net 2026 (USD)', '$'],
    ['LookPilot net 2026 (USD, this week)', '$'],
    ['Revenue ($)', '$'],
    ['Monthly revenue (usd)', '$'],
  ])('%s is money', (name, unit) => {
    expect(metricCurrencyUnit(name)).toBe(unit);
    expect(isMonetaryMetric(name)).toBe(true);
  });

  test.each([
    'Weekly active verified traders',
    'Weekly active verified traders (end of 2026)',
    'Tracking hours (monthly)',
    'Steam recent review percentage',
    'Users (thousands)',
  ])('%s is not money', name => {
    expect(metricCurrencyUnit(name)).toBe('');
    expect(isMonetaryMetric(name)).toBe(false);
  });

  test('only the trailing parenthetical counts, not a mention mid-name', () => {
    // "(end of 2026)" is the tail here; the USD earlier belongs to prose.
    expect(isMonetaryMetric('Something USD-ish (end of 2026)')).toBe(false);
  });
});
