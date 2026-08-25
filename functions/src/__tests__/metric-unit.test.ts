/**
 * The ask-adjustment gate (2026-08-15). A conditional pair's approved
 * branch opens at baseline minus the contract's ask only when the metric is
 * denominated in that money; applied to a metric counted in people it drove
 * every approved branch to the range floor and printed the same fake
 * negative impact on every contract.
 */

import { isMonetaryMetric, metricCurrencyUnit, metricSubtractsContractAsk } from '../lib/metric-unit';

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

describe('which metrics a contract ask burns into', () => {
  test.each(['LookPilot net 2026 (USD)', 'LookPilot net this week (USD)', 'Net revenue (USD)'])(
    '%s is net of payouts, so approving moves it',
    name => {
      expect(metricSubtractsContractAsk(name)).toBe(true);
    },
  );

  test.each([
    // Gross revenue: the payment does not touch it, and a week's range
    // starts at zero, so an adjusted branch would clamp at the floor.
    'LookPilot revenue this week (USD)',
    'Revenue (USD)',
    // Not money at all.
    'Weekly active verified traders',
    'Tracking hours (monthly)',
  ])('%s is not, so its pair opens unadjusted', name => {
    expect(metricSubtractsContractAsk(name)).toBe(false);
  });
});
