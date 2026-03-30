import { Router } from 'express';
import { db } from '../db/client';
import { waitlist } from '../db/schema';
import { eq } from 'drizzle-orm';
import { wrap } from '../lib/wrap';

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
  res.status(201).json({ ok: true });
}));
