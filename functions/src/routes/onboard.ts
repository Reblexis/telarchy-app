import { randomBytes, randomUUID } from 'crypto';
import { and, eq, isNull, or } from 'drizzle-orm';
import { Router } from 'express';
import { db, mirrorAccountIntoStore } from '../db/client';
import { agentApiKeys, agents, permissionGroups, positions, trades, workspaces } from '../db/schema';
import { claimNickname } from '../lib/participants';
import { normalizeBio, SIGNUP_CREDITS, toUnits, UNCLAIMED_SIGNUP_CREDITS, validateAgentId } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { authMiddleware, hashKey } from '../middleware/auth';
import { applyCredits, PLATFORM_SCOPE } from '../services/credits';
import { createWorkspaceFromTemplate, WorkspaceCreateError } from '../services/workspace-create';

/**
 * Key-first onboarding: the zero-human-steps front door for agents setting
 * Telarchy up on a user's behalf (see GET /api/guides/onboarding).
 *
 * POST /api/onboard creates, in one call: a participant with NO browser
 * account attached, a workspace it owns, a scoped API key, and a one-time
 * claim link. The human attaches their email/OAuth account later via the
 * /claim page, only if and when they want the web UI; consent to the terms
 * happens there, through the normal browser gate (API-key identities are
 * exempt from the consent gate by existing policy).
 *
 * Unclaimed identities receive UNCLAIMED_SIGNUP_CREDITS (default 100) rather
 * than the full signup grant, so anonymous identity farming stays
 * unattractive; claiming tops the balance up by the difference.
 */
export const onboardRouter = Router();

/** Public origin used to build the claim URL handed to the user. */
function publicOrigin(): string {
  return process.env.BETTER_AUTH_URL?.trim() || 'https://telarchy.com';
}

/**
 * This endpoint stays paused (vision.md, "The owner side reopens",
 * 2026-08-21).
 *
 * The owner side is open again, but through `POST /api/workspaces`, which
 * needs an account: that is what the per-account cap counts and what the
 * floor belongs to. Onboard's job is key-first owner onboarding, identity and
 * workspace minted in one UNAUTHENTICATED call, so it has no account to cap
 * and nothing to refuse a script with. Reopening it is a separate decision
 * about abuse, not about whether owners are welcome.
 *
 * The flow is paused, not deleted. Env-driven (OWNER_ONBOARDING_OPEN=1)
 * rather than a code constant so the reopen is an operational flip, and so
 * the paused flow's tests keep running against the real handlers.
 */
const OWNER_ONBOARDING_OPEN = process.env.OWNER_ONBOARDING_OPEN === '1';

onboardRouter.post(
  '/',
  wrap(async (req, res) => {
    if (!OWNER_ONBOARDING_OPEN) {
      res.status(403).json({
        error:
          'This one-call owner onboarding is paused. Create an account, then POST /api/workspaces to open your own floor, or do it in a browser at https://telarchy.com/manage.',
        waitlist: 'https://telarchy.com/manage',
      });
      return;
    }
    const { agentId: requestedId, nickname, bio, workspace } = req.body ?? {};

    let participantId: string;
    if (requestedId !== undefined) {
      const err = validateAgentId(requestedId);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
      participantId = requestedId;
    } else {
      participantId = `tel-${randomBytes(6).toString('hex')}`;
    }

    const normalizedBio = bio !== undefined ? normalizeBio(bio) : null;
    if (normalizedBio instanceof Error) {
      res.status(400).json({ error: normalizedBio.message });
      return;
    }

    if (!workspace || typeof workspace !== 'object') {
      res.status(400).json({ error: 'workspace is required: { name, template?, templateParams?, visibility? }' });
      return;
    }

    const [existing] = await db.select({ id: agents.id }).from(agents).where(eq(agents.id, participantId));
    if (existing) {
      res.status(409).json({ error: 'Participant id already taken' });
      return;
    }

    const rawKey = randomBytes(32).toString('hex');
    const rawClaimToken = randomBytes(32).toString('hex');
    const keyId = randomUUID();
    // Everything an onboarding agent needs (workspace admin + bot registration
    // + self-management), but not wallet access and not the wildcard.
    const scopes = [
      'workspace:read',
      'workspace:trade',
      'workspace:manage',
      'account:read',
      'account:write',
      'account:keys',
      'account:agents',
      'account:feedback',
    ];

    await db.transaction(async tx => {
      await tx.insert(agents).values({
        id: participantId,
        apiKeyHash: hashKey(rawKey),
        balance: 0,
        bio: normalizedBio,
        claimTokenHash: hashKey(rawClaimToken),
        createdAt: new Date(),
        approvedAt: new Date(),
      });
      await applyCredits(tx, {
        agentId: participantId,
        workspaceId: PLATFORM_SCOPE,
        deltaUnits: toUnits(UNCLAIMED_SIGNUP_CREDITS),
        reason: 'signup_grant',
      });
      if (nickname !== undefined && nickname !== null && nickname !== '') {
        await claimNickname(tx, participantId, nickname);
      }
    });

    let ws;
    try {
      ws = await createWorkspaceFromTemplate({
        identity: participantId,
        ownerAgentId: participantId,
        name: workspace.name,
        templateId: workspace.template,
        templateParams: workspace.templateParams,
        visibility: workspace.visibility,
      });
    } catch (err) {
      if (err instanceof WorkspaceCreateError) {
        // Roll the identity back so a retry with a fixed body starts clean.
        await db.delete(agents).where(eq(agents.id, participantId));
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    await db.insert(agentApiKeys).values({
      hash: hashKey(rawKey),
      keyId,
      agentId: participantId,
      workspaceId: ws.id,
      label: 'onboarding',
      scopes,
    });

    res.status(201).json({
      participantId,
      nickname: nickname || null,
      apiKey: rawKey,
      keyId,
      scopes,
      credits: UNCLAIMED_SIGNUP_CREDITS,
      creditsAfterClaim: SIGNUP_CREDITS,
      workspace: { ...ws, ownerHandle: nickname || participantId },
      claimUrl: `${publicOrigin()}/claim?token=${rawClaimToken}`,
    });
  }),
);

/**
 * GET /api/onboard/claim/:token - what this claim token unlocks. No auth; the
 * /claim page uses it to show the user what they are attaching before they
 * sign in. Reveals only the participant's public face plus workspace names.
 */
onboardRouter.get(
  '/claim/:token',
  wrap(async (req, res) => {
    const tokenHash = hashKey(req.params.token as string);
    const [agent] = await db
      .select({ id: agents.id, nickname: agents.nickname })
      .from(agents)
      .where(eq(agents.claimTokenHash, tokenHash));
    if (!agent) {
      res.status(404).json({ error: 'Unknown or already-used claim token' });
      return;
    }
    const wsRows = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.createdBy, agent.id));
    res.json({
      participantId: agent.id,
      nickname: agent.nickname,
      workspaces: wsRows,
    });
  }),
);

