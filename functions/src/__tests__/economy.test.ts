import { creditsIssuedForUsdcDeposit, depositBuyRateUsd } from '../lib/economy';

describe('depositBuyRateUsd', () => {
  test('no fee returns credit value', () => {
    expect(depositBuyRateUsd(1, 0)).toBe(1);
    expect(depositBuyRateUsd(2.5, 0)).toBe(2.5);
  });

  test('applies buy fee percent', () => {
    expect(depositBuyRateUsd(1, 5)).toBeCloseTo(1.05, 10);
    expect(depositBuyRateUsd(1, 100)).toBe(2);
  });
});

describe('creditsIssuedForUsdcDeposit', () => {
  test('1:1 with default economy', () => {
    expect(creditsIssuedForUsdcDeposit(100, 1, 0)).toBe(100);
    expect(creditsIssuedForUsdcDeposit(99.99, 1, 0)).toBe(99);
  });

  test('respects creditValueUsd', () => {
    expect(creditsIssuedForUsdcDeposit(10, 2, 0)).toBe(5);
    expect(creditsIssuedForUsdcDeposit(9.99, 2, 0)).toBe(4);
  });

  test('respects buyFeePercent (matches POST /deposit formula)', () => {
    expect(creditsIssuedForUsdcDeposit(105, 1, 5)).toBe(100);
    expect(creditsIssuedForUsdcDeposit(104.99, 1, 5)).toBe(99);
  });

  test('zero credits for sub-minimum deposit', () => {
    expect(creditsIssuedForUsdcDeposit(0.5, 1, 0)).toBe(0);
    expect(creditsIssuedForUsdcDeposit(1.04, 1, 5)).toBe(0);
  });
});
