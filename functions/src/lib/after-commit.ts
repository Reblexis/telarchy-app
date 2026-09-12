import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Work that must wait until a transaction COMMITS (docs/infra/deploy.md,
 * "Prices, one channel across instances").
 *
 * The price version of a floor has to move when the write that changed a
 * price is visible to a reader, not while it is still inside its
 * transaction: a read landing between the two would see the old book, cache
 * it under the new version, and keep serving it until some later write moved
 * the version again. Every write path already says "prices changed" from
 * inside its transaction (lib/market-events.ts), so the deferral lives here,
 * once, rather than at each of them.
 *
 *   db.transaction(cb) ─▶ scope { hooks } ─▶ cb runs, afterCommit(fn) queues
 *                                 │
 *                commit ──────────┴─▶ hooks run, in order
 *                rollback ────────────▶ hooks dropped
 *
 * A savepoint (`tx.transaction`) runs inside its outer scope, so its work
 * waits for the outer commit. Outside any transaction there is nothing to
 * wait for and the work runs at once. Work queued after a scope has finished
 * (by something the transaction started and did not await) also runs at
 * once: late is harmless, lost is not.
 */

interface Scope {
  hooks: Array<() => void>;
  done: boolean;
}

const scopes = new AsyncLocalStorage<Scope>();

function runHook(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('after-commit hook failed:', e);
  }
}

/** Run `fn` once the enclosing transaction commits; at once when there is none. */
export function afterCommit(fn: () => void): void {
  const scope = scopes.getStore();
  if (!scope || scope.done) {
    runHook(fn);
    return;
  }
  scope.hooks.push(fn);
}

async function committed<R>(run: () => Promise<R>): Promise<R> {
  const scope: Scope = { hooks: [], done: false };
  let result: R;
  try {
    result = await scopes.run(scope, run);
  } catch (e) {
    scope.done = true;
    scope.hooks = [];
    throw e;
  }
  scope.done = true;
  const hooks = scope.hooks;
  scope.hooks = [];
  for (const hook of hooks) runHook(hook);
  return result;
}

/**
 * The same database handle, whose `transaction` opens a commit scope. Every
 * other property passes straight through.
 */
export function withCommitHooks<T extends object>(db: T): T {
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (prop === 'transaction' && typeof value === 'function') {
        return (...args: unknown[]) =>
          committed(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      }
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}
