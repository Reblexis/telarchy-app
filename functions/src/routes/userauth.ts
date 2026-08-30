import { randomBytes } from 'crypto';
import { eq } from 'drizzle-orm';
import { type Request, Router } from 'express';
import { db } from '../db/client';
import {
  agentApiKeys,
  agents,
  authAccount,
  authUser,
  positions,
  proposalMessages,
  proposals,
  trades,
} from '../db/schema';
import { AppError } from '../lib/errors';
import {
  applyMatrixUpdate,
  type ChannelOverrides,
  type NotificationKindId,
  resolveMatrix,
} from '../lib/notification-prefs';
import { claimNickname } from '../lib/participants';
import { normalizePayoutMethod, type PayoutMethod, payoutSummary } from '../lib/payout';
import { normalizeBio, toUnits } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { getAuthWorkspaceMemberships, getUserWorkspaceMemberships, hashKey } from '../middleware/auth';
import { requireIdentity, requireScope, requireUser } from '../middleware/roles';
import { applyCredits, PLATFORM_SCOPE } from '../services/credits';
import { claimEarn, earnCredits } from '../services/earnRules';
import { CURRENT_CONSENT_VERSION } from './legal';

export const userauthRouter = Router();

/**
 * Ensure a participant (agent record) exists for a browser-authenticated user.
 * Only creates the agent row with signup credits. Workspace creation is deferred
 * to /create-workspace so the user can pick a template.
 */
async function ensureParticipant(uid: string): Promise<{ participantId: string; isNew: boolean }> {
  const [existing] = await db.select().from(agents).where(eq(agents.authUserId, uid));
  if (existing) return { participantId: existing.id, isNew: false };

  const participantId = uid;
  const now = new Date();
  // Generate a key hash for the agents table (required not-null column).
  // The actual agentApiKeys row linking this to a workspace is created later
  // when the user creates their first workspace.
  const keyHash = hashKey(randomBytes(32).toString('hex'));

  // Creating an account pays its own price; the provider the person came
  // through is paid for separately, by its link earn below (owner ask
  // 2026-08-30). Read BEFORE the transaction: it is a cached read, and
  // holding a transaction open across it buys nothing.
  const grant = await earnCredits('signup_user');

  // One transaction: an identity created without its grant, or a grant
  // without its identity, are both states nothing later would repair.
  await db.transaction(async tx => {
    await tx.insert(agents).values({
      id: participantId,
      apiKeyHash: keyHash,
      authUserId: uid,
      platformAdmin: false,
      intent: null,
      balance: 0,
      createdAt: now,
      approvedAt: now,
    });
    if (grant > 0) {
      await applyCredits(tx, {
        agentId: participantId,
        workspaceId: PLATFORM_SCOPE,
        deltaUnits: toUnits(grant),
        reason: 'signup_grant',
      });
    }
  });

  // The earns, recorded so the /earn page can show what is left and so
  // nothing pays twice. Claiming the signup itself is what makes it
  // idempotent; the provider link pays separately, keyed on the provider
  // account so one Google account can never fund two Telarchy accounts.
  await claimEarn({ agentId: participantId, key: 'signup_user' }).catch(e =>
    console.error('signup earn claim failed:', e),
  );
  // Either provider earns the same single link row, once (owner decision
  // 2026-08-30): a second attached account is the same person proving
  // they hold another free account.
  const link = (
    await db
      .select({ providerId: authAccount.providerId, accountId: authAccount.accountId })
      .from(authAccount)
      .where(eq(authAccount.userId, uid))
  ).find(l => l.providerId === 'google' || l.providerId === 'github');
  if (link) {
    await claimEarn({ agentId: participantId, key: 'link_oauth', refId: link.accountId }).catch(e =>
      console.error('link earn claim failed:', e),
    );
  }

  // The public identity must be UNIQUE (owner direction 2026-08-11): the
  // signup "display name" is free text two people can share, so it never
  // shows publicly on its own. Auto-claim a unique nickname derived from
  // it (slugified, numbered on collision); the account dialog can change
  // it later. Best-effort: an unclaimable name leaves the raw id as the
  // handle rather than failing signup.
  try {
    const [authRow] = await db.select({ name: authUser.name }).from(authUser).where(eq(authUser.id, uid));
    const base =
      (authRow?.name ?? '')
        .toLowerCase()
        .trim()
        .replace(/[\s.]+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/^[-_]+|[-_]+$/g, '')
        .slice(0, 26) || 'trader';
    const padded = base.length >= 3 ? base : `${base}-${participantId.slice(0, 4).toLowerCase()}`;
    for (let n = 0; n < 20; n++) {
      const candidate = n === 0 ? padded : `${padded}-${n + 1}`;
      try {
        await claimNickname(db, participantId, candidate);
        break;
      } catch (e) {
        if (!(e instanceof AppError) || (e as AppError).status !== 409) throw e;
      }
    }
  } catch (e) {
    console.error(`ensureParticipant: nickname auto-claim failed for ${participantId}:`, e);
  }

  return { participantId, isNew: true };
}