/**
 * POST /api/onboard/claim { token } - bind the signed-in browser account to
 * the key-first identity and top its credits up to the full signup grant.
 *
 * Browser-session only by design: claiming is precisely the act of attaching
 * a BetterAuth account, and consent is enforced by the normal browser gate on
 * that account. The fresh account's auto-provisioned participant (created at
 * signup, id = uid) is deleted if it has no activity; its signup grant goes
 * with it, so claiming is credit-neutral. Accounts with an active participant
 * of their own cannot claim (one human, one identity).
 */
onboardRouter.post(
  '/claim',
  authMiddleware,
  wrap(async (req, res) => {
    const uid = req.auth?.uid;
    if (!uid) {
      res.status(401).json({ error: 'Sign in with a browser account to claim' });
      return;
    }

    const token = req.body?.token;
    if (!token || typeof token !== 'string') {
      res.status(400).json({ error: 'token is required' });
      return;
    }

    const tokenHash = hashKey(token);
    const [target] = await db.select().from(agents).where(eq(agents.claimTokenHash, tokenHash));
    if (!target) {
      res.status(404).json({ error: 'Unknown or already-used claim token' });
      return;
    }
    if (target.authUserId) {
      res.status(409).json({ error: 'Identity already claimed' });
      return;
    }

    // The claiming account's own auto-provisioned participant, if any.
    const [own] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.authUserId, uid), isNull(agents.claimTokenHash)));
    if (own && own.id !== target.id) {
      const [activity] = await db.select({ id: trades.id }).from(trades).where(eq(trades.agentId, own.id)).limit(1);
      const [pos] = await db.select({ id: positions.id }).from(positions).where(eq(positions.agentId, own.id)).limit(1);
      const [ownWs] = await db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(or(eq(workspaces.createdBy, own.id), eq(workspaces.createdBy, uid)))
        .limit(1);
      if (activity || pos || ownWs) {
        res.status(409).json({
          error:
            'This account already has an active participant identity. Claim from a fresh account, or keep using the API key.',
        });
        return;
      }
    }

    const topUpCredits = Math.max(0, SIGNUP_CREDITS - UNCLAIMED_SIGNUP_CREDITS);
    // Same store seam as ensureParticipant: this points a participant at an
    // account, and the foreign key is to THIS store's user table.
    await mirrorAccountIntoStore(uid);
    await db.transaction(async tx => {
      if (own && own.id !== target.id) {
        // Zero-activity auto-provisioned row: remove it (its unspent signup
        // grant goes with it, keeping the claim credit-neutral) after scrubbing
        // group memberships that may reference it.
        const groups = await tx.select().from(permissionGroups);
        for (const g of groups) {
          const ids = (g.memberIds as string[] | null) ?? [];
          if (ids.includes(own.id)) {
            await tx
              .update(permissionGroups)
              .set({ memberIds: ids.filter(id => id !== own.id) })
              .where(and(eq(permissionGroups.id, g.id), eq(permissionGroups.workspaceId, g.workspaceId)));
          }
        }
        await tx.delete(agentApiKeys).where(eq(agentApiKeys.agentId, own.id));
        await tx.delete(agents).where(eq(agents.id, own.id));
      }
      await tx
        .update(agents)
        .set({
          authUserId: uid,
          claimTokenHash: null,
        })
        .where(eq(agents.id, target.id));
      if (topUpCredits > 0) {
        // The claim top-up moves as a delta with its own row, not as an
        // absolute write: an absolute write races any concurrent trade and
        // leaves nothing saying where the difference came from.
        await applyCredits(tx, {
          agentId: target.id,
          workspaceId: PLATFORM_SCOPE,
          deltaUnits: toUnits(topUpCredits),
          reason: 'signup_grant',
          refId: 'claim-top-up',
        });
      }
    });

    const wsRows = await db
      .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
      .from(workspaces)
      .where(eq(workspaces.createdBy, target.id));

    res.json({
      ok: true,
      participantId: target.id,
      creditsToppedUp: topUpCredits,
      workspaces: wsRows,
    });
  }),
);
