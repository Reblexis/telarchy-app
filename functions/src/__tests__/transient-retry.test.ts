/**
 * A decision never fails on a deadlock (docs/guides/proposals.md, 'The
 * deadline, and the close'). Postgres ends one side of a lock cycle with
 * 40P01 and rolls its transaction back whole, so running the transaction again
 * is safe and is what makes the decision stand. On 2026-09-13 a snake approve
 * died on exactly this error and the move was declined.
 */

import { isTransientLockError, retryTransient } from '../lib/transient-retry';

function pgError(code: string, message = 'boom'): Error {
  return Object.assign(new Error(message), { code });
}

/** Drizzle wraps the driver's error and keeps it as `cause`. */
function wrapped(code: string): Error {
  return Object.assign(new Error('Failed query: select ...'), {
    cause: pgError(code, 'deadlock detected'),
  });
}

describe('which errors are retried', () => {
  test('a deadlock is transient', () => {
    expect(isTransientLockError(pgError('40P01'))).toBe(true);
  });
  test('a serialization failure is transient', () => {
    expect(isTransientLockError(pgError('40001'))).toBe(true);
  });
  test('a deadlock wrapped by the query builder is still transient', () => {
    expect(isTransientLockError(wrapped('40P01'))).toBe(true);
  });
  test('anything else is not', () => {
    expect(isTransientLockError(pgError('23505'))).toBe(false);
    expect(isTransientLockError(new Error('Market not found'))).toBe(false);
    expect(isTransientLockError(undefined)).toBe(false);
    expect(isTransientLockError(null)).toBe(false);
    expect(isTransientLockError('40P01')).toBe(false);
  });
});

describe('retryTransient', () => {
  test('a decision survives a deadlock: the work runs again and its answer is returned', async () => {
    let calls = 0;
    const result = await retryTransient(async () => {
      calls += 1;
      if (calls === 1) throw wrapped('40P01');
      return 'decided';
    });
    expect(result).toBe('decided');
    expect(calls).toBe(2);
  });

  test('work that succeeds first time runs once', async () => {
    let calls = 0;
    await retryTransient(async () => {
      calls += 1;
    });
    expect(calls).toBe(1);
  });

  test('an ordinary error is thrown at once, never retried', async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls += 1;
        throw pgError('23505', 'duplicate key');
      }),
    ).rejects.toThrow('duplicate key');
    expect(calls).toBe(1);
  });

  test('a deadlock that keeps happening gives up after the last attempt and throws it', async () => {
    let calls = 0;
    await expect(
      retryTransient(async () => {
        calls += 1;
        throw pgError('40P01', `deadlock ${calls}`);
      }, 3),
    ).rejects.toThrow('deadlock 3');
    expect(calls).toBe(3);
  });
});
