#!/usr/bin/env ts-node
/**
 * migrate-to-workspaces.ts
 *
 * One-time migration: copies all data from flat top-level Firestore collections
 * into the `workspaces/default/{collection}` subcollection structure.
 *
 * Usage:
 *   npx ts-node scripts/migrate-to-workspaces.ts [--dry-run]
 *
 * The script is SAFE to run multiple times: it checks if each destination doc
 * already exists before copying (idempotent). It does NOT delete source docs.
 *
 * After running and verifying, update lib/workspace.ts to remove the
 * backward-compat branch (the `if (workspaceId === 'default') return db().collection(name)` line)
 * so 'default' uses the subcollection path too.
 *
 * Collections migrated:
 *   metrics, metricLogs, updates, markets, liquidityEvents,
 *   positions, trades, tasks (+ tasks/{id}/messages subcollection), events
 *
 * Collections NOT migrated (remain global):
 *   agents, agentApiKeys, deposits, withdrawals, _system, system, waitlist
 */

import * as admin from 'firebase-admin';

const isDryRun = process.argv.includes('--dry-run');

const serviceAccountEnv = process.env.DATA_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(Buffer.from(serviceAccountEnv, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp();
}

const db = admin.firestore();
const WORKSPACE_ID = 'default';
const BATCH_SIZE = 400;

const WORKSPACE_SCOPED_COLLECTIONS = [
  'metrics',
  'metricLogs',
  'updates',
  'markets',
  'liquidityEvents',
  'positions',
  'trades',
  'events',
];

async function migrateCollection(name: string): Promise<number> {
  const src = db.collection(name);
  const dst = db.collection(`workspaces/${WORKSPACE_ID}/${name}`);

  const snap = await src.get();
  if (snap.empty) {
    console.log(`  ${name}: empty, skipping`);
    return 0;
  }

  let batch = db.batch();
  let batchCount = 0;
  let total = 0;
  let skipped = 0;

  for (const doc of snap.docs) {
    const destRef = dst.doc(doc.id);
    const existing = await destRef.get();
    if (existing.exists) { skipped++; continue; }

    if (!isDryRun) {
      batch.set(destRef, doc.data());
    }
    batchCount++;
    total++;

    if (batchCount >= BATCH_SIZE) {
      if (!isDryRun) await batch.commit();
      batch = db.batch();
      batchCount = 0;
    }
  }

  if (batchCount > 0 && !isDryRun) await batch.commit();

  console.log(`  ${name}: copied ${total}, skipped ${skipped} (already existed)`);
  return total;
}

async function migrateTaskMessages(): Promise<number> {
  const tasksSnap = await db.collection('tasks').get();
  let total = 0;

  for (const taskDoc of tasksSnap.docs) {
    const messagesSnap = await taskDoc.ref.collection('messages').get();
    if (messagesSnap.empty) continue;

    const dstTask = db.collection(`workspaces/${WORKSPACE_ID}/tasks`).doc(taskDoc.id);
    let batch = db.batch();
    let batchCount = 0;
    let skipped = 0;

    for (const msgDoc of messagesSnap.docs) {
      const destRef = dstTask.collection('messages').doc(msgDoc.id);
      const existing = await destRef.get();
      if (existing.exists) { skipped++; continue; }

      if (!isDryRun) batch.set(destRef, msgDoc.data());
      batchCount++;
      total++;

      if (batchCount >= BATCH_SIZE) {
        if (!isDryRun) await batch.commit();
        batch = db.batch();
        batchCount = 0;
      }
    }

    if (batchCount > 0 && !isDryRun) await batch.commit();
    if (skipped > 0) console.log(`  tasks/${taskDoc.id}/messages: ${batchCount} copied, ${skipped} skipped`);
  }

  console.log(`  tasks messages: copied ${total} total`);
  return total;
}

async function createWorkspaceDoc(): Promise<void> {
  const wsRef = db.collection('workspaces').doc(WORKSPACE_ID);
  const existing = await wsRef.get();
  if (existing.exists) {
    console.log('  workspaces/default: already exists');
    return;
  }
  if (!isDryRun) {
    await wsRef.set({
      id: WORKSPACE_ID,
      name: 'Default',
      createdBy: 'system',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      visibility: 'private',
    });
  }
  console.log('  workspaces/default: created');
}

async function main() {
  console.log(`\n=== Workspace Migration ${isDryRun ? '[DRY RUN]' : ''} ===`);
  console.log(`Target: workspaces/${WORKSPACE_ID}/\n`);

  await createWorkspaceDoc();

  let totalCopied = 0;
  for (const col of WORKSPACE_SCOPED_COLLECTIONS) {
    totalCopied += await migrateCollection(col);
  }
  totalCopied += await migrateTaskMessages();

  console.log(`\n=== Done: ${totalCopied} documents ${isDryRun ? 'would be' : ''} copied ===`);
  if (!isDryRun) {
    console.log('\nNext steps:');
    console.log('1. Verify data in workspaces/default/ via Firebase Console');
    console.log('2. Remove the backward-compat branch in functions/src/lib/workspace.ts');
    console.log('3. Redeploy functions');
    console.log('4. Delete source flat collections (optional, after verifying)');
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
