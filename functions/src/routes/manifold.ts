import { randomBytes, randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { earnClaims, systemConfig } from '../db/schema';
import { AppError } from '../lib/errors';
import { toUnits } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { requireIdentity } from '../middleware/roles';
import { applyCredits, PLATFORM_SCOPE } from '../services/credits';
import { earnCredits } from '../services/earnRules';

/**
 * Import a Manifold record (owner decision 2026-08-10): a proven Manifold
 * trader should start here with more weight than the plain signup grant,
 * because their track record is real information about their calibration. Their Manifold net worth (balance + invested), one mana to
 * one credit, capped at MANIFOLD_GRANT_CAP, is granted once per Manifold
 * account and once per Telarchy account.
 *
 * Ownership is proven the way third parties can: Manifold has no OAuth, so
 * the claimer puts a one-time code in their Manifold bio and we read it
 * back through the public API. The bio can be cleaned up immediately after;
 * the grant snapshots net worth at claim time.
 *
 * Nothing is transferred. The mana stays in the Manifold account: this reads a
 * balance and grants a matching amount of credits here, so the user gives up
 * nothing by importing. Saying "convert" in user-facing copy is a bug, because
 * it reads as spending their mana and that is the single thing most likely to
 * stop a Manifold user importing.
 *
 * Deliberately one-way: credits are not purchasable, not redeemable, and
 * nothing converts back the other way.
 */

export const manifoldRouter = Router();

const MANIFOLD_API = 'https://api.manifold.markets/v0';
// 10k (owner decision 2026-08-28, lowered from the 100k of 2026-08-10, which
// had been raised from 10k): with real-money season payouts proportional to
// settled profit, a grant is bankroll and bankroll is score-generating
// capital, so the cap returns to the same order as the user signup grant.
// Existing imports keep what they were granted; net worth above the cap can
// no longer be shuttled between Manifold accounts for extra grants (each
// Manifold account backs at most one grant, ever, whatever its size).
export const MANIFOLD_GRANT_CAP = 10_000;

const pendingKey = (agentId: string) => `manifold-claim:${agentId}`;
const claimedUserKey = (manifoldUserId: string) => `manifold-claimed:user:${manifoldUserId}`;
const claimedAgentKey = (agentId: string) => `manifold-claimed:agent:${agentId}`;

async function configGet<T>(key: string): Promise<T | null> {
  const [row] = await db.select().from(systemConfig).where(eq(systemConfig.key, key));
  return (row?.value as T) ?? null;
}

async function configSet(key: string, value: unknown): Promise<void> {
  await db.insert(systemConfig).values({ key, value }).onConflictDoUpdate({ target: systemConfig.key, set: { value } });
}

interface ManifoldUser {
  id: string;
  username: string;
  bio: string;
  createdTime: number | null;
  lastBetTime: number | null;
  creatorTraders: number;
  isBot: boolean;
}

async function fetchManifoldUser(username: string): Promise<ManifoldUser> {
  const res = await fetch(`${MANIFOLD_API}/user/${encodeURIComponent(username)}`);
  if (res.status === 404) throw new AppError(`No Manifold user named "${username}"`, 404);
  if (!res.ok) throw new AppError('Manifold API is unreachable right now; try again in a minute', 502);
  const u = (await res.json()) as {
    id?: string;
    username?: string;
    bio?: string;
    createdTime?: number;
    lastBetTime?: number;
    isBot?: boolean;
    creatorTraders?: number | { allTime?: number };
  };
  if (!u.id) throw new AppError('Manifold returned an unexpected shape', 502);
  const ct = u.creatorTraders;
  return {
    id: u.id,
    username: u.username ?? username,
    bio: u.bio ?? '',
    createdTime: typeof u.createdTime === 'number' ? u.createdTime : null,
    lastBetTime: typeof u.lastBetTime === 'number' ? u.lastBetTime : null,
    creatorTraders: typeof ct === 'number' ? ct : (ct?.allTime ?? 0),
    isBot: u.isBot === true,
  };
}

/**
 * What the grant is actually paying for (owner decision 2026-08-30): an
 * ESTABLISHED forecaster, not a balance. Mana transfers between Manifold
 * accounts, so net worth is the one input a farmer can concentrate into a
 * fresh account; account age, a recent bet and other people trading your
 * markets cannot be concentrated that way. A bot flag disqualifies
 * outright: a bot brings no person.
 */
const MIN_ACCOUNT_AGE_DAYS = 90;
const RECENT_BET_DAYS = 60;

function qualifies(u: ManifoldUser, now = Date.now()): { ok: true } | { ok: false; why: string } {
  if (u.isBot) return { ok: false, why: 'That Manifold account is flagged as a bot.' };
  const ageDays = u.createdTime ? (now - u.createdTime) / 86_400_000 : 0;
  if (ageDays < MIN_ACCOUNT_AGE_DAYS) {
    return {
      ok: false,
      why: `That Manifold account is ${Math.floor(ageDays)} days old; the import needs ${MIN_ACCOUNT_AGE_DAYS}.`,
    };
  }
  const betDays = u.lastBetTime ? (now - u.lastBetTime) / 86_400_000 : Infinity;
  if (betDays > RECENT_BET_DAYS && u.creatorTraders <= 0) {
    return {
      ok: false,
      why: `That Manifold account has not traded in ${RECENT_BET_DAYS} days and has no markets others traded.`,
    };
  }
  return { ok: true };
}

async function fetchManifoldNetWorth(userId: string): Promise<number> {
  const res = await fetch(`${MANIFOLD_API}/get-user-portfolio?userId=${encodeURIComponent(userId)}`);
  if (!res.ok) throw new AppError('Manifold portfolio API is unreachable right now; try again in a minute', 502);
  const p = (await res.json()) as { balance?: number; investmentValue?: number };
  return (p.balance ?? 0) + (p.investmentValue ?? 0);
}

/** Step 1: name the account; get the code to put in its bio. */
manifoldRouter.post(
  '/start',
  requireIdentity,
  wrap(async (req, res) => {
    const agentId = req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required' });
      return;
    }

    const username = typeof req.body?.username === 'string' ? req.body.username.trim().replace(/^@/, '') : '';
    if (!username || !/^[A-Za-z0-9_.-]{1,40}$/.test(username)) {
      res.status(400).json({ error: 'username must be your Manifold handle (letters, digits, _ . -)' });
      return;
    }

    if (await configGet(claimedAgentKey(agentId))) {
      res.status(409).json({ error: 'This account has already imported a Manifold record' });
      return;
    }

    const user = await fetchManifoldUser(username);
    if (await configGet(claimedUserKey(user.id))) {
      res.status(409).json({ error: `The Manifold account "${user.username}" has already been imported` });
      return;
    }

    const code = `telarchy-${randomBytes(4).toString('hex')}`;
    await configSet(pendingKey(agentId), {
      username: user.username,
      manifoldUserId: user.id,
      code,
      createdAt: Date.now(),
    });
    res.json({
      code,
      username: user.username,
      instructions: `Add "${code}" anywhere in your Manifold bio (manifold.markets/profile), then press verify. You can remove it right after.`,
    });
  }),
);