/**
 * Resolve the caller to a participant ID (for both browser-session and agent-key auth).
 * Browser users are auto-provisioned on first call; agent-key callers already
 * have an agent row by definition.
 */
async function resolveCallerParticipantId(req: Request): Promise<string | null> {
  const uid = req.auth?.uid;
  const agentId = req.auth?.agentId;
  if (uid) {
    const { participantId } = await ensureParticipant(uid);
    return participantId;
  }
  if (agentId) return agentId;
  return null;
}

/**
 * GET /api/auth/me
 * Returns the current participant's profile and workspace memberships.
 * Works for both browser sessions and agent API keys: same shape, different
 * auth path. Auto-creates the participant for OAuth users on first call.
 */
userauthRouter.get(
  '/me',
  requireIdentity,
  requireScope('account:read'),
  wrap(async (req, res) => {
    const { uid, agentId, capabilities } = req.auth!;

    if (!uid && !agentId) {
      // Master key with no identity (rare): degrade gracefully.
      const authRole = capabilities.has('manage')
        ? 'admin'
        : capabilities.has('trade')
          ? 'agent'
          : capabilities.has('read')
            ? 'member'
            : 'pending';
      res.json({ uid: null, email: null, workspaceId: req.auth!.workspaceId, authRole, workspaces: {} });
      return;
    }

    const participantId = (await resolveCallerParticipantId(req))!;
    const [agent] = await db.select().from(agents).where(eq(agents.id, participantId));
    const memberships = uid ? await getUserWorkspaceMemberships(uid) : await getAuthWorkspaceMemberships({ agentId });

    const workspaceMap = Object.fromEntries(memberships.map(m => [m.workspaceId, { role: m.memberRole }]));

    // Use the workspace from auth context, or fall back to the first membership.
    // New users with no workspace yet will have an empty workspaceId (authRole = 'pending').
    const workspaceId = req.auth!.workspaceId || memberships[0]?.workspaceId || '';
    const memberRole = workspaceMap[workspaceId]?.role ?? null;

    // Recompute authRole from actual membership; the middleware value may be stale
    // (e.g. 'pending' when ensureParticipant just created the first workspace).
    // This is a legacy label for frontend consumers; capabilities are authoritative.
    const effectiveAuthRole =
      memberRole === 'owner' || memberRole === 'admin'
        ? 'admin'
        : memberRole === 'trader'
          ? 'agent'
          : memberRole === 'viewer'
            ? 'member'
            : memberships.length > 0
              ? 'agent'
              : 'pending';

    res.json({
      uid: uid ?? null,
      email: null, // BetterAuth session has the email; frontend reads from authClient.useSession()
      intent: agent?.intent ?? null,
      nickname: agent?.nickname ?? null,
      bio: agent?.bio ?? null,
      participantId,
      workspaceId,
      authRole: effectiveAuthRole,
      memberRole,
      capabilities: [...capabilities].sort(),
      workspaces: workspaceMap,
      platformAdmin: agent?.platformAdmin === true,
      // Which emails this participant wants (docs/vision.md, "Participant
      // email notifications"). Defaults live on the column, so a row created
      // before the columns existed reads the same as a new signup.
      notifications: {
        commentOnMyProposal: agent?.notifyCommentOnMyProposal ?? true,
        replyToMyComment: agent?.notifyReplyToMyComment ?? true,
        newProposal: agent?.notifyNewProposal ?? false,
        anyComment: agent?.notifyAnyComment ?? false,
        marketResolved: agent?.notifyMarketResolved ?? true,
        contractDecided: agent?.notifyContractDecided ?? true,
      },
      // The full matrix: every kind x { web, email, mobile }, defaults applied
      // (lib/notification-prefs.ts). `notifications` above is the email column
      // of this same matrix, kept for existing clients.
      notificationChannels: resolveMatrix(agent?.notificationChannels as ChannelOverrides | null, {
        comment: agent?.notifyCommentOnMyProposal ?? true,
        reply: agent?.notifyReplyToMyComment ?? true,
        contract: agent?.notifyNewProposal ?? false,
        anyComment: agent?.notifyAnyComment ?? false,
        settled: agent?.notifyMarketResolved ?? true,
        decision: agent?.notifyContractDecided ?? true,
      }),
    });
  }),
);

