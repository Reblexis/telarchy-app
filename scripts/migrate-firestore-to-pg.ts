/**
 * Firestore → PostgreSQL migration script.
 *
 * Reads workspace data from a Firestore project and inserts it into a
 * PostgreSQL database that has been migrated via `npm run db:migrate`.
 *
 * This script migrates workspace DATA only (metrics, markets, agents, etc.).
 * User authentication records are NOT migrated. Users must sign up fresh
 * via BetterAuth. After running this script, add yourself as workspace owner
 * using the instructions printed at the end.
 *
 * Prerequisites:
 *   1. Run `npm run db:migrate` in functions/ to create the schema.
 *   2. Set GOOGLE_APPLICATION_CREDENTIALS to a Firebase service account JSON
 *      with Firestore read access (roles/datastore.viewer or higher).
 *      Download from: Firebase Console → Project Settings → Service Accounts.
 *   3. Set FIRESTORE_PROJECT_ID to the source Firebase project ID (e.g. vcihal).
 *   4. Set DATABASE_URL to the target PostgreSQL connection string.
 *
 * Usage (run from the functions/ directory):
 *   FIRESTORE_PROJECT_ID=vcihal \
 *   DATABASE_URL=postgres://telarchy:changeme@localhost:5432/telarchy \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
 *   npx ts-node ../scripts/migrate-firestore-to-pg.ts
 */

import * as admin from 'firebase-admin';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../functions/src/db/schema';
import { toUnits } from '../functions/src/lib/validation';