/** Step 2: read the bio back, snapshot net worth, grant once. */
manifoldRouter.post(
  '/claim',
  requireIdentity,
  wrap(async (req, res) => {
    const agentId = req.auth!.agentId;
    if (!agentId) {
      res.status(403).json({ error: 'A participant identity is required' });
      return;
    }

    const pending = await configGet<{ username: string; manifoldUserId: string; code: string }>(pendingKey(agentId));
    if (!pending) {
      res.status(400).json({ error: 'Start the import first: POST /api/import/manifold/start { username }' });
      return;
    }

    if (await configGet(claimedAgentKey(agentId))) {
      res.status(409).json({ error: 'This account has already imported a Manifold record' });
      return;
    }
    if (await configGet(claimedUserKey(pending.manifoldUserId))) {
      res.status(409).json({ error: `The Manifold account "${pending.username}" has already been imported` });
      return;
    }

    const user = await fetchManifoldUser(pending.username);
    if (user.id !== pending.manifoldUserId) {
      res.status(409).json({ error: 'That Manifold username changed hands since you started; start again' });
      return;
    }
    if (!user.bio.includes(pending.code)) {
      res.status(400).json({
        error: `Code not found in @${pending.username}'s bio yet. Add "${pending.code}" to the bio and try again (Manifold can take a minute to serve the edit).`,
      });
      return;
    }

    const netWorth = await fetchManifoldNetWorth(user.id);
    // Negative and micro accounts import as zero: the record is still linked
    // (and burned for reuse), but only real standing moves credits.
    // FLAT, not scaled by net worth (owner decision 2026-08-30): what is
    // scarce is the established account itself, and net worth is the part
    // a farmer can move between accounts. Priced in the earn table, so the
    // operator can change it without a deploy.
    const q = qualifies(user);
    if (!q.ok) throw new AppError(q.why, 400);
    const granted = Math.max(0, Math.round(await earnCredits('manifold_link')));

    await db.transaction(async tx => {
      // The earn claim, in the same transaction as the money. Without it
      // /earn keeps offering this row to somebody who already took it
      // (owner report 2026-08-30), and the platform-wide "one Manifold
      // account pays once" rule lives only in the system_config guards
      // above rather than in an index. Deliberately NOT
      // onConflictDoNothing: a conflict here means those guards were
      // raced, and aborting the transaction is what stops a second
      // payment.
      await tx.insert(earnClaims).values({
        id: randomUUID(),
        agentId,
        key: 'manifold_link',
        refId: user.id,
        credits: granted,
      });
      if (granted > 0) {
        await applyCredits(tx, {
          agentId,
          workspaceId: PLATFORM_SCOPE,
          deltaUnits: toUnits(granted),
          reason: 'signup_grant',
          refId: `manifold:${user.id}`,
        });
      }
      await tx
        .insert(systemConfig)
        .values([
          { key: claimedUserKey(user.id), value: { agentId, granted, at: Date.now(), username: user.username } },
          {
            key: claimedAgentKey(agentId),
            value: { manifoldUserId: user.id, granted, at: Date.now(), username: user.username },
          },
        ])
        .onConflictDoNothing();
      await tx.delete(systemConfig).where(eq(systemConfig.key, pendingKey(agentId)));
    });

    res.json({
      ok: true,
      username: user.username,
      // Reported for context, no longer what decides the grant.
      netWorth: Math.round(netWorth),
      granted,
    });
  }),
);