/**
 * POST /api/auth/consent
 * Records that the authenticated user accepted the current Terms and Privacy
 * Policy. Browser-account specific: programmatic agent-key participants are
 * exempt from consent gating (see middleware/consent.ts), so this endpoint
 * keeps requireUser by design.
 */
userauthRouter.post(
  '/consent',
  requireUser,
  wrap(async (req, res) => {
    const { uid } = req.auth!;
    if (!uid) {
      res.status(403).json({ error: 'Browser account session required' });
      return;
    }

    const { accepted } = req.body ?? {};
    if (accepted !== true) {
      res.status(400).json({ error: 'Consent to Terms and Privacy Policy is required' });
      return;
    }

    await db
      .update(authUser)
      .set({ consentedAt: new Date(), consentedVersion: CURRENT_CONSENT_VERSION })
      .where(eq(authUser.id, uid));

    res.json({ ok: true, version: CURRENT_CONSENT_VERSION });
  }),
);

/**
 * POST /api/auth/profile
 * Upserts the caller's participant profile (intent + nickname + bio +
 * payoutHandle). Works for both browser sessions and agent API keys; uses
 * whichever identity is present on req.auth and updates that participant's
 * row. `bio` is a freeform public description (max 500 chars; empty string
 * or null clears it) shown on the public participant profile. `payoutMethod`
 * is the account's structured payment details ({ provider, ...fields },
 * validated per provider in lib/payout.ts; null clears); its human-readable
 * summary is derived into `payoutHandle`, which paid-job proposals snapshot.
 * A bare `payoutHandle` string from older clients still works (stored as the
 * "other" provider). Payment info is never shown publicly. `notifications`
 * sets the email switches (docs/vision.md, "Participant email
 * notifications"): any subset of { commentOnMyProposal, replyToMyComment,
 * newProposal, anyComment, marketResolved, contractDecided }, each a boolean;
 * an omitted key keeps its current value.
 */
