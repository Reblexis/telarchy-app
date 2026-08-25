import { eq } from 'drizzle-orm';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/client';
import { authUser } from '../db/schema';

/**
 * Reject protected requests from browser-authenticated users who have not
 * recorded acceptance of Terms and Privacy. Mount after authMiddleware.
 *
 * Agent-key and master-key auth are exempt: they represent programmatic
 * identities, not EULA-bound end users. The user-consent endpoint and the
 * delete-account / export endpoints live on userauthRouter (mounted before
 * authMiddleware) so users without consent can still consent or delete.
 */
export async function requireConsentIfUser(req: Request, res: Response, next: NextFunction) {
  const uid = req.auth?.uid;
  if (!uid) return next();

  const [row] = await db.select({ consentedAt: authUser.consentedAt }).from(authUser).where(eq(authUser.id, uid));

  if (row?.consentedAt) return next();
  return res.status(403).json({ error: 'Consent to Terms and Privacy Policy is required', needsConsent: true });
}
