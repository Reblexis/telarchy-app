/**
 * Migrates all data from the vcihal 'default' workspace (top-level Firestore collections)
 * into workspaces/Uuwaqbq9J0e1Da1A0XNK/* so the personal server can serve it.
 *
 * Run with:
 *   GOOGLE_CLOUD_PROJECT=vcihal node scripts/migrate-workspace.mjs
 */

import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault(), projectId: 'vcihal' });
const db = getFirestore();

const TARGET_WORKSPACE = 'Uuwaqbq9J0e1Da1A0XNK';

// Top-level collections to migrate (flat copy)
const FLAT_COLLECTIONS = [
  'metrics',
  'metricLogs',
  'markets',
  'proposals',
  'updates',
  'events',
  'permissionGroups',
  'positions',
  'trades',
  'predictions',
];

// Subcollections nested under each parent collection document
const SUBCOLLECTIONS = {
  markets: ['liquidityEvents', 'trades'],
  proposals: ['messages'],
};

async function copyCollection(srcCol, dstCol, label) {
  const snap = await srcCol.get();
  if (snap.empty) { console.log(`  ${label}: empty, skipping`); return 0; }

  const BATCH_SIZE = 400;
  let count = 0;
  let batch = db.batch();

  for (const doc of snap.docs) {
    batch.set(dstCol.doc(doc.id), doc.data());
    count++;
    if (count % BATCH_SIZE === 0) {
      await batch.commit();
      batch = db.batch();
    }
  }
  if (count % BATCH_SIZE !== 0) await batch.commit();

  console.log(`  ${label}: copied ${count} documents`);
  return count;
}

async function migrate() {
  console.log(`Migrating default workspace → workspaces/${TARGET_WORKSPACE}`);
  console.log('Project: vcihal\n');

  for (const colName of FLAT_COLLECTIONS) {
    const src = db.collection(colName);
    const dst = db.collection(`workspaces/${TARGET_WORKSPACE}/${colName}`);
    await copyCollection(src, dst, colName);

    // Copy subcollections if any
    if (SUBCOLLECTIONS[colName]) {
      const parentSnap = await src.get();
      for (const parentDoc of parentSnap.docs) {
        for (const subName of SUBCOLLECTIONS[colName]) {
          const srcSub = src.doc(parentDoc.id).collection(subName);
          const dstSub = dst.doc(parentDoc.id).collection(subName);
          await copyCollection(srcSub, dstSub, `  ${colName}/${parentDoc.id}/${subName}`);
        }
      }
    }
  }

  console.log('\nDone.');
}

migrate().catch(err => { console.error(err); process.exit(1); });