userauthRouter.post(
  '/profile',
  requireIdentity,
  requireScope('account:write'),
  wrap(async (req, res) => {
    const participantId = await resolveCallerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }

    const { intent, nickname, bio, image, payoutHandle, payoutMethod, notifications, notificationChannels } = req.body;
    if (intent !== undefined && !['creator', 'agent', 'trader'].includes(intent)) {
      res.status(400).json({ error: 'intent must be "creator", "agent", or "trader"' });
      return;
    }

    // Payment details (owner decision 2026-08-10): where job money goes
    // lives on the account, not on each proposal, and it is STRUCTURED
    // (owner direction, same day: providers, not one broad text field).
    // payoutMethod is the source of truth ({ provider, ...fields },
    // validated per provider in lib/payout.ts); the human-readable summary
    // is derived into payout_handle for proposal snapshots and the owner's
    // payout view. A bare payoutHandle string is still accepted from older
    // clients and stored as the "other" provider. null/empty clears both.
    let normalizedPayout: string | null | undefined;
    let normalizedMethod: PayoutMethod | null | undefined;
    if (payoutMethod !== undefined) {
      if (payoutMethod === null) {
        normalizedMethod = null;
        normalizedPayout = null;
      } else {
        const result = normalizePayoutMethod(payoutMethod);
        if (result instanceof Error) {
          res.status(400).json({ error: result.message });
          return;
        }
        normalizedMethod = result;
        normalizedPayout = payoutSummary(result);
      }
    } else if (payoutHandle !== undefined) {
      if (payoutHandle === null || (typeof payoutHandle === 'string' && payoutHandle.trim().length === 0)) {
        normalizedPayout = null;
        normalizedMethod = null;
      } else if (typeof payoutHandle !== 'string') {
        res.status(400).json({ error: 'payoutHandle must be a string or null' });
        return;
      } else {
        const result = normalizePayoutMethod({ provider: 'other', details: payoutHandle });
        if (result instanceof Error) {
          res.status(400).json({ error: result.message });
          return;
        }
        normalizedMethod = result;
        normalizedPayout = payoutSummary(result);
      }
    }

    let normalizedBio: string | null | undefined;
    if (bio !== undefined) {
      const result = normalizeBio(bio);
      if (result instanceof Error) {
        res.status(400).json({ error: result.message });
        return;
      }
      normalizedBio = result;
    }

    // Avatar: an http(s) URL (what OAuth providers populate) or a small
    // inline data:image (what the account menu's file picker produces after
    // client-side resizing; there is no blob store in this stack, so the
    // resized picture IS the stored value). The whitelist is exact: only
    // base64 png/jpeg/webp data URLs pass, so the value can never become a
    // javascript: or data:text/html vector in an <img src>.
    let normalizedImage: string | null | undefined;
    if (image !== undefined) {
      if (image === null || (typeof image === 'string' && image.trim().length === 0)) {
        normalizedImage = null;
      } else if (typeof image !== 'string') {
        res.status(400).json({ error: 'image must be a URL string or null' });
        return;
      } else {
        const trimmed = image.trim();
        if (trimmed.startsWith('data:')) {
          if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(trimmed)) {
            res.status(400).json({ error: 'inline images must be base64 png, jpeg, or webp' });
            return;
          }
          // ~96KB encoded (~72KB decoded): plenty for a 256px avatar, small
          // enough to live in the account row without weighing sessions down.
          if (trimmed.length > 96_000) {
            res.status(400).json({ error: 'inline image too large; resize to 256px or smaller' });
            return;
          }
          normalizedImage = trimmed;
        } else {
          if (trimmed.length > 500) {
            res.status(400).json({ error: 'image URL must be at most 500 characters' });
            return;
          }
          let parsed: URL;
          try {
            parsed = new URL(trimmed);
          } catch {
            res.status(400).json({ error: 'image must be a valid URL' });
            return;
          }
          if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            res.status(400).json({ error: 'image URL must be http or https' });
            return;
          }
          normalizedImage = trimmed;
        }
      }
    }

    if (nickname !== undefined) {
      if (typeof nickname !== 'string') {
        res.status(400).json({ error: 'nickname must be a string' });
        return;
      }
      const trimmed = nickname.trim();
      if (trimmed.length === 0) {
        res.status(400).json({ error: 'nickname must not be empty' });
        return;
      }
      if (trimmed.length > 64) {
        res.status(400).json({ error: 'nickname must be 1–64 characters' });
        return;
      }
    }

    // Email switches (docs/vision.md, "Participant email notifications").
    // A partial object is the normal case: the account dialog flips one
    // toggle and sends only that key, so an unnamed switch keeps its value.
    let notificationUpdate:
      | Partial<
          Record<
            | 'notifyCommentOnMyProposal'
            | 'notifyReplyToMyComment'
            | 'notifyNewProposal'
            | 'notifyAnyComment'
            | 'notifyMarketResolved'
            | 'notifyContractDecided',
            boolean
          >
        >
      | undefined;
    if (notifications !== undefined) {
      if (notifications === null || typeof notifications !== 'object' || Array.isArray(notifications)) {
        res.status(400).json({ error: 'notifications must be an object' });
        return;
      }
      const keys = {
        commentOnMyProposal: 'notifyCommentOnMyProposal',
        replyToMyComment: 'notifyReplyToMyComment',
        newProposal: 'notifyNewProposal',
        anyComment: 'notifyAnyComment',
        marketResolved: 'notifyMarketResolved',
        contractDecided: 'notifyContractDecided',
      } as const;
      notificationUpdate = {};
      for (const [input, column] of Object.entries(keys)) {
        const value = (notifications as Record<string, unknown>)[input];
        if (value === undefined) continue;
        if (typeof value !== 'boolean') {
          res.status(400).json({ error: `notifications.${input} must be true or false` });
          return;
        }
        notificationUpdate[column] = value;
      }
    }

    // The full matrix (owner ask 2026-08-24): { kind: { web?, email?, mobile? } },
    // any subset of cells. Email cells write the legacy columns, web and mobile
    // cells the jsonb overrides, so each cell keeps exactly one owner.
    let matrixWrite:
      | { overrides: ChannelOverrides; emailUpdates: Partial<Record<NotificationKindId, boolean>> }
      | undefined;
    if (notificationChannels !== undefined) {
      const [row] = await db
        .select({ channels: agents.notificationChannels })
        .from(agents)
        .where(eq(agents.id, participantId));
      const applied = applyMatrixUpdate(row?.channels as ChannelOverrides | null, notificationChannels);
      if ('error' in applied) {
        res.status(400).json({ error: applied.error });
        return;
      }
      matrixWrite = applied;
    }

    if (intent !== undefined) {
      await db.update(agents).set({ intent }).where(eq(agents.id, participantId));
    }

    if (notificationUpdate && Object.keys(notificationUpdate).length > 0) {
      await db.update(agents).set(notificationUpdate).where(eq(agents.id, participantId));
    }

    if (matrixWrite) {
      const emailColumns: Record<
        NotificationKindId,
        | 'notifyCommentOnMyProposal'
        | 'notifyReplyToMyComment'
        | 'notifyNewProposal'
        | 'notifyAnyComment'
        | 'notifyMarketResolved'
        | 'notifyContractDecided'
      > = {
        comment: 'notifyCommentOnMyProposal',
        reply: 'notifyReplyToMyComment',
        contract: 'notifyNewProposal',
        anyComment: 'notifyAnyComment',
        settled: 'notifyMarketResolved',
        decision: 'notifyContractDecided',
      };
      const set: Record<string, unknown> = { notificationChannels: matrixWrite.overrides };
      for (const [kind, value] of Object.entries(matrixWrite.emailUpdates)) {
        set[emailColumns[kind as NotificationKindId]] = value;
      }
      await db.update(agents).set(set).where(eq(agents.id, participantId));
    }

    if (normalizedBio !== undefined) {
      await db.update(agents).set({ bio: normalizedBio }).where(eq(agents.id, participantId));
    }

    if (normalizedPayout !== undefined) {
      await db
        .update(agents)
        .set({ payoutHandle: normalizedPayout, payoutMethod: normalizedMethod ?? null })
        .where(eq(agents.id, participantId));
    }

    if (nickname !== undefined) {
      await claimNickname(db, participantId, nickname.trim());
    }

    if (normalizedImage !== undefined) {
      // The picture lives on the browser account row; an API-key participant
      // has no such row, so say so rather than silently dropping the write.
      const uid = req.auth?.uid;
      if (!uid) {
        res.status(400).json({ error: 'Setting a picture requires a browser account' });
        return;
      }
      await db.update(authUser).set({ image: normalizedImage, updatedAt: new Date() }).where(eq(authUser.id, uid));
    }

    res.json({ ok: true, participantId, agentId: participantId });
  }),
);

