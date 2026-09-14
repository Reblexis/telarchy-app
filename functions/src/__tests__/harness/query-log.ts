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
  /** The bound values, so a test can run EXPLAIN on the statement it caught. */
  values: unknown[];
}

export function captureQueries(): { stop: () => QueryStat[]; stats: QueryStat[] } {
  const client = globalThis.__getTestDbShared().client as PGlite & {
    query: (...args: unknown[]) => Promise<{ rows?: unknown[] }>;
  };
  const original = client.query;
  const stats: QueryStat[] = [];
  client.query = async function (this: unknown, ...args: unknown[]) {
    const sql = String(args[0]);
    const values = Array.isArray(args[1]) ? (args[1] as unknown[]) : [];
    const params = values.length;
    const result = await original.apply(client, args);
    stats.push({ sql, params, rows: Array.isArray(result?.rows) ? result.rows.length : 0, values });
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

interface PlanNode {
  'Relation Name'?: string;
  'Actual Rows'?: number;
  'Actual Loops'?: number;
  'Rows Removed by Filter'?: number;
  'Rows Removed by Index Recheck'?: number;
  Plans?: PlanNode[];
}

/**
 * How many rows of `relation` a caught statement reads, found by running it
 * again under EXPLAIN ANALYZE: every scan node on that table, counting the
 * rows its filter threw away as read (both figures are per loop, hence the
 * loops). The shape of a read, "joins every book of the floor to show
 * twenty", is invisible in its answer and plain in this number. Call it after
 * `stop()`, or the EXPLAIN is logged as a statement of the run.
 */
export async function rowsRead(stat: QueryStat, relation: string): Promise<number> {
  const client = globalThis.__getTestDbShared().client as PGlite & {
    query: (...args: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  };
  const plan = await client.query(`EXPLAIN (ANALYZE, FORMAT JSON) ${stat.sql}`, stat.values);
  const root = (Object.values(plan.rows[0] as Record<string, unknown>)[0] as Array<{ Plan: PlanNode }>)[0].Plan;
  let read = 0;
  const walk = (node: PlanNode) => {
    if (node['Relation Name'] === relation) {
      const perLoop =
        (node['Actual Rows'] ?? 0) +
        (node['Rows Removed by Filter'] ?? 0) +
        (node['Rows Removed by Index Recheck'] ?? 0);
      read += perLoop * (node['Actual Loops'] ?? 1);
    }
    for (const child of node.Plans ?? []) walk(child);
  };
  walk(root);
  return read;
}
