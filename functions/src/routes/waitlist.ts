import { Router } from 'express';
import { db } from '../db/client';
import { waitlist } from '../db/schema';
import { eq } from 'drizzle-orm';
import { wrap } from '../lib/wrap';
import { notifyOwner } from '../lib/notify';

export const waitlistRouter = Router();

waitlistRouter.post('/', wrap(async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'Valid email is required' }); return;
  }

  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(waitlist).where(eq(waitlist.email, normalized));
  if (existing) { res.status(409).json({ error: 'Already on the waitlist' }); return; }

  await db.insert(waitlist).values({ email: normalized });
  // The floor promises "we will get back to you within a few days"; the
  // owner hearing about the email immediately is what keeps that true.
  void notifyOwner(
    `Telarchy: ${normalized} wants to get set up`,
    `${normalized} left their email on the floor.\n\nAll signups: https://telarchy.com/admin`,
  );
  res.status(201).json({ ok: true });
}));
