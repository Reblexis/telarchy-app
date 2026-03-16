import { getFirestore } from 'firebase-admin/firestore';

export function db() { return getFirestore(); }
