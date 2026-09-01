import { randomBytes } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { earnClaims, recordLinks, systemConfig } from '../db/schema';
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

/** Whether this participant has already been PAID for this provider.
 *  One payment per participant per provider, whatever they link
 *  afterwards (owner, 2026-09-01: "they just cant extract from that
 *  account again.. or from any other"). */
async function alreadyPaid(agentId: string, provider: RecordProvider): Promise<boolean> {
  const [row] = await db
    .select({ id: earnClaims.id })
    .from(earnClaims)
    .where(and(eq(earnClaims.agentId, agentId), eq(earnClaims.key, provider.earnKey)))
    .limit(1);
  return !!row;
}

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

    // No gate here beyond "does this account exist". Linking is identity,
    // not payment (docs/record-links.md): a record too new, too quiet or
    // bot-flagged to be worth money is still worth showing on a profile,
    // and the participant only finds out about the money at claim, where
    // it is decided. Refusing here would be refusing the badge.
    const profile = await provider.lookup(handle);

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

    // The proof held, so the link is made before any money is considered.
    // Replacing an existing link is allowed however it was made, paid or
    // not: nothing here is counted when a grant is decided, so relinking
    // cannot manufacture a second one.
    try {
      await db
        .insert(recordLinks)
        .values({ agentId, provider: provider.key, externalId: profile.id, handle: profile.handle })
        .onConflictDoUpdate({
          target: [recordLinks.agentId, recordLinks.provider],
          set: { externalId: profile.id, handle: profile.handle, linkedAt: new Date() },
        });
    } catch {
      // The other unique index: somebody else is already wearing this
      // handle. Their link is the one that stands until they drop it.
      throw new AppError(
        `The ${provider.label} account "${profile.handle}" is already linked to another participant`,
        409,
      );
    }
    await db.delete(systemConfig).where(eq(systemConfig.key, pendingKey(provider.key, agentId)));

    // Money, decided separately and last. Three ways to be owed nothing,
    // none of which undoes the link: the record does not qualify, this
    // participant has already been paid for this provider, or this
    // external account has already paid somebody.
    const answer = { ok: true, provider: provider.key, handle: profile.handle };
    const q = await provider.qualifies(profile, Date.now());
    if (!q.ok) {
      res.json({ ...answer, granted: 0, why: q.why });
      return;
    }
    if (await alreadyPaid(agentId, provider)) {
      res.json({
        ...answer,
        granted: 0,
        why: `This participant has already been paid for a ${provider.label} record. Linking another one is free, but it pays nothing.`,
      });
      return;
    }
    if (await refAlreadyClaimed(provider.earnKey, profile.id)) {
      res.json({
        ...answer,
        granted: 0,
        why: `The ${provider.label} account "${profile.handle}" has already been paid for once, which is all any account pays.`,
      });
      return;
    }

    // A null answer means an index refused it: one of the two rules above
    // was raced in the millisecond since it was checked. The link stands
    // either way.
    const claim = await claimEarn({ agentId, key: provider.earnKey, refId: profile.id });
    if (!claim) {
      res.json({ ...answer, granted: 0, why: `That ${provider.label} record has already been paid for.` });
      return;
    }
    res.json({ ...answer, granted: claim.granted });
  }),
);