/**
 * DELETE /api/auth/me
 * GDPR / self-delete: removes the caller's participant record (and, for
 * browser users, the BetterAuth account rows). Works for both auth paths so
 * an API-key participant can also exercise their right to be forgotten.
 */
userauthRouter.delete(
  '/me',
  requireIdentity,
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;
    // Account deletion is intentionally browser-only: a leaked or scoped API
    // key must never be able to wipe its owner's account. The UI requires the
    // user to be signed in (cookie session) to reach this endpoint. We keep
    // requireIdentity at the middleware layer (API parity) and enforce the
    // browser-only constraint inline so the endpoint still appears symmetric
    // in /api/help with auth=identity but actually blocks key callers.
    if (!uid) {
      res.status(403).json({ error: 'Account deletion is only available from a signed-in browser session.' });
      return;
    }
    const participantId = await resolveCallerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }

    await db.transaction(async tx => {
      // Detach + delete the caller's PII. Trades, positions, and liquidity
      // events are kept (they affect market state for other participants);
      // the agent row stays as an opaque attribution token but loses every
      // authentication path and human-identifiable field.
      await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, participantId));
      await tx
        .update(agents)
        .set({
          authUserId: null,
          nickname: null,
          walletAddress: null,
          intent: null,
          // Payment details and the freeform bio are PII; deletion wipes
          // them (privacy policy section 5). Proposal-level payout
          // snapshots on already-listed paid jobs are the payment record
          // of a live or completed transaction and are retained.
          payoutHandle: null,
          payoutMethod: null,
          bio: null,
        })
        .where(eq(agents.id, participantId));
      if (uid) {
        // Browser-account user: tear down BetterAuth rows (login + sessions).
        const { authAccount, authSession, authUser } = await import('../db/schema');
        await tx.delete(authAccount).where(eq(authAccount.userId, uid));
        await tx.delete(authSession).where(eq(authSession.userId, uid));
        await tx.delete(authUser).where(eq(authUser.id, uid));
      }
      // The agent row itself is intentionally preserved — its presence keeps
      // historical trades/positions/liquidity events attributable for market
      // integrity, while the row carries no PII after the update above.
    });

    res.status(204).send();
  }),
);

