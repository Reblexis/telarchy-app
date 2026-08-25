/**
 * Structured payment methods (lib/payout.ts): the point of typing them is
 * that a value that validates is a value the owner can actually pay
 * against, so the checks are real: IBAN mod-97, per-network address
 * shapes, provider-specific fields. Plus the derived summary, which is
 * what proposal snapshots and the owner's payout view read.
 */

import { isValidIban, normalizePayoutMethod, payoutSummary } from '../lib/payout';

describe('IBAN', () => {
  test('accepts real checksums, in any spacing/case', () => {
    expect(isValidIban('GB82 WEST 1234 5698 7654 32')).toBe(true);
    expect(isValidIban('de89370400440532013000')).toBe(true);
    expect(isValidIban('CZ6508000000192000145399')).toBe(true);
  });
  test('rejects a single-digit typo', () => {
    expect(isValidIban('GB82WEST12345698765431')).toBe(false);
    expect(isValidIban('CZ6508000000192000145398')).toBe(false);
    expect(isValidIban('not-an-iban')).toBe(false);
  });
});

describe('normalizePayoutMethod', () => {
  test('each provider validates its own fields', () => {
    expect(normalizePayoutMethod({ provider: 'paypal', email: 'p@x.com' })).toEqual({
      provider: 'paypal',
      email: 'p@x.com',
    });
    expect(normalizePayoutMethod({ provider: 'paypal', email: 'nope' })).toBeInstanceOf(Error);

    expect(
      normalizePayoutMethod({ provider: 'bank', iban: 'de89 3704 0044 0532 0130 00', holder: 'Jan Novak' }),
    ).toEqual({ provider: 'bank', iban: 'DE89370400440532013000', holder: 'Jan Novak' });
    expect(normalizePayoutMethod({ provider: 'bank', iban: 'DE00', holder: 'Jan' })).toBeInstanceOf(Error);

    const evm = '0x' + 'ab'.repeat(20);
    expect(normalizePayoutMethod({ provider: 'crypto', network: 'base', asset: 'usdc', address: evm })).toEqual({
      provider: 'crypto',
      network: 'base',
      asset: 'USDC',
      address: evm,
    });
    expect(
      normalizePayoutMethod({ provider: 'crypto', network: 'ethereum', asset: 'ETH', address: '0x123' }),
    ).toBeInstanceOf(Error);
    expect(
      normalizePayoutMethod({ provider: 'crypto', network: 'dogecoin', asset: 'DOGE', address: 'x' }),
    ).toBeInstanceOf(Error);
    // The chain is not inferable from the address, so it is required and the
    // asset with it: the same 0x works on every EVM chain and says nothing
    // about whether the recipient wants USDC or ETH.
    expect(normalizePayoutMethod({ provider: 'crypto', network: 'base', address: evm })).toBeInstanceOf(Error);
    expect(normalizePayoutMethod({ provider: 'crypto', network: 'base', asset: 'USDT', address: evm })).toBeInstanceOf(
      Error,
    );
    expect(
      normalizePayoutMethod({
        provider: 'crypto',
        network: 'bitcoin',
        asset: 'USDC',
        address: 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4',
      }),
    ).toBeInstanceOf(Error);

    // An optional note rides along on every provider and lands in the summary.
    expect(normalizePayoutMethod({ provider: 'paypal', email: 'p@x.com', note: 'friends and family' })).toEqual({
      provider: 'paypal',
      email: 'p@x.com',
      note: 'friends and family',
    });
    expect(normalizePayoutMethod({ provider: 'paypal', email: 'p@x.com', note: 'x'.repeat(201) })).toBeInstanceOf(
      Error,
    );

    expect(normalizePayoutMethod({ provider: 'revolut', handle: '@john1abc' })).toEqual({
      provider: 'revolut',
      handle: 'john1abc',
    });
    expect(normalizePayoutMethod({ provider: 'wise', email: 'w@x.com' })).toEqual({
      provider: 'wise',
      email: 'w@x.com',
    });
    expect(normalizePayoutMethod({ provider: 'other', details: 'cash at the office' })).toEqual({
      provider: 'other',
      details: 'cash at the office',
    });
    expect(normalizePayoutMethod({ provider: 'other', details: 'x' })).toBeInstanceOf(Error);
    expect(normalizePayoutMethod({ provider: 'venmo' })).toBeInstanceOf(Error);
    expect(normalizePayoutMethod('paypal')).toBeInstanceOf(Error);
  });

  test('the summary reads like something you can pay against', () => {
    expect(payoutSummary({ provider: 'paypal', email: 'p@x.com' })).toBe('PayPal: p@x.com');
    expect(payoutSummary({ provider: 'bank', iban: 'DE89370400440532013000', holder: 'Jan Novak' })).toBe(
      'Bank (IBAN): DE89370400440532013000, holder Jan Novak',
    );
    expect(payoutSummary({ provider: 'crypto', network: 'base', asset: 'USDC', address: '0xabc' })).toBe(
      'USDC on Base: 0xabc',
    );
    expect(
      payoutSummary({ provider: 'bank', iban: 'DE89370400440532013000', holder: 'Jan Novak', note: 'ref INV-12' }),
    ).toBe('Bank (IBAN): DE89370400440532013000, holder Jan Novak (ref INV-12)');
  });
});
