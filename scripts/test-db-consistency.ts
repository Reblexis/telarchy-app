#!/usr/bin/env node
/**
 * Database consistency test suite.
 *
 * Verifies the local database matches the current Drizzle schema and
 * contains no orphaned/stale data. Run after applying all migrations.
 *
 * Usage:
 *   DATABASE_URL=postgres://telarchy:changeme@localhost:5432/telarchy node scripts/test-db-consistency.ts
 */

import pg from 'pg';

const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://telarchy:changeme@localhost:5432/telarchy';
const pool = new Pool({ connectionString: DATABASE_URL });

// ─── Runner ───────────────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  suite: string;
}
const results: TestResult[] = [];
let currentSuite = 'root';

async function suite(name: string, fn: () => Promise<void>): Promise<void> {
  const prev = currentSuite;
  currentSuite = name;
  console.log(`\n  ${name}`);
  try {
    await fn();
  } catch (e) {
    console.error(`  Suite setup failed: ${(e as Error).message}`);
  }
  currentSuite = prev;
}

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    results.push({ name, passed: true, suite: currentSuite });
    process.stdout.write(`    ✓ ${name}\n`);
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    results.push({ name, passed: false, error: msg, suite: currentSuite });
    process.stdout.write(`    ✗ ${name}\n      ${msg}\n`);
  }
}

