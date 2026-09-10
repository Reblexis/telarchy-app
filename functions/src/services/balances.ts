import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { agentBalanceSnapshots, workspaces } from '../db/schema';
import { loadBoard } from '../lib/board';

/**
 * Write today's (UTC) snapshot for every participant that doesn't have one
 * yet: the balance, and the trading profit the board scores them at right
 * now. Called from the hourly resolve cron; the composite PK makes it
 * idempotent, so only the first run of each UTC day actually inserts, and
 * the profit is written only onto rows that do not carry one yet, so the
 * day's number is the first hour's and never drifts under later runs.
 * Snapshots exist because balance mutations have no unified ledger
 * (resolution payouts, LP leftovers, credit grants update agents.balance in
 * place), so the balance graph on the public profile cannot be reconstructed
 * retroactively; the profit could be, but not at the prices of that day,
 * which is what a reader wants to see. Balances are stored in nanocredits,
 * like agents.balance; profit in credits, like the board.
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
  const inserted = r.rowCount ?? r.affectedRows ?? 0;

  // Only the first run of a day has rows without a profit; every later run
  // (this is called from every resolve tick) must find that out BEFORE
  // paying for the board, which is five aggregates over the whole trades
  // table (telarchy umbrella, notes/snake-load-audit-2026-09-10.md, item 7).
  const pending = await db
    .select({ agentId: agentBalanceSnapshots.agentId })
    .from(agentBalanceSnapshots)
    .where(and(eq(agentBalanceSnapshots.day, day), isNull(agentBalanceSnapshots.profit)));
  if (pending.length === 0) return inserted;

  // The board over every public floor, the same aggregation /api/leaderboard
  // serves. A participant the board does not know scored nothing: zero, not
  // null, because null means "not recorded" (docs/ui-conventions.md).
  const publicWs = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.visibility, 'public'));
  const board = await loadBoard(publicWs.map(w => w.id));
  for (const row of pending) {
    await db
      .update(agentBalanceSnapshots)
      .set({ profit: board.profitById.get(row.agentId) ?? 0 })
      .where(
        and(
          eq(agentBalanceSnapshots.agentId, row.agentId),
          eq(agentBalanceSnapshots.day, day),
          isNull(agentBalanceSnapshots.profit),
        ),
      );
  }
  return inserted;
}