/**
 * GET /api/auth/me/export
 * GDPR Article 15: returns all personal data for the caller. Works for both
 * auth paths; agent-key callers see the participant + their trades/positions
 * (no BetterAuth account section, since they have none).
 */
userauthRouter.get(
  '/me/export',
  requireIdentity,
  requireScope('account:read'),
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;
    const participantId = await resolveCallerParticipantId(req);
    if (!participantId) {
      res.status(403).json({ error: 'Identity required' });
      return;
    }

    const [authRow, participantRow, memberships] = await Promise.all([
      uid
        ? db
            .select()
            .from(authUser)
            .where(eq(authUser.id, uid))
            .then(r => r[0] ?? null)
        : Promise.resolve(null),
      db
        .select()
        .from(agents)
        .where(eq(agents.id, participantId))
        .then(r => r[0] ?? null),
      getAuthWorkspaceMemberships({ uid, agentId }),
    ]);

    const account = authRow
      ? {
          id: authRow.id,
          email: authRow.email,
          emailVerified: authRow.emailVerified,
          name: authRow.name,
          image: authRow.image,
          createdAt: authRow.createdAt,
          updatedAt: authRow.updatedAt,
          consentedAt: authRow.consentedAt,
          consentedVersion: authRow.consentedVersion,
        }
      : null;

    const participant = participantRow
      ? {
          id: participantRow.id,
          authUserId: participantRow.authUserId,
          nickname: participantRow.nickname,
          balance: participantRow.balance,
          earnedBetting: participantRow.earnedBetting,
          spentBetting: participantRow.spentBetting,
          spentTokens: participantRow.spentTokens,
          walletAddress: participantRow.walletAddress,
          withdrawnUsdc: participantRow.withdrawnUsdc,
          platformAdmin: participantRow.platformAdmin,
          intent: participantRow.intent,
          // Payment details are the caller's own PII: the export must carry
          // them for the access right to be complete (privacy policy s.6).
          payoutHandle: participantRow.payoutHandle,
          payoutMethod: participantRow.payoutMethod,
          bio: participantRow.bio,
          createdAt: participantRow.createdAt,
          approvedAt: participantRow.approvedAt,
        }
      : null;

    const [userTrades, userPositions, userProposals, userProposalMessages] = await Promise.all([
      db.select().from(trades).where(eq(trades.agentId, participantId)),
      db.select().from(positions).where(eq(positions.agentId, participantId)),
      db.select().from(proposals).where(eq(proposals.proposedBy, participantId)),
      db.select().from(proposalMessages).where(eq(proposalMessages.from, participantId)),
    ]);

    res.json({
      uid: uid ?? null,
      account,
      participant,
      memberships,
      trades: userTrades,
      positions: userPositions,
      proposalsProposed: userProposals,
      proposalMessages: userProposalMessages,
      exportedAt: new Date().toISOString(),
      notes: 'Request logs (IP, user-agent, short-TTL) are not included; see Privacy Policy §5.',
    });
  }),
);
