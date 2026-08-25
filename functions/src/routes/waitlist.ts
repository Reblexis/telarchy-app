import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { waitlist } from '../db/schema';
import { notifyOwner } from '../lib/notify';
import { publicOrigin } from '../lib/origin';
import { wrap } from '../lib/wrap';

export const waitlistRouter = Router();

waitlistRouter.post(
  '/',
  wrap(async (req, res) => {
    const { email, source } = req.body;
    if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      res.status(400).json({ error: 'Valid email is required' });
      return;
    }

    // Which door this came through: 'marketplace' for the listing tile, a
    // workspace slug for that floor's own door (owner ask 2026-08-15). Both
    // post here, so without it every signup reads the same and there is no
    // way to tell which surface converts. Untrusted free text, so it is
    // clamped rather than trusted; missing stays null and reads as unknown.
    const from = typeof source === 'string' && source.trim() ? source.trim().slice(0, 60) : null;

    const normalized = email.trim().toLowerCase();
    const [existing] = await db.select().from(waitlist).where(eq(waitlist.email, normalized));
    if (existing) {
      res.status(409).json({ error: 'Already on the waitlist' });
      return;
    }

    await db.insert(waitlist).values({ email: normalized, source: from });
    // The floor promises "we will get back to you within a few days"; the
    // owner hearing about the email immediately is what keeps that true.
    void notifyOwner(
      `Telarchy: ${normalized} wants to get set up`,
      // The /admin cockpit page went with the old GUI (2026-08-19); its data
      // is still one authenticated call away, so the mail names the call.
      `${normalized} left their email${from ? ` on ${from}` : ' on the floor'}.\n\nAll signups: curl -H "X-API-Key: $TELARCHY_MASTER_KEY" ${publicOrigin()}/api/admin/floor-stats`,
    );
    res.status(201).json({ ok: true });
  }),
);
