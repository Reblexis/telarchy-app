#!/usr/bin/env node
/**
 * Pay one fault refund: the platform repaying what its own fault cost a
 * holder on one market (docs/market-integrity.md, the `fault_refund` reason;
 * the board counts it as money back on that market, docs/ui-conventions.md,
 * "Top traders").
 *
 * One ledger row with reason 'fault_refund', ref_type 'market', ref_id the
 * market, in the market's workspace, written in the same transaction as the
 * balance change. Idempotent per (agent, market): a second run finds the row
 * and writes nothing. Refused when the amount exceeds what the holder is
 * down on the market: a refund brings a market back to zero, never above.
 *
 *   DATABASE_URL=... node scripts/pay-fault-refund.mjs --agent <id> --market <id> --credits <n> [--dry-run]
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const UNITS = 1_000_000_000; // CREDIT_PRECISION, nanocredits per credit

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const agentId = arg('agent');
const marketId = arg('market');
const credits = Number(arg('credits'));
const dryRun = process.argv.includes('--dry-run');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
if (!agentId || !marketId || !Number.isFinite(credits) || credits <= 0) {
  console.error('usage: --agent <id> --market <id> --credits <positive number> [--dry-run]');
  process.exit(1);
}
const deltaUnits = Math.round(credits * UNITS);

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query('begin');
  const market = (await client.query('select id, workspace_id from markets where id = $1', [marketId])).rows[0];
  if (!market) throw new Error(`market ${marketId} not found`);
  const agent = (await client.query('select id, balance from agents where id = $1 for update', [agentId])).rows[0];
  if (!agent) throw new Error(`agent ${agentId} not found`);
  const existing = (
    await client.query(
      `select id, delta_units from credit_ledger
       where agent_id = $1 and reason = 'fault_refund' and ref_type = 'market' and ref_id = $2`,
      [agentId, marketId],
    )
  ).rows[0];
  if (existing) {
    console.log(`already paid: ${agentId} on ${marketId}, ${Number(existing.delta_units) / UNITS} credits`);
    await client.query('rollback');
    process.exit(0);
  }
  // A REFUND NEVER EXCEEDS THE NET LOSS (docs/market-integrity.md): the
  // boards and the season count it as money back on this market, so the most
  // it may do is bring the market back to zero.
  const net = Number(
    (
      await client.query(
        `select coalesce(sum(delta_units), 0) as net from credit_ledger
         where agent_id = $1 and workspace_id = $2 and ref_type = 'market' and ref_id = $3`,
        [agentId, market.workspace_id, marketId],
      )
    ).rows[0].net,
  );
  if (deltaUnits > -net) {
    throw new Error(
      `refund of ${credits} exceeds the net loss of ${Math.max(0, -net) / UNITS} credits for ${agentId} on ${marketId}`,
    );
  }
  const after = Number(agent.balance) + deltaUnits;
  console.log(
    `${dryRun ? '[dry run] ' : ''}${agentId}: ${Number(agent.balance) / UNITS} -> ${after / UNITS} (+${credits}) on market ${marketId}`,
  );
  if (dryRun) {
    await client.query('rollback');
    process.exit(0);
  }
  await client.query('update agents set balance = balance + $1 where id = $2', [deltaUnits, agentId]);
  await client.query(
    `insert into credit_ledger (id, workspace_id, agent_id, delta_units, balance_after_units, reason, ref_type, ref_id)
     values ($1, $2, $3, $4, (select balance from agents where id = $3), 'fault_refund', 'market', $5)`,
    [randomUUID(), market.workspace_id, agentId, deltaUnits, marketId],
  );
  await client.query('commit');
  console.log('paid');
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(e.message);
  process.exit(1);
} finally {
  await client.end();
}