const projectId = process.env.FIRESTORE_PROJECT_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!projectId) { console.error('FIRESTORE_PROJECT_ID is required'); process.exit(1); }
if (!databaseUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

admin.initializeApp({ projectId });
const firestore = admin.firestore();

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

type Timestamp = admin.firestore.Timestamp;

function toDate(v: Timestamp | null | undefined): Date {
  if (!v) return new Date();
  return v.toDate();
}

/** Convert Firestore shares field to [lower, higher] tuple. */
function toSharesTuple(shares: unknown): [number, number] {
  if (Array.isArray(shares) && shares.length === 2) {
    return [Number(shares[0]) || 0, Number(shares[1]) || 0];
  }
  if (shares && typeof shares === 'object') {
    const s = shares as Record<string, number>;
    return [Number(s.lower ?? s[0]) || 0, Number(s.higher ?? s[1]) || 0];
  }
  return [0, 0];
}

/** Get collection reference: handles both default (top-level) and other workspaces. */
function wsCollection(workspaceId: string, collName: string) {
  return workspaceId === 'default'
    ? firestore.collection(collName)
    : firestore.collection(`workspaces/${workspaceId}/${collName}`);
}

async function migrateWorkspace(workspaceId: string, workspaceName: string, createdBy: string) {
  console.log(`\nMigrating workspace: ${workspaceId} (${workspaceName})`);

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: workspaceName,
    visibility: 'private',
    createdBy,
    createdAt: new Date(),
  }).onConflictDoNothing();
  console.log(`  ✓ workspace row`);

  // Metrics
  const metricsSnap = await wsCollection(workspaceId, 'metrics').get();
  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.metrics).values({
      id: doc.id,
      workspaceId,
      name: d.name ?? '',
      description: d.description ?? '',
      value: d.value ?? 0,
      formula: d.formula ?? '0',
      order: d.order ?? 0,
      timePreference: d.timePreference ?? null,
      marketRangeMax: d.marketRangeMax ?? null,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt ?? d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${metricsSnap.size} metrics`);

  // Markets
  const marketsSnap = await wsCollection(workspaceId, 'markets').get();
  for (const doc of marketsSnap.docs) {
    const d = doc.data();
    const liquidity = d.liquidity ?? 0;
    // Old AMM stored pool separately; fall back to liquidity as the b parameter
    const pool = d.pool ?? liquidity;
    await db.insert(schema.markets).values({
      id: doc.id,
      workspaceId,
      metricId: d.metricId ?? '',
      metricName: d.metricName ?? '',
      targetDate: d.targetDate ?? '',
      resolved: d.resolved ?? false,
      resolvedAt: d.resolvedAt ? toDate(d.resolvedAt) : null,
      actualValue: d.actualValue ?? null,
      active: d.active ?? true,
      voided: d.voided ?? false,
      rangeMin: d.rangeMin ?? 0,
      rangeMax: d.rangeMax ?? 1000,
      shares: toSharesTuple(d.shares),
      liquidity,
      pool,
      proposalId: d.proposalId ?? null,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${marketsSnap.size} markets`);

  // Positions
  const positionsSnap = await wsCollection(workspaceId, 'positions').get();
  for (const doc of positionsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.positions).values({
      id: doc.id,
      workspaceId,
      marketId: d.marketId ?? '',
      agentId: d.agentId ?? '',
      direction: d.direction ?? 'higher',
      shares: d.shares ?? 0,
      totalCost: d.totalCost ?? 0,
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${positionsSnap.size} positions`);

  // Trades
  const tradesSnap = await wsCollection(workspaceId, 'trades').get();
  for (const doc of tradesSnap.docs) {
    const d = doc.data();
    await db.insert(schema.trades).values({
      id: doc.id,
      workspaceId,
      marketId: d.marketId ?? '',
      agentId: d.agentId ?? '',
      direction: d.direction ?? 'higher',
      shares: d.shares ?? 0,
      cost: d.cost ?? 0,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${tradesSnap.size} trades`);

  // Proposals
  const proposalsSnap = await wsCollection(workspaceId, 'proposals').get();
  for (const doc of proposalsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.proposals).values({
      id: doc.id,
      workspaceId,
      proposedBy: d.proposedBy ?? '',
      title: d.title ?? '',
      description: d.description ?? '',
      status: d.status ?? 'pending',
      conditionalMarketIds: d.conditionalMarketIds ?? [],
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${proposalsSnap.size} proposals`);

  // Updates (metric change log)
  const updatesSnap = await wsCollection(workspaceId, 'updates').get();
  for (const doc of updatesSnap.docs) {
    const d = doc.data();
    await db.insert(schema.updates).values({
      id: doc.id,
      workspaceId,
      metricName: d.metricName ?? '',
      oldValue: d.oldValue ?? 0,
      newValue: d.newValue ?? 0,
      description: d.description ?? '',
      timestamp: toDate(d.timestamp ?? d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${updatesSnap.size} updates`);

  // Permission groups
  const groupsSnap = await wsCollection(workspaceId, 'permissionGroups').get();
  for (const doc of groupsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.permissionGroups).values({
      id: doc.id,
      workspaceId,
      name: d.name ?? '',
      type: d.type ?? 'custom',
      description: d.description ?? '',
      agentIds: d.agentIds ?? [],
      uids: d.uids ?? [],
      permissions: d.permissions ?? {},
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${groupsSnap.size} permission groups`);
}

async function migrateAgents() {
  console.log('\nMigrating agents...');
  const snap = await firestore.collection('agents').get();
  let migrated = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    const keyHash = d.apiKeyHash ?? d.apiKey;
    if (!keyHash) {
      console.warn(`  ⚠ agent ${doc.id} has no API key hash; skipping`);
      continue;
    }
    await db.insert(schema.agents).values({
      id: doc.id,
      apiKeyHash: keyHash,
      role: d.role ?? 'agent',
      // balance is bigint nanocredits; old Firestore stored as decimal credits
      balance: toUnits(d.balance ?? 0),
      // These stats are doublePrecision floats, stored as raw credits
      earnedBetting: d.earnedBetting ?? 0,
      spentBetting: d.spentBetting ?? 0,
      spentTokens: d.spentTokens ?? 0,
      walletAddress: d.walletAddress ?? null,
      withdrawnUsdc: d.withdrawnUsdc ?? 0,
      ownerUid: d.ownerUid ?? null,
      createdAt: toDate(d.createdAt),
      approvedAt: d.approvedAt ? toDate(d.approvedAt) : null,
    }).onConflictDoNothing();

    await db.insert(schema.agentApiKeys).values({
      hash: keyHash,
      agentId: doc.id,
      workspaceId: 'default',
    }).onConflictDoNothing();

    migrated++;
  }
  console.log(`  ✓ ${migrated} agents`);
}

async function main() {
  console.log(`Migrating from Firestore project: ${projectId}`);
  console.log(`Target: ${databaseUrl!.replace(/:[^:@]+@/, ':***@')}\n`);

  await migrateAgents();

  // Discover non-default workspaces
  const wsSnap = await firestore.collection('workspaces').get();
  const nonDefaultWorkspaces = wsSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Always migrate the default workspace (top-level collections)
  const defaultMetrics = await firestore.collection('metrics').get();
  const hasDefaultData = defaultMetrics.size > 0;

  const PLACEHOLDER_CREATOR = 'migrated';

  if (hasDefaultData) {
    await migrateWorkspace('default', 'Default', PLACEHOLDER_CREATOR);
  }

  console.log(`\nFound ${nonDefaultWorkspaces.length} additional workspaces`);
  for (const ws of nonDefaultWorkspaces) {
    await migrateWorkspace(ws.id, (ws as Record<string, string>).name ?? ws.id, PLACEHOLDER_CREATOR);
  }

  console.log('\n✓ Migration complete!');
  console.log('\n─────────────────────────────────────────────────────────────────');
  console.log('NEXT STEPS:');
  console.log('1. Start your Telarchy server (docker-compose up or node lib/server.js)');
  console.log('2. Sign up at http://localhost:8080/signup with your email');
  console.log('3. Get your user ID from the account page or the /api/auth/me endpoint');
  console.log('4. Add yourself as workspace owner using the master API key:');
  console.log('');
  console.log('   curl -s -X POST http://localhost:8080/api/workspaces/default/members \\');
  console.log('     -H "X-API-Key: $API_KEY" -H "X-Workspace-Id: default" \\');
  console.log('     -H "Content-Type: application/json" \\');
  console.log('     -d \'{"userId":"<YOUR_USER_ID>","role":"owner"}\'');
  console.log('');
  console.log('   (Repeat for each workspace you want to own)');
  console.log('─────────────────────────────────────────────────────────────────');

  await pool.end();
}

main().catch(err => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
