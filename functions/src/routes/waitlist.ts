import { Router } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { wrap } from '../lib/wrap';

function db() { return getFirestore(); }

export const waitlistRouter = Router();

waitlistRouter.post('/', wrap(async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email is required' }); return;
  }

  const normalized = email.trim().toLowerCase();
  const ref = db().collection('waitlist').doc(normalized);
  const existing = await ref.get();
  if (existing.exists) {
    res.status(409).json({ error: 'Already on the waitlist' }); return;
  }

  await ref.set({ email: normalized, createdAt: FieldValue.serverTimestamp() });
  res.status(201).json({ ok: true });
}));
