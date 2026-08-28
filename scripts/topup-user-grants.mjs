#!/usr/bin/env node
/**
 * One-time top-up of USER accounts to the new signup grant (owner decision
 * 2026-08-28: every user signup starts with 10,000 credits, and existing
 * users are topped up to the same; design record in the telarchy umbrella,
 * notes/trader-rewards-design-2026-08-28.md).
 *
 * For every participant with a browser account (agents.auth_user_id set),
 * sum their base signup grants (credit_ledger reason 'signup_grant',
 * EXCLUDING Manifold-import rows, whose ref_id starts with 'manifold:' and
 * which are a separate priced signal) and grant the difference up to the
 * target. Idempotent: the top-up itself is a signup_grant row (ref_id
 * 'grant-schedule-2026-08-28'), so a second run computes a zero difference.
 * Accounts already at or above the target (e.g. via env-configured larger
 * grants) are left alone. API-only participants (no auth_user_id) are not
 * touched: their grant is 0 by design.
 *
 * Grants never enter profit or any season score (the boards are
 * grant-blind), so this moves no standing.
 *
 *   DATABASE_URL=... node scripts/topup-user-grants.mjs [--dry-run] [--target 10000]
 */

import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Client } = pg;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');
const targetArg = process.argv.indexOf('--target');
const TARGET_CREDITS = targetArg > -1 ? Number(process.argv[targetArg + 1]) : 10000;
if (!Number.isFinite(TARGET_CREDITS) || TARGET_CREDITS <= 0) {
  console.error(`invalid --target ${process.argv[targetArg + 1]}`);
  process.exit(1);
}
const UNITS = 1_000_000_000; // CREDIT_PRECISION, nanocredits per credit
const TARGET_UNITS = TARGET_CREDITS * UNITS;
const PLATFORM_SCOPE = 'platform';
const REF_ID = 'grant-schedule-2026-08-28';

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();

const users = (
  await client.query(`
    select a.id,
           coalesce(sum(l.delta_units) filter (
             where l.reason = 'signup_grant'
               and (l.ref_id is null or l.ref_id not like 'manifold:%')
           ), 0) as base_grant_units
    from agents a
    left join credit_ledger l on l.agent_id = a.id
    where a.auth_user_id is not null
    group by a.id
    order by a.id
  `)
).rows;

let topped = 0;
let skipped = 0;
for (const row of users) {
  const missingUnits = TARGET_UNITS - Number(row.base_grant_units);
  if (missingUnits <= 0) {
    skipped += 1;
    continue;
  }
  if (dryRun) {
    console.log(`would top up ${row.id} by ${missingUnits / UNITS} credits`);
    topped += 1;
    continue;
  }
  // Same shape applyCredits (services/credits.ts) writes: lock the agent
  // row, move the balance, record the row with the balance it produced.
  await client.query('begin');
  try {
    const {
      rows: [agent],
    } = await client.query('update agents set balance = balance + $1 where id = $2 returning balance', [
      missingUnits,
      row.id,
    ]);
    await client.query(
      `insert into credit_ledger (id, workspace_id, agent_id, delta_units, balance_after_units, reason, ref_type, ref_id)
       values ($1, $2, $3, $4, $5, 'signup_grant', null, $6)`,
      [randomUUID(), PLATFORM_SCOPE, row.id, missingUnits, Number(agent.balance), REF_ID],
    );
    await client.query('commit');
    console.log(`topped up ${row.id} by ${missingUnits / UNITS} credits`);
    topped += 1;
  } catch (e) {
    await client.query('rollback');
    throw e;
  }
}

console.log(
  `${dryRun ? '[dry-run] ' : ''}done: ${topped} topped up, ${skipped} already at target, of ${users.length} user accounts`,
);
await client.end();
