import {
  AGENT_SIGNUP_CREDITS,
  CREDIT_PRECISION,
  DEFAULT_MARKET_LIQUIDITY_CREDITS,
  fromUnits,
  MIN_LIQUIDITY_CONTRIBUTION,
  parseSignupCredits,
  SIGNUP_CREDITS,
  sufficientBalance,
  toUnits,
} from '../lib/validation';

describe('credit conversion helpers', () => {
  test('toUnits converts credits to nanocredits', () => {
    expect(toUnits(1)).toBe(CREDIT_PRECISION);
    expect(toUnits(0)).toBe(0);
    expect(toUnits(1000)).toBe(1000 * CREDIT_PRECISION);
    expect(toUnits(0.5)).toBe(500_000_000);
  });

  test('fromUnits converts nanocredits to credits', () => {
    expect(fromUnits(CREDIT_PRECISION)).toBe(1);
    expect(fromUnits(0)).toBe(0);
    expect(fromUnits(500_000_000)).toBe(0.5);
    expect(fromUnits(1000 * CREDIT_PRECISION)).toBe(1000);
  });

  test('round-trip preserves value for whole credits', () => {
    for (const credits of [0, 1, 100, 1000, 9_007_199]) {
      expect(fromUnits(toUnits(credits))).toBe(credits);
    }
  });

  test('round-trip preserves value for fractional credits', () => {
    for (const credits of [0.5, 0.25, 0.001, 12.345]) {
      expect(fromUnits(toUnits(credits))).toBeCloseTo(credits, 8);
    }
  });

  test('toUnits rounds to nearest integer (no floating-point drift)', () => {
    expect(Number.isInteger(toUnits(0.1))).toBe(true);
    expect(Number.isInteger(toUnits(0.3))).toBe(true);
    expect(Number.isInteger(toUnits(99.99))).toBe(true);
  });

  test('toUnits stays within safe integer range for reasonable balances', () => {
    const maxSafe = Math.floor(Number.MAX_SAFE_INTEGER / CREDIT_PRECISION);
    expect(toUnits(maxSafe)).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});

describe('sufficientBalance', () => {
  test('exact balance is sufficient', () => {
    expect(sufficientBalance(toUnits(100), 100)).toBe(true);
  });

  test('more than enough is sufficient', () => {
    expect(sufficientBalance(toUnits(200), 100)).toBe(true);
  });

  test('insufficient balance returns false', () => {
    expect(sufficientBalance(toUnits(99), 100)).toBe(false);
  });

  test('zero balance with zero cost is sufficient', () => {
    expect(sufficientBalance(0, 0)).toBe(true);
  });

  test('handles fractional costs without float comparison bugs', () => {
    // 0.1 + 0.2 !== 0.3 in IEEE 754, but integer comparison avoids this
    expect(sufficientBalance(toUnits(0.3), 0.3)).toBe(true);
    expect(sufficientBalance(toUnits(0.1), 0.1)).toBe(true);
  });
});

describe('signup and workspace creation constants', () => {
  test('SIGNUP_CREDITS defaults to 10000 when the env var is unset (raised 2026-08-28)', () => {
    expect(parseSignupCredits(undefined)).toBe(10000);
    expect(parseSignupCredits('')).toBe(10000);
    // The test environment does not set SIGNUP_CREDITS, so the constant is the default.
    expect(SIGNUP_CREDITS).toBe(10000);
  });

  test('AGENT_SIGNUP_CREDITS defaults to 0: an API identity mints no bankroll (2026-08-28)', () => {
    expect(AGENT_SIGNUP_CREDITS).toBe(0);
  });

  test('parseSignupCredits accepts 0 (zero-grant instances)', () => {
    expect(parseSignupCredits('0')).toBe(0);
  });

  test('parseSignupCredits falls back to the default on invalid values', () => {
    expect(parseSignupCredits('garbage')).toBe(10000);
    expect(parseSignupCredits('-5')).toBe(10000);
    expect(parseSignupCredits('Infinity')).toBe(10000);
    expect(parseSignupCredits('99999999999')).toBe(10000);
  });

  test('SIGNUP_CREDITS converts to a safe integer in nanocredits', () => {
    const units = toUnits(SIGNUP_CREDITS);
    expect(Number.isSafeInteger(units)).toBe(true);
    expect(units).toBe(10_000_000_000_000);
  });

  test('DEFAULT_MARKET_LIQUIDITY_CREDITS is 0.5', () => {
    expect(DEFAULT_MARKET_LIQUIDITY_CREDITS).toBe(0.5);
  });

  test('MIN_LIQUIDITY_CONTRIBUTION only rules out a zero-liquidity market', () => {
    // The floor exists to stop a degenerate b=0 market, not to enforce a
    // minimum depth: a thin market is the proposer's risk to take, not
    // something the platform forbids. One nanocredit is the storage
    // granularity, so it is the smallest contribution that can exist.
    expect(MIN_LIQUIDITY_CONTRIBUTION).toBe(1 / CREDIT_PRECISION);
    expect(MIN_LIQUIDITY_CONTRIBUTION).toBeGreaterThan(0);
    expect(MIN_LIQUIDITY_CONTRIBUTION).toBeLessThan(DEFAULT_MARKET_LIQUIDITY_CREDITS);
  });

  test('auto-fund cost for a full workspace is affordable with signup credits', () => {
    // 3 metrics, ~9 time horizons each = ~27 markets, each funded at 0.5 credits
    const maxMarkets = 27;
    const totalFundingCost = maxMarkets * DEFAULT_MARKET_LIQUIDITY_CREDITS;
    expect(totalFundingCost).toBeLessThan(SIGNUP_CREDITS);
    // Should use less than 2% of starting credits for market liquidity
    expect(totalFundingCost / SIGNUP_CREDITS).toBeLessThan(0.02);
  });
});
