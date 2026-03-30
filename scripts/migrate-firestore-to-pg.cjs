/**
 * CJS runner for the Firestore → PostgreSQL migration.
 * Imports from the compiled functions/lib/ so it requires no TypeScript tooling.
 *
 * Usage (from repo root, after `npm run build` in functions/):
 *   FIRESTORE_PROJECT_ID=vcihal \
 *   DATABASE_URL=postgres://... \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   node scripts/migrate-firestore-to-pg.cjs
 */

'use strict';

const admin = require('firebase-admin');
const { drizzle } = require('drizzle-orm/node-postgres');
const { Pool } = require('pg');
const schema = require('./functions-lib/db/schema.js');
const { toUnits } = require('./functions-lib/lib/validation.js');
const { eq } = require('drizzle-orm');

// We copy the compiled lib into scripts/functions-lib/ at runtime if needed
const path = require('path');
const fs = require('fs');

const LIB_SRC = path.join(__dirname, '..', 'functions', 'lib');
const LIB_COPY = path.join(__dirname, 'functions-lib');

// ── Bootstrap ─────────────────────────────────────────────────────
const projectId = process.env.FIRESTORE_PROJECT_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!projectId) { console.error('FIRESTORE_PROJECT_ID is required'); process.exit(1); }
if (!databaseUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

admin.initializeApp({ projectId });
const firestore = admin.firestore();

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

// ── Helpers ───────────────────────────────────────────────────────
function toDate(v) {
  if (!v) return new Date();
  if (v && typeof v.toDate === 'function') return v.toDate();
  return new Date(v);
}

function toSharesTuple(shares) {
  if (Array.isArray(shares) && shares.length === 2) {
    return [Number(shares[0]) || 0, Number(shares[1]) || 0];
  }
  if (shares && typeof shares === 'object') {
    return [Number(shares.lower ?? shares[0]) || 0, Number(shares.higher ?? shares[1]) || 0];
  }
  return [0, 0];
}

function wsCollection(workspaceId, collName) {
  return workspaceId === 'default'
    ? firestore.collection(collName)
    : firestore.collection(`workspaces/${workspaceId}/${collName}`);
}

// ── Migration functions ───────────────────────────────────────────
async function migrateWorkspace(workspaceId, workspaceName) {
  console.log(`\nMigrating workspace: ${workspaceId} (${workspaceName})`);

  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: workspaceName,
    visibility: 'private',
    createdBy: 'migrated',
    createdAt: new Date(),
  }).onConflictDoNothing();
  console.log('  ✓ workspace row');

  // Metrics
  const metricsSnap = await wsCollection(workspaceId, 'metrics').get();
  for (const doc of metricsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.metrics).values({
      id: doc.id, workspaceId,
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
    await db.insert(schema.markets).values({
      id: doc.id, workspaceId,
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
      pool: d.pool ?? liquidity,
      taskId: d.taskId ?? null,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${marketsSnap.size} markets`);

  // Positions
  const positionsSnap = await wsCollection(workspaceId, 'positions').get();
  for (const doc of positionsSnap.docs) {
    const d = doc.data();
    await db.insert(schema.positions).values({
      id: doc.id, workspaceId,
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
      id: doc.id, workspaceId,
      marketId: d.marketId ?? '',
      agentId: d.agentId ?? '',
      direction: d.direction ?? 'higher',
      shares: d.shares ?? 0,
      cost: d.cost ?? 0,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${tradesSnap.size} trades`);

  // Tasks
  const tasksSnap = await wsCollection(workspaceId, 'tasks').get();
  for (const doc of tasksSnap.docs) {
    const d = doc.data();
    await db.insert(schema.tasks).values({
      id: doc.id, workspaceId,
      proposedBy: d.proposedBy ?? '',
      title: d.title ?? '',
      description: d.description ?? '',
      price: d.price ?? 0,
      status: d.status ?? 'pending',
      conditionalMarketIds: d.conditionalMarketIds ?? [],
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${tasksSnap.size} tasks`);

  // Updates
  const updatesSnap = await wsCollection(workspaceId, 'updates').get();
  for (const doc of updatesSnap.docs) {
    const d = doc.data();
    await db.insert(schema.updates).values({
      id: doc.id, workspaceId,
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
      id: doc.id, workspaceId,
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
    if (!keyHash) { console.warn(`  ⚠ agent ${doc.id} has no API key — skipping`); continue; }
    await db.insert(schema.agents).values({
      id: doc.id,
      apiKeyHash: keyHash,
      role: d.role ?? 'agent',
      balance: toUnits(d.balance ?? 0),
      earnedBetting: d.earnedBetting ?? 0,
      spentBetting: d.spentBetting ?? 0,
      spentTokens: d.spentTokens ?? 0,
      earnedTasks: d.earnedTasks ?? 0,
      walletAddress: d.walletAddress ?? null,
      withdrawnUsdc: d.withdrawnUsdc ?? 0,
      ownerUid: d.ownerUid ?? null,
      createdAt: toDate(d.createdAt),
      approvedAt: d.approvedAt ? toDate(d.approvedAt) : null,
    }).onConflictDoNothing();
    await db.insert(schema.agentApiKeys).values({
      hash: keyHash, agentId: doc.id, workspaceId: 'default',
    }).onConflictDoNothing();
    migrated++;
  }
  console.log(`  ✓ ${migrated} agents`);
}

async function main() {
  console.log(`Migrating from Firestore: ${projectId}`);
  console.log(`Target: ${databaseUrl.replace(/:[^:@]+@/, ':***@')}\n`);

  await migrateAgents();

  // Default workspace (top-level collections)
  const defaultMetrics = await firestore.collection('metrics').get();
  if (defaultMetrics.size > 0) {
    await migrateWorkspace('default', 'Default');
  }

  // Named workspaces
  const wsSnap = await firestore.collection('workspaces').get();
  console.log(`\nFound ${wsSnap.size} additional workspaces`);
  for (const doc of wsSnap.docs) {
    const d = doc.data();
    await migrateWorkspace(doc.id, d.name ?? doc.id);
  }

  console.log('\n✓ Migration complete!');
  await pool.end();
}

main().catch(err => { console.error('\nMigration failed:', err); process.exit(1); });
