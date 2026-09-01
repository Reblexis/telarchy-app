import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { earnClaims, systemConfig } from '../db/schema';
import { AppError } from '../lib/errors';
import { wrap } from '../lib/wrap';
import { requireIdentity } from '../middleware/roles';
import { claimEarn, refAlreadyClaimed } from '../services/earnRules';
import { HANDLE_RE, type RecordProvider, recordProvider } from '../services/recordProviders';

/**
 * Link a forecasting record from somewhere else, for any provider
 * (contract: docs/record-links.md).
 *
 * Ownership is proved the way a third party can: none of these platforms
 * gives us OAuth, so the participant publishes a one-time code somewhere
 * only the account holder can write (the bio) and we read it back. The
 * code can come out immediately afterwards; nothing reads it again.
 *
 * Nothing is transferred and no credential is asked for. The record is
 * read, and a matching grant is made here.
 *
 * The two uniqueness rules live in `earn_claims`, not in this file: its
 * indexes are what make one participant able to link a provider once and
 * one external account able to pay once across the whole platform, so a
 * race between two claims ends with one grant rather than two.
 */

export const recordLinkRouter = Router();

/** The pending proof, keyed per participant per provider. */
const pendingKey = (provider: string, agentId: string) => `record-link:${provider}:${agentId}`;

/** The linked handle, kept so a reader can be shown the badge
 *  (docs/record-links.md, "A linked handle is shown as a badge"). The
 *  earn claim records WHICH external account was paid, by its stable id,
 *  and an id is not a thing to show anybody; this is the display name
 *  that goes with it. Migration 0100 rewrote the Manifold rows the
 *  deleted route wrote into this shape. */
const handleKey = (provider: string, agentId: string) => `record-handle:${provider}:${agentId}`;

interface Pending {
  handle: string;
  externalId: string;
  code: string;
  createdAt: number;
}

function providerOr404(key: string): RecordProvider {
  const p = recordProvider(key);
  if (!p) throw new AppError(`No record provider named "${key}"`, 404);
  return p;
}

/** Whether this participant has already been paid for this provider. */
async function alreadyLinked(agentId: string, provider: RecordProvider): Promise<boolean> {
  const [row] = await db
    .select({ id: earnClaims.id })
    .from(earnClaims)
    .where(and(eq(earnClaims.agentId, agentId), eq(earnClaims.key, provider.earnKey)))
    .limit(1);
  return !!row;
}

/** Step 1: name the account, get the code that proves it is yours. */
recordLinkRouter.post(
  '/:provider/start',
  requireIdentity,
  wrap(async (req, res) => {
    const provider = providerOr404(req.params.provider as string);
    const agentId = req.auth?.agentId;
    if (!agentId) throw new AppError('A participant identity is required', 403);

    const raw = typeof req.body?.handle === 'string' ? req.body.handle : (req.body?.username ?? '');
    const handle = typeof raw === 'string' ? raw.trim().replace(/^@/, '') : '';
    if (!HANDLE_RE.test(handle)) {
      throw new AppError(`handle must be your ${provider.label} handle (letters, digits, _ . -)`, 400);
    }

    if (await alreadyLinked(agentId, provider)) {
      throw new AppError(`This account has already linked a ${provider.label} record`, 409);
    }

    const profile = await provider.lookup(handle);
    if (await refAlreadyClaimed(provider.earnKey, profile.id)) {
      throw new AppError(`The ${provider.label} account "${profile.handle}" has already been linked`, 409);
    }

    // Checked here as well as at claim, so nobody is sent to edit their
    // bio for a record that could never have been paid. Claim checks it
    // again because the answer can change in between.
    const early = await provider.qualifies(profile, Date.now());
    if (!early.ok) throw new AppError(early.why, 400);

    const code = `telarchy-${randomBytes(4).toString('hex')}`;
    const pending: Pending = { handle: profile.handle, externalId: profile.id, code, createdAt: Date.now() };
    await db
      .insert(systemConfig)
      .values({ key: pendingKey(provider.key, agentId), value: pending })
      .onConflictDoUpdate({ target: systemConfig.key, set: { value: pending } });

    res.json({
      code,
      handle: profile.handle,
      provider: provider.key,
      proofField: provider.proofField,
      instructions: `Put "${code}" anywhere in ${profile.handle}'s ${provider.label} ${provider.proofField}, then verify. You can take it out right after.`,
    });
  }),
);

/** Step 2: read the proof back, check the record, grant once. */
recordLinkRouter.post(
  '/:provider/claim',
  requireIdentity,
  wrap(async (req, res) => {
    const provider = providerOr404(req.params.provider as string);
    const agentId = req.auth?.agentId;
    if (!agentId) throw new AppError('A participant identity is required', 403);

    const [row] = await db
      .select({ value: systemConfig.value })
      .from(systemConfig)
      .where(eq(systemConfig.key, pendingKey(provider.key, agentId)))
      .limit(1);
    const pending = row?.value as Pending | undefined;
    if (!pending) {
      throw new AppError(`Start the link first: POST /api/import/${provider.key}/start { handle }`, 400);
    }

    if (await alreadyLinked(agentId, provider)) {
      throw new AppError(`This account has already linked a ${provider.label} record`, 409);
    }

    // Re-read the record now rather than trusting what /start saw: the
    // proof has to be present at this instant, and the gates have to be
    // true at this instant too.
    const profile = await provider.lookup(pending.handle);
    if (profile.id !== pending.externalId) {
      throw new AppError(`That ${provider.label} handle changed hands since you started; start again`, 409);
    }
    if (!profile.proofText.includes(pending.code)) {
      throw new AppError(
        `Code not found in ${profile.handle}'s ${provider.label} ${provider.proofField} yet. Add "${pending.code}" and try again (it can take a minute to show).`,
        400,
      );
    }

    const q = await provider.qualifies(profile, Date.now());
    if (!q.ok) throw new AppError(q.why, 400);

    // The claim and the money are one transaction inside claimEarn, and a
    // null answer means the index refused it: either this participant or
    // this external account was already paid, a millisecond ago.
    const claim = await claimEarn({ agentId, key: provider.earnKey, refId: profile.id });
    if (!claim) {
      throw new AppError(`The ${provider.label} account "${profile.handle}" has already been linked`, 409);
    }

    await db
      .insert(systemConfig)
      .values({
        key: handleKey(provider.key, agentId),
        value: { handle: profile.handle, externalId: profile.id, granted: claim.granted, at: Date.now() },
      })
      .onConflictDoUpdate({
        target: systemConfig.key,
        set: { value: { handle: profile.handle, externalId: profile.id, granted: claim.granted, at: Date.now() } },
      });
    await db.delete(systemConfig).where(eq(systemConfig.key, pendingKey(provider.key, agentId)));
    res.json({ ok: true, provider: provider.key, handle: profile.handle, granted: claim.granted });
  }),
);
