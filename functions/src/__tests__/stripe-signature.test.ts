import { createHmac } from 'crypto';
import { verifyStripeSignature } from '../lib/stripe';

/**
 * The webhook signature check, pure and against Stripe's published scheme:
 * header `t=<unix seconds>,v1=<hex hmac-sha256(secret, "<t>.<payload>")>`.
 * This is the authentication of the only endpoint that mints credits into
 * pools, so every rejection path gets its own test.
 */

const SECRET = 'whsec_test_secret';
const PAYLOAD = '{"type":"checkout.session.completed"}';

function sign(payload: string, t: number, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

const NOW = 1_787_900_000_000; // fixed clock so the tolerance is deterministic

describe('verifyStripeSignature', () => {
  test('accepts a fresh, correctly signed payload', () => {
    const t = Math.floor(NOW / 1000);
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, t), SECRET, 300, NOW)).toBe(true);
  });

  test('rejects a signature over different bytes', () => {
    const t = Math.floor(NOW / 1000);
    expect(verifyStripeSignature('{"tampered":true}', sign(PAYLOAD, t), SECRET, 300, NOW)).toBe(false);
  });

  test('rejects the wrong secret', () => {
    const t = Math.floor(NOW / 1000);
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, t, 'whsec_other'), SECRET, 300, NOW)).toBe(false);
  });

  test('rejects a stale timestamp (replay window)', () => {
    const t = Math.floor(NOW / 1000) - 3600;
    expect(verifyStripeSignature(PAYLOAD, sign(PAYLOAD, t), SECRET, 300, NOW)).toBe(false);
  });

  test('rejects a missing or malformed header', () => {
    expect(verifyStripeSignature(PAYLOAD, undefined, SECRET, 300, NOW)).toBe(false);
    expect(verifyStripeSignature(PAYLOAD, 'not-a-header', SECRET, 300, NOW)).toBe(false);
    expect(verifyStripeSignature(PAYLOAD, `t=${Math.floor(NOW / 1000)}`, SECRET, 300, NOW)).toBe(false);
  });

  test('accepts when any v1 in a multi-signature header matches (key rotation)', () => {
    const t = Math.floor(NOW / 1000);
    const good = createHmac('sha256', SECRET).update(`${t}.${PAYLOAD}`).digest('hex');
    const header = `t=${t},v1=${'0'.repeat(64)},v1=${good}`;
    expect(verifyStripeSignature(PAYLOAD, header, SECRET, 300, NOW)).toBe(true);
  });
});
