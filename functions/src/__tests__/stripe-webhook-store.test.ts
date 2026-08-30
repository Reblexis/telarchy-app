import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Stripe webhook writes to the store its host names.
 *
 * The webhook route is mounted before the store-swap middleware, because the
 * signature is over the exact bytes Stripe sent and the raw-body parser has
 * to run before express.json(). Everything mounted there is on the
 * production store by default, which is right on telarchy.com and wrong
 * everywhere else: a purchase made against the candidate writes its pending
 * row to the beta store, and a webhook resolved against production finds no
 * such purchase and credits nobody. Measured on 2026-08-30 with a $25 test
 * purchase that Stripe reported as delivered and that left the wallet at
 * zero.
 *
 * A source check rather than a behavioural one for the same reason as
 * auth-store-binding: reproducing it needs two live databases, and the way it
 * comes back is somebody simplifying the wrapper away because every other
 * route gets its store from middleware.
 */

const SRC = join(__dirname, '..');

describe('the Stripe webhook', () => {
  const src = readFileSync(join(SRC, 'app.ts'), 'utf8');

  test('chooses its store from the request host, before the swap can', () => {
    const route = src.slice(src.indexOf("app.post(\n  '/api/stripe/webhook'"));
    expect(route.slice(0, 600)).toMatch(/isBetaRequest\(req\.path, req\.headers\.host\)/);
    expect(route.slice(0, 600)).toMatch(/runInBetaStore\(\(\) => stripeWebhookHandler\(req, res\)\)/);
  });

  test('and still gets the raw body, so the signature can be verified', () => {
    expect(src).toMatch(/'\/api\/stripe\/webhook',\s*\n\s*express\.raw\(\{ type: 'application\/json' \}\)/);
    // The JSON parser must come after, or Stripe's bytes are gone.
    expect(src.indexOf("'/api/stripe/webhook'")).toBeLessThan(src.indexOf('app.use(express.json())'));
  });
});
