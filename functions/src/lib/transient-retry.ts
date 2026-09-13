/**
 * Run database work again when Postgres ended it as one side of a lock
 * contest (docs/guides/proposals.md, 'A decision never fails because the
 * database was busy').
 *
 * A deadlock (40P01) or a serialization failure (40001) rolls the losing
 * transaction back whole, so nothing it did stands and running it again is
 * safe, provided the work checks its own state under its lock (voidMarket
 * claims the market before refunding). Lock ordering removes the cycles we
 * know of; this is what keeps a decision standing through the ones we do not.
 */

const TRANSIENT_CODES = new Set(['40P01', '40001']);

function codeOf(e: unknown): string | undefined {
  if (!e || typeof e !== 'object') return undefined;
  const code = (e as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isTransientLockError(e: unknown): boolean {
  const own = codeOf(e);
  if (own && TRANSIENT_CODES.has(own)) return true;
  // The query builder wraps the driver's error and keeps it as `cause`.
  const cause = e && typeof e === 'object' ? (e as { cause?: unknown }).cause : undefined;
  const wrapped = codeOf(cause);
  return !!wrapped && TRANSIENT_CODES.has(wrapped);
}

export async function retryTransient<T>(work: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (attempt >= attempts || !isTransientLockError(e)) throw e;
      console.warn(`retrying after a transient lock error (attempt ${attempt} of ${attempts}):`, (e as Error).message);
    }
  }
}
