/**
 * Work that must wait for a transaction to COMMIT (docs/infra/deploy.md,
 * "Prices, one channel across instances").
 *
 * The price version of a floor moves when a price-changing transaction
 * commits, never inside it: a read that arrived between the emit and the
 * commit would otherwise read the old book and cache it under the new
 * version, and nothing would ever move the version again to evict it. These
 * tests pin the hook that makes "after commit" a thing a write path can say.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { afterCommit } from '../lib/after-commit';
import { db, ensureMigrations } from './harness/test-db';

beforeAll(async () => {
  await ensureMigrations();
});

describe('afterCommit', () => {
  test('outside any transaction the work runs at once, because there is nothing to wait for', () => {
    const ran: string[] = [];
    afterCommit(() => ran.push('now'));
    expect(ran).toEqual(['now']);
  });

  test('WORK DEFERRED TO COMMIT RUNS AFTER THE COMMIT, NOT INSIDE THE TRANSACTION', async () => {
    const ran: string[] = [];
    await db.transaction(async tx => {
      afterCommit(() => ran.push('hook'));
      await tx.execute('select 1');
      // Still inside: nothing has run.
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['hook']);
  });

  test('A TRANSACTION THAT ROLLS BACK RUNS NONE OF ITS DEFERRED WORK', async () => {
    const ran: string[] = [];
    await expect(
      db.transaction(async () => {
        afterCommit(() => ran.push('hook'));
        throw new Error('roll back');
      }),
    ).rejects.toThrow('roll back');
    expect(ran).toEqual([]);
  });

  test('a savepoint belongs to its outer transaction: its work waits for the outer commit', async () => {
    const ran: string[] = [];
    await db.transaction(async tx => {
      await tx.transaction(async () => {
        afterCommit(() => ran.push('inner'));
      });
      expect(ran).toEqual([]);
    });
    expect(ran).toEqual(['inner']);
  });

  test('work queued by something the transaction started but did not await runs at once, never lost', async () => {
    const ran: string[] = [];
    let later: (() => void) | null = null;
    await db.transaction(async () => {
      later = () => afterCommit(() => ran.push('late'));
    });
    expect(ran).toEqual([]);
    (later as unknown as () => void)();
    expect(ran).toEqual(['late']);
  });

  test('a failing hook is logged and does not stop the others', async () => {
    const ran: string[] = [];
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await db.transaction(async () => {
      afterCommit(() => {
        throw new Error('boom');
      });
      afterCommit(() => ran.push('second'));
    });
    expect(ran).toEqual(['second']);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
