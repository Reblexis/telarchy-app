/**
 * The advisory-lock job singleton (lib/singleton-jobs.ts): with up to 4 prod
 * and 4 candidate instances all arming every timer, exactly one may do the
 * work per tick, the lock must always be released, and the dedicated client
 * must go back to the pool even when the job throws (a leaked client is a
 * fifth of an instance's connection budget).
 */

const query = jest.fn();
const release = jest.fn();
jest.mock('../db/client', () => ({
  pool: { connect: jest.fn(async () => ({ query, release })) },
}));

import { LOCK_KEYS, withSingletonLock } from '../lib/singleton-jobs';

beforeEach(() => {
  query.mockReset();
  release.mockReset();
});

function lockAnswer(locked: boolean) {
  query.mockImplementation(async (text: string) => {
    if (String(text).includes('pg_try_advisory_lock')) return { rows: [{ locked }] };
    return { rows: [] };
  });
}

describe('withSingletonLock', () => {
  it('runs the job when it wins the lock, then unlocks and releases', async () => {
    lockAnswer(true);
    const fn = jest.fn(async () => {});
    expect(await withSingletonLock('limitSweep', fn)).toBe('ran');
    expect(fn).toHaveBeenCalledTimes(1);
    const calls = query.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('pg_advisory_unlock'))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('skips without running when another instance holds the lock', async () => {
    lockAnswer(false);
    const fn = jest.fn(async () => {});
    expect(await withSingletonLock('limitSweep', fn)).toBe('skipped');
    expect(fn).not.toHaveBeenCalled();
    const calls = query.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('pg_advisory_unlock'))).toBe(false);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('unlocks and releases the client even when the job throws', async () => {
    lockAnswer(true);
    await expect(
      withSingletonLock('resolve', async () => {
        throw new Error('job died');
      }),
    ).rejects.toThrow('job died');
    const calls = query.mock.calls.map(c => String(c[0]));
    expect(calls.some(c => c.includes('pg_advisory_unlock'))).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('passes the job-specific key to the lock', async () => {
    lockAnswer(true);
    await withSingletonLock('dailyMaintenance', async () => {});
    const lockCall = query.mock.calls.find(c => String(c[0]).includes('pg_try_advisory_lock'));
    expect(lockCall?.[1]).toEqual([LOCK_KEYS.dailyMaintenance]);
  });

  it('lock keys never collide', () => {
    const values = Object.values(LOCK_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});
