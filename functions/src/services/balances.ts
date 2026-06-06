import { sql } from 'drizzle-orm';
import { db } from '../db/client';

/**
 * Write today's (UTC) balance snapshot for every participant that doesn't
 * have one yet. Called from the hourly resolve cron; the composite PK makes
 * it idempotent, so only the first run of each UTC day actually inserts.
 * Snapshots exist because balance mutations have no unified ledger
 * (resolution payouts, LP leftovers, credit grants update agents.balance in
 * place), so the balance graph on the public profile cannot be reconstructed
 * retroactively. Balances are stored in nanocredits, like agents.balance.
 */
export async function snapshotAgentBalances(now: Date = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  const result = await db.execute(sql`
    INSERT INTO agent_balance_snapshots (agent_id, day, balance)
    SELECT id, ${day}, balance FROM agents
    ON CONFLICT (agent_id, day) DO NOTHING
  `);
  // node-postgres reports rowCount; pglite (tests/self-host) reports affectedRows.
  const r = result as { rowCount?: number; affectedRows?: number };
  return r.rowCount ?? r.affectedRows ?? 0;
}
