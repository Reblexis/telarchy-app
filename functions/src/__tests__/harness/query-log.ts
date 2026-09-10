/**
 * A log of every SQL statement the test database ran, with the number of
 * bound parameters and the number of rows it answered.
 *
 * Why this exists: the Snake load audit (telarchy umbrella,
 * notes/snake-load-audit-2026-09-10.md) found reads whose SHAPE was the bug,
 * not their answer: an `IN (<every market id>)` list that grows with the
 * table and throws past Postgres's 65,535-parameter cap, or a select that
 * pulls every market of a workspace into the process to use twenty of them.
 * A test that only checks the answer stays green while that happens. This
 * wraps the pglite client's `query`, which is the one method drizzle's
 * pglite driver calls, so a test can assert "no statement bound more than N
 * parameters" and "no statement returned more than M rows" over a run.
 *
 * Usage:
 *
 *   const log = captureQueries();
 *   await loadBoard(ids);
 *   const stats = log.stop();
 *   expect(Math.max(...stats.map(s => s.params))).toBeLessThanOrEqual(20);
 */

import type { PGlite } from '@electric-sql/pglite';

export interface QueryStat {
  sql: string;
  params: number;
  rows: number;
}

export function captureQueries(): { stop: () => QueryStat[]; stats: QueryStat[] } {
  const client = globalThis.__getTestDbShared().client as PGlite & {
    query: (...args: unknown[]) => Promise<{ rows?: unknown[] }>;
  };
  const original = client.query;
  const stats: QueryStat[] = [];
  client.query = async function (this: unknown, ...args: unknown[]) {
    const sql = String(args[0]);
    const params = Array.isArray(args[1]) ? (args[1] as unknown[]).length : 0;
    const result = await original.apply(client, args);
    stats.push({ sql, params, rows: Array.isArray(result?.rows) ? result.rows.length : 0 });
    return result;
  } as typeof client.query;
  return {
    stats,
    stop: () => {
      client.query = original;
      return stats;
    },
  };
}

/** The widest statement of a run, for a failure message that names it. */
export function widest(stats: QueryStat[]): QueryStat | null {
  return stats.reduce<QueryStat | null>((best, s) => (best === null || s.params > best.params ? s : best), null);
}

/** The statement that answered the most rows, for the same reason. */
export function largest(stats: QueryStat[]): QueryStat | null {
  return stats.reduce<QueryStat | null>((best, s) => (best === null || s.rows > best.rows ? s : best), null);
}