function expect(actual: unknown) {
  const fail = (msg: string) => {
    throw new Error(msg);
  };
  return {
    toBe: (v: unknown) => {
      if (actual !== v) fail(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
    },
    toEqual: (v: unknown) => {
      if (JSON.stringify(actual) !== JSON.stringify(v))
        fail(`Expected ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
    },
    toBeGreaterThan: (n: number) => {
      if ((actual as number) <= n) fail(`Expected > ${n}, got ${actual}`);
    },
    toContain: (v: string) => {
      if (!(actual as string[]).includes(v)) fail(`Expected to contain ${v}, got ${JSON.stringify(actual)}`);
    },
    notToContain: (v: string) => {
      if ((actual as string[]).includes(v)) fail(`Expected not to contain ${v}, got ${JSON.stringify(actual)}`);
    },
  };
}

async function query(sql: string): Promise<pg.QueryResult> {
  return pool.query(sql);
}

async function getColumns(table: string): Promise<string[]> {
  const res = await query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '${table}' ORDER BY ordinal_position`,
  );
  return res.rows.map((r: { column_name: string }) => r.column_name);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const cols = await getColumns(table);
  return cols.includes(column);
}

async function countQuery(sql: string): Promise<number> {
  const res = await query(sql);
  return parseInt(res.rows[0].count, 10);
}

// ─── Schema definition (expected columns per table) ────────────────────────

const expectedSchema: Record<string, string[]> = {
  user: ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'],
  session: ['id', 'expires_at', 'token', 'created_at', 'updated_at', 'ip_address', 'user_agent', 'user_id'],
  account: [
    'id',
    'account_id',
    'provider_id',
    'user_id',
    'access_token',
    'refresh_token',
    'id_token',
    'access_token_expires_at',
    'refresh_token_expires_at',
    'scope',
    'password',
    'created_at',
    'updated_at',
  ],
  verification: ['id', 'identifier', 'value', 'expires_at', 'created_at', 'updated_at'],
  workspaces: [
    'id',
    'name',
    'created_by',
    'created_at',
    'visibility',
    'traded_volume',
    'auto_fund_new_markets',
    'new_market_liquidity_credits',
  ],
  agents: [
    'id',
    'api_key_hash',
    'role',
    'auth_user_id',
    'balance',
    'earned_betting',
    'spent_betting',
    'spent_tokens',
    'wallet_address',
    'withdrawn_usdc',
    'platform_admin',
    'intent',
    'created_at',
    'approved_at',
  ],
  agent_api_keys: ['hash', 'agent_id', 'workspace_id'],
  waitlist: ['email', 'created_at'],
  deposits: ['tx_hash', 'agent_id', 'from', 'usdc_amount', 'credits', 'buy_rate', 'created_at'],
  withdrawals: ['id', 'agent_id', 'credits', 'usdc_amount', 'to_address', 'tx_hash', 'created_at'],
  system_config: ['key', 'value'],
  metrics: [
    'id',
    'workspace_id',
    'name',
    'description',
    'value',
    'formula',
    'order',
    'time_preference',
    'market_range_max',
    'created_at',
    'updated_at',
  ],
  markets: [
    'id',
    'workspace_id',
    'metric_id',
    'metric_name',
    'target_date',
    'resolved',
    'resolved_at',
    'actual_value',
    'active',
    'voided',
    'created_at',
    'range_min',
    'range_max',
    'shares',
    'liquidity',
    'pool',
    'proposal_id',
  ],
  positions: ['id', 'workspace_id', 'agent_id', 'market_id', 'direction', 'shares', 'total_cost'],
  trades: ['id', 'workspace_id', 'agent_id', 'market_id', 'direction', 'shares', 'cost', 'created_at'],
  liquidity_events: [
    'id',
    'workspace_id',
    'market_id',
    'amount',
    'total_liquidity',
    'type',
    'agent_id',
    'pool_contribution',
    'created_at',
  ],
  proposals: [
    'id',
    'workspace_id',
    'proposed_by',
    'title',
    'description',
    'status',
    'conditional_market_ids',
    'created_at',
  ],
  proposal_messages: ['id', 'workspace_id', 'proposal_id', 'from', 'content', 'created_at'],
  updates: ['id', 'workspace_id', 'metric_name', 'old_value', 'new_value', 'description', 'timestamp'],
  metric_logs: ['id', 'workspace_id', 'metric_id', 'metric_name', 'value', 'timestamp'],
  events: ['id', 'workspace_id', 'type', 'data', 'timestamp'],
  permission_groups: ['id', 'workspace_id', 'name', 'type', 'description', 'member_ids', 'permissions', 'created_at'],
  hook_watcher: ['workspace_id', 'last_heartbeat', 'status'],
};

// ─── Tests ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\nDatabase Consistency Tests');
  console.log('='.repeat(60));

  await suite('Schema: tables exist', async () => {
    const res = await query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = res.rows.map((r: { table_name: string }) => r.table_name);

    for (const table of Object.keys(expectedSchema)) {
      await test(`table "${table}" exists`, async () => {
        expect(tables).toContain(table);
      });
    }
  });

  await suite('Schema: no extra columns (obsolete columns removed)', async () => {
    await test('workspaces has no custom_api_url column', async () => {
      expect(await columnExists('workspaces', 'custom_api_url')).toBe(false);
    });
    await test('workspaces has no default_half_life column', async () => {
      expect(await columnExists('workspaces', 'default_half_life')).toBe(false);
    });
    await test('workspaces has no utility_formula_auto column', async () => {
      expect(await columnExists('workspaces', 'utility_formula_auto')).toBe(false);
    });
    await test('metrics has no weight column', async () => {
      expect(await columnExists('metrics', 'weight')).toBe(false);
    });
    await test('agents has no owner_uid column', async () => {
      expect(await columnExists('agents', 'owner_uid')).toBe(false);
    });
    await test('permission_groups has no agent_ids column', async () => {
      expect(await columnExists('permission_groups', 'agent_ids')).toBe(false);
    });
    await test('permission_groups has no uids column', async () => {
      expect(await columnExists('permission_groups', 'uids')).toBe(false);
    });
  });

  await suite('Schema: columns match Drizzle schema exactly', async () => {
    for (const [table, expected] of Object.entries(expectedSchema)) {
      await test(`"${table}" columns match schema`, async () => {
        const actual = await getColumns(table);
        const extraCols = actual.filter(c => !expected.includes(c));
        const missingCols = expected.filter(c => !actual.includes(c));
        if (extraCols.length > 0 || missingCols.length > 0) {
          const parts: string[] = [];
          if (extraCols.length) parts.push(`extra: ${extraCols.join(', ')}`);
          if (missingCols.length) parts.push(`missing: ${missingCols.join(', ')}`);
          throw new Error(parts.join('; '));
        }
      });
    }
  });

  await suite('Referential integrity: no orphaned data', async () => {
    await test('no markets referencing deleted metrics', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM markets m
        WHERE NOT EXISTS (SELECT 1 FROM metrics met WHERE met.id = m.metric_id AND met.workspace_id = m.workspace_id)
      `);
      expect(count).toBe(0);
    });

    await test('no positions referencing deleted markets', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM positions p
        WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = p.market_id AND m.workspace_id = p.workspace_id)
      `);
      expect(count).toBe(0);
    });

    await test('no trades referencing deleted markets', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM trades t
        WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = t.market_id AND m.workspace_id = t.workspace_id)
      `);
      expect(count).toBe(0);
    });

    await test('no api keys referencing non-existent workspaces', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM agent_api_keys ak
        WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ak.workspace_id)
      `);
      expect(count).toBe(0);
    });

    await test('no agents referencing non-existent auth users', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM agents a
        WHERE a.auth_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "user" u WHERE u.id = a.auth_user_id)
      `);
      expect(count).toBe(0);
    });
  });

  await suite('Data cleanliness: no bogus workspace references', async () => {
    await test('no metrics with workspace_id "undefined"', async () => {
      const count = await countQuery(`SELECT count(*) FROM metrics WHERE workspace_id = 'undefined'`);
      expect(count).toBe(0);
    });

    await test('no markets with workspace_id "undefined"', async () => {
      const count = await countQuery(`SELECT count(*) FROM markets WHERE workspace_id = 'undefined'`);
      expect(count).toBe(0);
    });

    await test('no events with workspace_id "undefined"', async () => {
      const count = await countQuery(`SELECT count(*) FROM events WHERE workspace_id = 'undefined'`);
      expect(count).toBe(0);
    });

    await test('all workspace_ids in markets reference existing workspaces', async () => {
      const count = await countQuery(`
        SELECT count(DISTINCT m.workspace_id) FROM markets m
        WHERE NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = m.workspace_id)
      `);
      expect(count).toBe(0);
    });
  });

  await suite('Data cleanliness: no stale system state', async () => {
    await test('no expired market refresh locks in system_config', async () => {
      // Locks with expiresAt in the past are stale; active locks are fine
      const nowMs = Date.now();
      const count = await countQuery(`
        SELECT count(*) FROM system_config
        WHERE key LIKE 'lock:marketRefresh:%'
          AND (value->>'expiresAt')::bigint < ${nowMs}
      `);
      expect(count).toBe(0);
    });

    await test('no expired sessions', async () => {
      const count = await countQuery(`SELECT count(*) FROM session WHERE expires_at < NOW()`);
      expect(count).toBe(0);
    });
  });

  await suite('Data consistency: logical invariants', async () => {
    await test('voided markets are not active', async () => {
      const count = await countQuery(`SELECT count(*) FROM markets WHERE voided = true AND active = true`);
      expect(count).toBe(0);
    });

    await test('resolved markets are not active', async () => {
      const count = await countQuery(`SELECT count(*) FROM markets WHERE resolved = true AND active = true`);
      expect(count).toBe(0);
    });

    await test('no positions with zero or negative shares', async () => {
      const count = await countQuery(`SELECT count(*) FROM positions WHERE shares <= 0`);
      expect(count).toBe(0);
    });

    await test('permission group member_ids are arrays', async () => {
      const count = await countQuery(
        `SELECT count(*) FROM permission_groups WHERE jsonb_typeof(member_ids) != 'array'`,
      );
      expect(count).toBe(0);
    });

    await test('permission group permissions are objects', async () => {
      const count = await countQuery(
        `SELECT count(*) FROM permission_groups WHERE jsonb_typeof(permissions) != 'object'`,
      );
      expect(count).toBe(0);
    });

    await test('market shares are two-element arrays', async () => {
      const count = await countQuery(`SELECT count(*) FROM markets WHERE jsonb_array_length(shares) != 2`);
      expect(count).toBe(0);
    });

    await test('agent balances are non-negative', async () => {
      const count = await countQuery(`SELECT count(*) FROM agents WHERE balance < 0`);
      expect(count).toBe(0);
    });
  });

  await suite('Data consistency: liquidity events match market state', async () => {
    await test('no liquidity events referencing non-existent markets', async () => {
      const count = await countQuery(`
        SELECT count(*) FROM liquidity_events le
        WHERE NOT EXISTS (SELECT 1 FROM markets m WHERE m.id = le.market_id AND m.workspace_id = le.workspace_id)
      `);
      expect(count).toBe(0);
    });
  });

  // ─── Summary ──────────────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(60));
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  console.log(`\n  ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    console.log('  Failed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`    [${r.suite}] ${r.name}: ${r.error}`);
    }
    console.log('');
  }

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
