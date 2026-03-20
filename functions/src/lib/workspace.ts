import { db } from './db';

/**
 * Returns a Firestore CollectionReference scoped to the given workspace.
 *
 * The 'default' workspace is backward-compatible: it maps directly to the
 * existing top-level collections so no data migration is required. All other
 * workspaces use the `workspaces/{id}/{collection}` subcollection structure.
 *
 * When we eventually run the migration (scripts/migrate-to-workspaces.ts) and
 * move 'default' data into `workspaces/default/`, we remove the branch below.
 */
export function wsCol(workspaceId: string, name: string): FirebaseFirestore.CollectionReference {
  if (workspaceId === 'default') return db().collection(name);
  return db().collection(`workspaces/${workspaceId}/${name}`);
}

export function wsDoc(
  workspaceId: string,
  collection: string,
  docId: string,
): FirebaseFirestore.DocumentReference {
  if (workspaceId === 'default') return db().doc(`${collection}/${docId}`);
  return db().doc(`workspaces/${workspaceId}/${collection}/${docId}`);
}

/**
 * Workspace-scoped lock doc. Lives under _locks for non-default workspaces to
 * avoid colliding with the global _system lock namespace.
 */
export function wsLockDoc(workspaceId: string, lockName: string): FirebaseFirestore.DocumentReference {
  if (workspaceId === 'default') return db().doc(`_system/${lockName}`);
  return db().doc(`workspaces/${workspaceId}/_locks/${lockName}`);
}
