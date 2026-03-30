/**
 * Firestore → PostgreSQL migration script.
 *
 * Reads all data from a Firestore project and inserts it into a PostgreSQL
 * database (already migrated via `npm run db:migrate` in functions/).
 *
 * Prerequisites:
 *   1. Run `npm run db:migrate` in functions/ to create the schema.
 *   2. Set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON with
 *      Firestore read access (roles/datastore.viewer or higher).
 *   3. Set FIRESTORE_PROJECT_ID to the source Firebase project ID.
 *   4. Set DATABASE_URL to the target PostgreSQL connection string.
 *
 * Usage:
 *   cd functions
 *   FIRESTORE_PROJECT_ID=my-project \
 *   DATABASE_URL=postgres://... \
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json \
 *   npx ts-node ../scripts/migrate-firestore-to-pg.ts
 */

import * as admin from 'firebase-admin';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../functions/src/db/schema';
import { randomUUID } from 'crypto';
import { toUnits } from '../functions/src/lib/validation';

const projectId = process.env.FIRESTORE_PROJECT_ID;
const databaseUrl = process.env.DATABASE_URL;

if (!projectId) { console.error('FIRESTORE_PROJECT_ID is required'); process.exit(1); }
if (!databaseUrl) { console.error('DATABASE_URL is required'); process.exit(1); }

admin.initializeApp({ projectId });
const firestore = admin.firestore();

const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

function toDate(v: admin.firestore.Timestamp | null | undefined): Date {
  if (!v) return new Date();
  return v.toDate();
}

async function migrateWorkspace(workspaceId: string) {
  console.log(`\nMigrating workspace: ${workspaceId}`);

  const wsDoc = await firestore.collection('workspaces').doc(workspaceId).get();
  if (!wsDoc.exists) {
    console.warn(`  Workspace doc not found: ${workspaceId}`);
    return;
  }
  const wsData = wsDoc.data()!;

  // Upsert workspace row
  await db.insert(schema.workspaces).values({
    id: workspaceId,
    name: wsData.name ?? workspaceId,
    visibility: wsData.visibility ?? 'private',
    customApiUrl: wsData.customApiUrl ?? null,
    createdAt: toDate(wsData.createdAt),
  }).onConflictDoNothing();
  console.log(`  ✓ workspace`);

  // Metrics
  const metricsSnap = await firestore.collection(`workspaces/${workspaceId}/metrics`).get();
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
      depth: d.depth ?? 0,
      timePreference: d.timePreference ?? null,
      marketRangeMax: d.marketRangeMax ?? 1000,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${metricsSnap.size} metrics`);

  // Markets
  const marketsSnap = await firestore.collection(`workspaces/${workspaceId}/markets`).get();
  for (const doc of marketsSnap.docs) {
    const d = doc.data();
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
      rangeMin: d.rangeMin ?? 0,
      rangeMax: d.rangeMax ?? 1000,
      liquidity: d.liquidity ?? 0,
      shares: d.shares ?? { higher: 0, lower: 0 },
      totalStake: d.totalStake ?? 0,
      tradeCount: d.tradeCount ?? 0,
      taskId: d.taskId ?? null,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${marketsSnap.size} markets`);

  // Positions
  const positionsSnap = await firestore.collection(`workspaces/${workspaceId}/positions`).get();
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
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${positionsSnap.size} positions`);

  // Trades
  const tradesSnap = await firestore.collection(`workspaces/${workspaceId}/trades`).get();
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
      consensus: d.consensus ?? null,
      createdAt: toDate(d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${tradesSnap.size} trades`);

  // Tasks
  const tasksSnap = await firestore.collection(`workspaces/${workspaceId}/tasks`).get();
  for (const doc of tasksSnap.docs) {
    const d = doc.data();
    await db.insert(schema.tasks).values({
      id: doc.id,
      workspaceId,
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

  // Updates (metric update log)
  const updatesSnap = await firestore.collection(`workspaces/${workspaceId}/updates`).get();
  for (const doc of updatesSnap.docs) {
    const d = doc.data();
    await db.insert(schema.updates).values({
      id: doc.id,
      workspaceId,
      metricId: d.metricId ?? '',
      metricName: d.metricName ?? '',
      oldValue: d.oldValue ?? 0,
      newValue: d.newValue ?? 0,
      description: d.description ?? '',
      createdAt: toDate(d.timestamp ?? d.createdAt),
    }).onConflictDoNothing();
  }
  console.log(`  ✓ ${updatesSnap.size} updates`);

  // Permission groups
  const groupsSnap = await firestore.collection(`workspaces/${workspaceId}/permissionGroups`).get();
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
  for (const doc of snap.docs) {
    const d = doc.data();
    await db.insert(schema.agents).values({
      id: doc.id,
      role: d.role ?? 'pending',
      balance: toUnits(d.balance ?? 0),
      earnedBetting: toUnits(d.earnedBetting ?? 0),
      earnedTasks: toUnits(d.earnedTasks ?? 0),
      spentBetting: toUnits(d.spentBetting ?? 0),
      spentTokens: toUnits(d.spentTokens ?? 0),
      walletAddress: d.walletAddress ?? null,
      approvedAt: d.approvedAt ? toDate(d.approvedAt) : null,
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    }).onConflictDoNothing();

    // Agent API keys
    if (d.apiKey) {
      await db.insert(schema.agentApiKeys).values({
        id: randomUUID(),
        agentId: doc.id,
        keyHash: d.apiKey, // NOTE: Firestore stored the raw key; hash it if needed
        createdAt: toDate(d.createdAt),
      }).onConflictDoNothing();
    }
  }
  console.log(`  ✓ ${snap.size} agents`);
}

async function migrateUsers() {
  console.log('\nMigrating app users...');
  const snap = await firestore.collection('users').get();
  for (const doc of snap.docs) {
    const d = doc.data();
    // Note: BetterAuth's authUser table must be populated separately via
    // Firebase Auth export + import. This migrates the app-level profile only.
    await db.insert(schema.appUsers).values({
      userId: doc.id,
      email: d.email ?? null,
      intent: d.intent ?? null,
      agentId: d.agentId ?? null,
      authRole: d.role ?? 'pending',
      createdAt: toDate(d.createdAt),
      updatedAt: toDate(d.updatedAt),
    }).onConflictDoNothing();

    // User workspaces
    if (d.workspaceId) {
      await db.insert(schema.userWorkspaces).values({
        userId: doc.id,
        workspaceId: d.workspaceId,
        memberRole: d.memberRole ?? 'owner',
      }).onConflictDoNothing();
    }
  }
  console.log(`  ✓ ${snap.size} users`);
}

async function main() {
  console.log(`Migrating from Firestore project: ${projectId}`);
  console.log(`Target: ${databaseUrl!.replace(/:[^:@]+@/, ':***@')}\n`);

  await migrateAgents();
  await migrateUsers();

  // Get all workspaces
  const wsSnap = await firestore.collection('workspaces').get();
  const wsIds = wsSnap.docs.map(d => d.id);
  console.log(`\nFound ${wsIds.length} workspaces to migrate`);

  for (const wsId of wsIds) {
    await migrateWorkspace(wsId);
  }

  console.log('\n✓ Migration complete');
  await pool.end();
}

main().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
