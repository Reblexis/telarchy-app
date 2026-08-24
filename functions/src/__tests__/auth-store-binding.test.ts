import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Identity does not follow the beta's data swap.
 *
 * The beta serves its own database so an experiment cannot touch a live
 * market, but the browser signs in against the origin's own `/api/auth`,
 * which is what makes Google work on the real domain. If BetterAuth resolved
 * that session through the swapping handle, everyone signed in on
 * telarchy.com/beta would be resolved against the beta store, find no session
 * there and be treated as anonymous by every call the page makes: signed in
 * to the page, a stranger to the API (owner, 2026-08-24: "im signed in in
 * telarchy.com/beta but suddenly not in the manage site").
 *
 * A source check rather than a behavioural one because the failure needs two
 * live databases to reproduce, and the way it comes back is somebody tidying
 * `authDb` to `db` because every other module uses `db`.
 */

const SRC = join(__dirname, '..');

describe('the account store', () => {
  test('BetterAuth binds to authDb, never the per-request handle', () => {
    const src = readFileSync(join(SRC, 'auth.ts'), 'utf8');
    expect(src).toMatch(/drizzleAdapter\(\s*authDb\s*,/);
    expect(src).not.toMatch(/drizzleAdapter\(\s*db\s*,/);
  });

  test('and the module does not import the swapping handle at all', () => {
    // Importing it is how it creeps back into one call.
    const src = readFileSync(join(SRC, 'auth.ts'), 'utf8');
    expect(src).not.toMatch(/import \{[^}]*\bdb\b[^}]*\} from '\.\/db\/client'/);
  });

  test('client.ts explains why the account store exists', () => {
    // The next person to see two names for one database deletes one of them.
    const src = readFileSync(join(SRC, 'db', 'client.ts'), 'utf8');
    expect(src).toMatch(/export const authDb/);
    expect(src).toMatch(/never follows the beta swap/i);
  });
});
