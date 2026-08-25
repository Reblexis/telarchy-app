import { AsyncLocalStorage } from 'async_hooks';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

/**
 * Two stores, one process (owner ask 2026-08-20: "could we make the /beta
 * endpoint use a different db, so that we could run tests there and not
 * modify the actual db").
 *
 * The choice is made per REQUEST and carried in async context, never per
 * revision, because the revision serving the beta today is the exact revision
 * serving telarchy.com tomorrow: publishing shifts traffic to it rather than
 * rebuilding it. An env var saying "I am the beta" would survive that
 * promotion and point live traffic at the beta store. See lib/request-env.ts
 * for the rule and app.ts for where the context is entered.
 *
 * Everything outside a request (cron, migrations, scripts) gets production,
 * which is what it has always had.
 *
 * Connection budget: Cloud SQL telarchy-pg has max_connections=50 and Cloud
 * Run may run prod + candidate revisions at up to 4 instances each. Each
 * instance therefore gets 4 production connections plus, only if a beta
 * request ever reaches it, 1 beta connection: 2 x 4 x 5 = 40, the same worst
 * case as before this file had two pools. The beta pool is created lazily so
 * an instance serving the public site never opens it at all. The arithmetic
 * lives in docs/infra/deploy.md ("connection budget"); change it there first,
 * and scale-invariant.test.ts fails if the numbers stop adding up.
 */

/** Per instance: 4 for the live site, plus 1 for the beta if it is ever used.
 *  scale-invariant.test.ts multiplies these by the deployed instance ceiling. */
export const POOL_MAX = 4;
export const BETA_POOL_MAX = 1;

const POOL_OPTIONS = {
  connectionTimeoutMillis: 5_000,
  idleTimeoutMillis: 30_000,
};

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: POOL_MAX,
  ...POOL_OPTIONS,
});

const prodDb = drizzle(pool, { schema });

/**
 * The one store that never follows the beta swap: WHO someone is.
 *
 * The beta serves its own data so an experiment cannot touch a live market,
 * but the browser signs in against this origin's `/api/auth` (auth-client.ts
 * pins it, which is what makes Google work on the real domain). If the server
 * looked the resulting session up through the swapping handle, a visitor
 * signed in on telarchy.com/beta would be resolved against the beta store,
 * find no session there, and be treated as anonymous by every API call the
 * page makes: signed in to the page, a stranger to the server (owner,
 * 2026-08-24: "im signed in in telarchy.com/beta but suddenly not in the
 * manage site").
 *
 * So identity is global and data is per-store, which is what the beta stripe
 * says out loud ("own data, real account"), and every workspace, participant
 * and trade the beta creates is keyed by the same real account id.
 */
export const authDb = prodDb;

/** Set on a request that belongs to the beta; absent everywhere else. */
const requestStore = new AsyncLocalStorage<{ beta: boolean }>();

let betaPool: Pool | null = null;
let betaDb: typeof prodDb | null = null;

/**
 * True when this instance is configured with a beta store at all. Without
 * DATABASE_BETA_URL there is one database and the beta shares it, which is
 * how it worked before and how a self-hosted instance still works.
 */
export function betaStoreConfigured(): boolean {
  return Boolean(process.env.DATABASE_BETA_URL);
}

function beta(): typeof prodDb {
  if (!betaDb) {
    betaPool = new Pool({
      connectionString: process.env.DATABASE_BETA_URL,
      max: BETA_POOL_MAX,
      ...POOL_OPTIONS,
    });
    betaDb = drizzle(betaPool, { schema });
  }
  return betaDb;
}

/** The store this request belongs to. Production unless told otherwise. */
function current(): typeof prodDb {
  return requestStore.getStore()?.beta && betaStoreConfigured() ? beta() : prodDb;
}

/**
 * Run the rest of a request against the beta store. app.ts wraps beta
 * requests in this; nothing else should call it.
 */
export function runInBetaStore<T>(fn: () => T): T {
  return requestStore.run({ beta: true }, fn);
}

/** Which store the caller is on, for the beta stripe and the logs. */
export function currentStoreName(): 'beta' | 'production' {
  return requestStore.getStore()?.beta && betaStoreConfigured() ? 'beta' : 'production';
}

/**
 * The database handle every caller in the codebase already holds.
 *
 * It is a proxy rather than a value because there are hundreds of call sites
 * and they resolve `db` once at import time; the proxy makes each PROPERTY
 * ACCESS resolve instead, which is per query and therefore per request. A
 * transaction keeps whichever store it started on, since the callback runs
 * inside the same async context.
 */
export const db = new Proxy(prodDb, {
  get(_target, prop, receiver) {
    const active = current() as unknown as Record<string | symbol, unknown>;
    const value = Reflect.get(active, prop, receiver);
    return typeof value === 'function' ? value.bind(active) : value;
  },
}) as typeof prodDb;

/**
 * Give the current store a copy of an account row, if it is missing one.
 *
 * Identity is global and data is per-store, and the seam between those two
 * facts is a foreign key: `agents.auth_user_id` references the store's OWN
 * user table, so creating a participant in the beta for someone whose account
 * lives in the account store fails with
 * `agents_auth_user_id_user_id_fk` (found on the beta, 2026-08-24, as a bare
 * "Internal error" from /api/auth/me).
 *
 * The beta gets a shadow of the row rather than its own account: same id, so
 * every workspace, participant and trade it holds still belongs to the real
 * person, and the names and emails the beta joins for leaderboards resolve.
 * Nothing here writes back the other way.
 */
export async function mirrorAccountIntoStore(userId: string): Promise<void> {
  if (currentStoreName() !== 'beta') return;
  const active = current();
  const [here] = await active
    .select({ id: schema.authUser.id })
    .from(schema.authUser)
    .where(eq(schema.authUser.id, userId));
  if (here) return;
  const [real] = await prodDb.select().from(schema.authUser).where(eq(schema.authUser.id, userId));
  if (!real) return;
  await active.insert(schema.authUser).values(real).onConflictDoNothing();
}
