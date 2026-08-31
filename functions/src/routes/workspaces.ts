import { randomUUID } from 'crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import {
  agentApiKeys,
  agents,
  announcements,
  events,
  hookWatcher,
  liquidityEvents,
  markets,
  metricLogs,
  metrics,
  permissionGroups,
  positions,
  proposalMessages,
  proposals,
  trades,
  updates,
  workspaceOrderings,
  workspaceSlugAliases,
  workspaces,
} from '../db/schema';
import { allowLedgerAdmin } from '../lib/ledger-admin';
import { assertNotInRunningSeason } from '../lib/market-freeze';
import { getOwnerHandles, resolveOwnerSegment, resolveWorkspaceOwnerAgentId } from '../lib/participants';
import { uniqueSlugForOwner } from '../lib/slug';
import { MIN_LIQUIDITY_CONTRIBUTION, parseVisibility } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { getAuthWorkspaceMemberships } from '../middleware/auth';
import { computeCapabilities } from '../middleware/capabilities';
import { requireCapability, requireIdentity } from '../middleware/roles';
import { voidMarket } from '../services/markets';
import { createWorkspaceFromTemplate, WorkspaceCreateError } from '../services/workspace-create';
import type { AuthInfo } from '../types';

export const workspacesRouter = Router();

async function getMembershipRoleForWorkspace(
  auth: { uid?: string; agentId?: string },
  workspaceId: string,
): Promise<string | null> {
  const memberships = await getAuthWorkspaceMemberships(auth);
  return memberships.find(membership => membership.workspaceId === workspaceId)?.memberRole ?? null;
}

/** Attach ownerId/ownerHandle (the owner's URL segment) to workspace rows so
 *  clients can build the /{ownerHandle}/{slug} path without extra round-trips. */
async function withOwnerHandles<T extends { createdBy: string }>(
  rows: T[],
): Promise<Array<T & { ownerId: string | null; ownerHandle: string | null }>> {
  const handles = await getOwnerHandles(rows.map(r => r.createdBy));
  return rows.map(r => {
    const h = handles.get(r.createdBy);
    return { ...r, ownerId: h?.ownerId ?? null, ownerHandle: h?.ownerHandle ?? null };
  });
}

/** How many floors one non-admin account may open. Small on purpose: the
 *  number exists to stop a script filling the marketplace, not to ration a
 *  real operator, who asks and gets it lifted. */
const SELF_SERVE_WORKSPACE_CAP = 3;

workspacesRouter.post(
  '/',
  requireIdentity,
  wrap(async (req, res) => {
    const { uid, agentId, isMasterKey } = req.auth!;
    // Master API key has no real identity; use a synthetic one.
    const identity = uid ?? agentId ?? (isMasterKey ? 'admin' : undefined);
    if (!identity) {
      res.status(403).json({ error: 'Identity required to create a workspace' });
      return;
    }

    /**
     * The owner side is open (vision.md, "The owner side reopens", owner
     * decision 2026-08-21). It was invite-only under the trader-first
     * sequencing of 2026-08-08, and the condition that reversed it arrived as an
     * operator rather than a trader: the founder of Kleros left his email asking
     * to have his number set up and the product could not serve him.
     *
     * Two brakes remain for anyone who is not a platform admin, and both are
     * about the shopfront rather than about trust:
     *
     *  - A cap on how many floors one account can open, so a script cannot fill
     *    the marketplace.
     *  - A new floor starts UNLISTED. It is live, tradeable and shareable by
     *    link; it simply is not on telarchy.com's front list until a human puts
     *    it there. Two reasons: the home page is the shopfront, and a running
     *    prize season scores over every PUBLIC workspace (docs/seasons.md,
     *    2026-08-21), so self-serve listing would let someone open a floor,
     *    fund it from signup grants and extract that subsidy into an entered
     *    account. Listing stays a human decision until that is closed.
     */
    let requestedVisibility = req.body.visibility;
    // UNLISTED by default, for everyone including admins: visible to its
    // owner (badged on the home grid), live at its link, and one Publish
    // away from the front list. Not private (a private floor 403'd its own
    // owner all day on 2026-08-28) and not public either, because publishing
    // requires at least one metric (owner ask, same day: "there should be at
    // least one metric for it to be publishable") and a floor is born with
    // none. An explicit visibility in the request is honoured as ever.
    if (requestedVisibility === undefined) {
      requestedVisibility = 'unlisted';
    }
    if (!isMasterKey) {
      const callerId = agentId ?? uid;
      const [caller] = callerId
        ? await db.select({ platformAdmin: agents.platformAdmin }).from(agents).where(eq(agents.id, callerId))
        : [];
      if (caller?.platformAdmin !== true) {
        const [owned] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(workspaces)
          .where(eq(workspaces.createdBy, identity));
        if ((owned?.n ?? 0) >= SELF_SERVE_WORKSPACE_CAP) {
          res.status(429).json({
            error: `You already run ${owned?.n} floors, which is the limit while Telarchy is small. Tell us what you want to open and we will lift it: https://telarchy.com/contact`,
            cap: SELF_SERVE_WORKSPACE_CAP,
          });
          return;
        }
        // The 2026-08-21 unlisted clamp used to live here; retired (owner
        // decision 2026-08-28), with the subsidy-extraction risk it guarded
        // recorded as accepted in vision.md.
      }
    }

    // For browser users, agentId may not be on req.auth if resolveUser returned null
    // (e.g. timing edge case). The identity string (uid) is the same as the agent ID
    // since ensureParticipant sets id = uid. Use it as fallback.
    const ownerAgentId = agentId ?? (uid ? uid : undefined);

    let created;
    try {
      created = await createWorkspaceFromTemplate({
        identity,
        ownerAgentId,
        name: req.body.name,
        templateId: req.body.template,
        templateParams: req.body.templateParams,
        visibility: requestedVisibility,
      });
    } catch (err) {
      if (err instanceof WorkspaceCreateError) {
        res.status(400).json({ error: err.message });
        return;
      }
      throw err;
    }

    // slug + ownerHandle let the caller build the /{ownerHandle}/{slug} URL
    // straight from this response (onboarding agents hand it off to the user).
    const handles = await getOwnerHandles([identity]);
    res.status(201).json({
      ...created,
      ownerHandle: handles.get(identity)?.ownerHandle ?? null,
    });
  }),
);

workspacesRouter.get(
  '/',
  requireIdentity,
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;

    // Master API key (no uid/agentId): return all workspaces.
    if (!uid && !agentId) {
      const all = await db.select().from(workspaces);
      res.json(await withOwnerHandles(all));
      return;
    }

    const memberships = await getAuthWorkspaceMemberships({ uid, agentId });
    if (memberships.length === 0) {
      res.json([]);
      return;
    }

    const wsIds = memberships.map(m => m.workspaceId);
    const wsRows = await db.select().from(workspaces).where(inArray(workspaces.id, wsIds));
    const roleMap = Object.fromEntries(memberships.map(m => [m.workspaceId, m.memberRole]));

    // Apply the caller's personal display order (set via PUT /api/workspaces/order).
    // Ordering is keyed by the same identity used to resolve memberships (uid for
    // a browser account, else the agent id). Workspaces without a saved position
    // sort after the ordered ones, oldest first, so a freshly joined workspace
    // lands at the bottom rather than jumping around.
    const orderIdentity = uid ?? agentId!;
    const orderRows = await db.select().from(workspaceOrderings).where(eq(workspaceOrderings.identity, orderIdentity));
    const posMap = new Map(orderRows.map(r => [r.workspaceId, r.position]));
    const sorted = [...wsRows].sort((a, b) => {
      const pa = posMap.has(a.id) ? posMap.get(a.id)! : Number.POSITIVE_INFINITY;
      const pb = posMap.has(b.id) ? posMap.get(b.id)! : Number.POSITIVE_INFINITY;
      if (pa !== pb) return pa - pb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    const enriched = await withOwnerHandles(sorted);
    res.json(enriched.map(ws => ({ ...ws, memberRole: roleMap[ws.id] })));
  }),
);

/**
 * PUT /api/workspaces/order
 * Set the caller's personal display order for the workspace list (the sidebar).
 * Body: { ids: string[] } in the desired order. Per-participant, so it needs no
 * manage capability and never affects other members; ids the caller does not
 * belong to are silently dropped. GET /api/workspaces then returns rows in this
 * order. See docs/ui-conventions.md ("Sidebar").
 */
workspacesRouter.put(
  '/order',
  requireIdentity,
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;
    const identity = uid ?? agentId;
    if (!identity) {
      res
        .status(403)
        .json({ error: 'Personal workspace order requires a participant identity; the master API key has none.' });
      return;
    }

    const ids: unknown = req.body?.ids;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== 'string')) {
      res.status(400).json({ error: 'Body must be { ids: string[] }.' });
      return;
    }

    // Only order workspaces the caller actually belongs to; drop unknown ids and
    // duplicates (keeping first occurrence) so a stale client cannot poison order.
    const memberSet = new Set((await getAuthWorkspaceMemberships({ uid, agentId })).map(m => m.workspaceId));
    const seen = new Set<string>();
    const order = (ids as string[]).filter(id => {
      if (!memberSet.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });

    // Replace this identity's ordering wholesale so workspaces omitted from the
    // list (e.g. one the caller just left) don't linger with a stale position.
    await db.transaction(async tx => {
      await tx.delete(workspaceOrderings).where(eq(workspaceOrderings.identity, identity));
      if (order.length > 0) {
        await tx
          .insert(workspaceOrderings)
          .values(order.map((workspaceId, position) => ({ identity, workspaceId, position })));
      }
    });

    res.json({ ok: true, order });
  }),
);

/**
 * GET /api/workspaces/resolve?owner=<seg>&slug=<seg>
 * Maps a GitHub-style path segment pair to a workspace id. `owner` is a custom
 * id (nickname) or raw agent id; `slug` is current OR historical (renames keep
 * old slugs in workspace_slug_aliases). Returns the canonical segments and a
 * `moved` flag so the client can replace the URL when an old slug was used.
 * Declared before `/:id` so "resolve" isn't captured as an id. Pure path->id
 * lookup; visibility/membership is still enforced on the data endpoints.
 */
workspacesRouter.get(
  '/resolve',
  requireIdentity,
  wrap(async (req, res) => {
    const owner = typeof req.query.owner === 'string' ? req.query.owner : '';
    const slug = typeof req.query.slug === 'string' ? req.query.slug : '';
    if (!owner || !slug) {
      res.status(400).json({ error: 'owner and slug are required' });
      return;
    }

    const ownerAgentId = await resolveOwnerSegment(owner);
    if (!ownerAgentId) {
      res.status(404).json({ error: 'Unknown owner' });
      return;
    }

    const [alias] = await db
      .select({ workspaceId: workspaceSlugAliases.workspaceId })
      .from(workspaceSlugAliases)
      .where(
        and(
          eq(workspaceSlugAliases.ownerKey, ownerAgentId),
          sql`LOWER(${workspaceSlugAliases.slug}) = ${slug.toLowerCase()}`,
        ),
      );
    if (!alias) {
      res.status(404).json({ error: 'Unknown workspace' });
      return;
    }

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, alias.workspaceId));
    if (!ws) {
      res.status(404).json({ error: 'Unknown workspace' });
      return;
    }

    const handles = await getOwnerHandles([ws.createdBy]);
    const canonicalOwner = handles.get(ws.createdBy)?.ownerHandle ?? ws.createdBy;
    const canonicalSlug = ws.slug ?? slug;
    const moved = owner !== canonicalOwner || slug.toLowerCase() !== canonicalSlug.toLowerCase();

    res.json({ workspaceId: ws.id, canonicalOwner, canonicalSlug, moved });
  }),
);

workspacesRouter.get(
  '/:id/stats',
  requireIdentity,
  wrap(async (req, res) => {
    const wsId = req.params.id as string;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!req.auth!.isMasterKey) {
      const memberships = await getAuthWorkspaceMemberships(req.auth!);
      if (!memberships.some(m => m.workspaceId === wsId)) {
        res.status(403).json({ error: 'Not a member of this workspace' });
        return;
      }
    }
    res.json({ tradedVolume: ws.tradedVolume ?? 0 });
  }),
);

workspacesRouter.get(
  '/:id',
  requireIdentity,
  wrap(async (req, res) => {
    const wsId = req.params.id as string;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!req.auth!.isMasterKey) {
      const memberships = await getAuthWorkspaceMemberships(req.auth!);
      if (!memberships.some(m => m.workspaceId === wsId)) {
        res.status(403).json({ error: 'Not a member of this workspace' });
        return;
      }
    }
    const [enriched] = await withOwnerHandles([ws]);
    res.json(enriched);
  }),
);

workspacesRouter.put(
  '/:id/settings',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = req.params.id as string;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // The route gate checked 'manage' against the header workspace
    // (req.auth.workspaceId), but this handler acts on the path id. Re-verify
    // against the path workspace so manage rights in one workspace cannot edit
    // another workspace's settings.
    const caps =
      wsId === req.auth!.workspaceId
        ? req.auth!.capabilities
        : await computeCapabilities({
            workspaceId: wsId,
            uid: req.auth!.uid,
            agentId: req.auth!.agentId,
            isMasterKey: req.auth!.isMasterKey,
          });
    if (!caps.has('manage')) {
      res.status(403).json({ error: 'Forbidden: this identity lacks the "manage" capability in this workspace.' });
      return;
    }

    const hasAutoFundKey = Object.prototype.hasOwnProperty.call(req.body, 'autoFundNewMarkets');
    const hasCreditsKey = Object.prototype.hasOwnProperty.call(req.body, 'newMarketLiquidityCredits');
    const hasVisibilityKey = Object.prototype.hasOwnProperty.call(req.body, 'visibility');
    const hasProposalRewardKey = Object.prototype.hasOwnProperty.call(req.body, 'proposalReward');
    const hasSpamPenaltyKey = Object.prototype.hasOwnProperty.call(req.body, 'spamPenalty');
    const hasMaxPendingKey = Object.prototype.hasOwnProperty.call(req.body, 'maxPendingProposalsPerParticipant');
    const touchesLifecycleFields =
      hasAutoFundKey ||
      hasCreditsKey ||
      hasVisibilityKey ||
      hasProposalRewardKey ||
      hasSpamPenaltyKey ||
      hasMaxPendingKey;

    // Lifecycle-shaped fields (visibility, auto-fund, liquidity defaults) are
    // gated by the granular `manage_workspace` capability, which the Admin group
    // holds by default but operators can revoke per group via the Participants
    // tab. The route's outer `manage` gate is enough for everything else.
    if (touchesLifecycleFields && !caps.has('manage_workspace')) {
      res.status(403).json({ error: 'These settings require the manage_workspace capability' });
      return;
    }

    const {
      name,
      description,
      charter,
      subjectAbout,
      telarchyStartedOn,
      autoFundNewMarkets,
      newMarketLiquidityCredits,
      visibility,
      proposalReward,
      spamPenalty,
      maxPendingProposalsPerParticipant,
    } = req.body;
    const update: Partial<typeof workspaces.$inferInsert> = {};

    // description (one-liner) and charter (the owner's public commitment about
    // what they will do with the number) are the public identity of a workspace.
    // Both accept null to clear. They are plain `manage`, not manage_workspace:
    // editing the pitch is not a lifecycle change.
    for (const [key, value, max] of [
      ['description', description, 280],
      ['charter', charter, 20000],
      ['subjectAbout', subjectAbout, 4000],
    ] as const) {
      if (value === undefined) continue;
      if (value === null || (typeof value === 'string' && value.trim().length === 0)) {
        update[key] = null;
        continue;
      }
      if (typeof value !== 'string') {
        res.status(400).json({ error: `${key} must be a string or null` });
        return;
      }
      if (value.length > max) {
        res.status(400).json({ error: `${key} must be at most ${max} characters` });
        return;
      }
      update[key] = value.trim();
    }

    // The one moment the floor's year chart marks. Plain `manage`, like the
    // other identity fields: naming when you started is not a lifecycle change.
    if (Object.prototype.hasOwnProperty.call(req.body, 'telarchyStartedOn')) {
      if (telarchyStartedOn === null || telarchyStartedOn === '') {
        update.telarchyStartedOn = null;
      } else {
        const at = new Date(telarchyStartedOn as string);
        if (typeof telarchyStartedOn !== 'string' || Number.isNaN(at.getTime())) {
          res.status(400).json({ error: 'telarchyStartedOn must be an ISO date string or null' });
          return;
        }
        update.telarchyStartedOn = at;
      }
    }

    if (hasVisibilityKey) {
      // Publishing needs something to trade (owner ask 2026-08-28): a floor
      // with no metric on the public list is an empty shopfront, so the flip
      // to public is refused until the first number exists. Unlisted and
      // private stay unconditional; unpublishing is never blocked.
      if (visibility === 'public') {
        const [{ n } = { n: 0 }] = await db
          .select({ n: sql<number>`count(*)::int` })
          .from(metrics)
          .where(eq(metrics.workspaceId, wsId));
        if ((n ?? 0) === 0) {
          res.status(400).json({
            error: 'Add a number first: a floor with no metric has nothing to trade. Publish once one exists.',
          });
          return;
        }
      }
      const parsed = parseVisibility(visibility);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      update.visibility = parsed.value;
    }

    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
    }

    let nextAuto = ws.autoFundNewMarkets;
    let nextCredits = ws.newMarketLiquidityCredits ?? 0;
    if (hasAutoFundKey) {
      if (typeof autoFundNewMarkets !== 'boolean') {
        res.status(400).json({ error: 'autoFundNewMarkets must be a boolean' });
        return;
      }
      nextAuto = autoFundNewMarkets;
    }
    if (hasCreditsKey) {
      if (typeof newMarketLiquidityCredits !== 'number' || newMarketLiquidityCredits < MIN_LIQUIDITY_CONTRIBUTION) {
        res
          .status(400)
          .json({ error: `newMarketLiquidityCredits must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits` });
        return;
      }
      nextCredits = newMarketLiquidityCredits;
    }

    if (hasAutoFundKey) update.autoFundNewMarkets = nextAuto;
    if (hasCreditsKey) update.newMarketLiquidityCredits = nextCredits;

    if (hasProposalRewardKey) {
      if (typeof proposalReward !== 'number' || !Number.isFinite(proposalReward) || proposalReward < 0) {
        res.status(400).json({ error: 'proposalReward must be a non-negative number' });
        return;
      }
      update.proposalReward = proposalReward;
    }

    if (hasSpamPenaltyKey) {
      if (typeof spamPenalty !== 'number' || !Number.isFinite(spamPenalty) || spamPenalty < 0) {
        res.status(400).json({ error: 'spamPenalty must be a non-negative number' });
        return;
      }
      update.spamPenalty = spamPenalty;
    }

    if (hasMaxPendingKey) {
      if (
        typeof maxPendingProposalsPerParticipant !== 'number' ||
        !Number.isInteger(maxPendingProposalsPerParticipant) ||
        maxPendingProposalsPerParticipant < 0
      ) {
        res
          .status(400)
          .json({ error: 'maxPendingProposalsPerParticipant must be a non-negative integer (0 disables the cap)' });
        return;
      }
      update.maxPendingProposalsPerParticipant = maxPendingProposalsPerParticipant;
    }

    if (nextAuto && nextCredits <= 0) {
      res.status(400).json({ error: 'newMarketLiquidityCredits must be positive when auto-fund is enabled' });
      return;
    }

    // Only block when this request *enables* auto-fund (true at the end while
    // it was false before, OR explicitly toggling to true). Don't punish
    // requests that just edit the name on a workspace that already has
    // auto-fund on — the owner may not yet have an agent record but the
    // setting isn't actually changing.
    const turningOn =
      nextAuto &&
      ((hasAutoFundKey && autoFundNewMarkets === true && !ws.autoFundNewMarkets) ||
        (hasAutoFundKey && autoFundNewMarkets === true));
    if (turningOn) {
      const ownerAgentId = await resolveWorkspaceOwnerAgentId(wsId);
      if (!ownerAgentId) {
        res.status(400).json({ error: 'Workspace owner must have an agent record to enable auto-fund' });
        return;
      }
    }

    // Renaming regenerates the URL slug (GitHub-repo-rename style). The old slug
    // stays in workspace_slug_aliases so existing links 301-redirect to the new
    // one. Reclaiming the workspace's own former slug is allowed (excluded from
    // the uniqueness check).
    if (update.name !== undefined && update.name !== ws.name) {
      const newSlug = await uniqueSlugForOwner(db, ws.createdBy, update.name, wsId);
      if (newSlug !== ws.slug) update.slug = newSlug;
    }

    if (Object.keys(update).length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    await db.transaction(async tx => {
      await tx.update(workspaces).set(update).where(eq(workspaces.id, wsId));
      if (update.slug) {
        await tx
          .insert(workspaceSlugAliases)
          .values({ workspaceId: wsId, ownerKey: ws.createdBy, slug: update.slug, createdAt: new Date() })
          .onConflictDoNothing();
      }
      // Going private revokes open trading. Otherwise the Public group keeps the
      // `trade` capability it was granted while the workspace was Open, and the
      // next person added to that group silently gets trading rights the owner
      // believes they took away. The settings UI used to do this client-side with
      // a second call, which left every API-driven flip carrying the stale cap.
      if (update.visibility === 'private' && ws.visibility !== 'private') {
        const [publicGroup] = await tx
          .select()
          .from(permissionGroups)
          .where(and(eq(permissionGroups.workspaceId, wsId), eq(permissionGroups.type, 'public')));
        const caps = (publicGroup?.capabilities as string[] | null) ?? [];
        if (publicGroup && caps.includes('trade')) {
          await tx
            .update(permissionGroups)
            .set({ capabilities: caps.filter(c => c !== 'trade') })
            .where(eq(permissionGroups.id, publicGroup.id));
        }
      }
    });
    res.json({ ok: true, slug: update.slug ?? ws.slug });
  }),
);

const ANNOUNCEMENT_MAX_CHARS = 5000;

/** The `manage` check the route gate ran was against the HEADER workspace
 *  (req.auth.workspaceId); every handler here acts on the path id, so manage
 *  rights in one workspace must not reach into another. Same re-verification
 *  PUT /:id/settings does. */
async function canManagePathWorkspace(auth: AuthInfo, wsId: string): Promise<boolean> {
  if (wsId === auth.workspaceId) return auth.capabilities.has('manage');
  const caps = await computeCapabilities({
    workspaceId: wsId,
    uid: auth.uid,
    agentId: auth.agentId,
    isMasterKey: auth.isMasterKey,
  });
  return caps.has('manage');
}

function readAnnouncementBody(raw: unknown): { ok: true; body: string } | { ok: false; error: string } {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, error: 'body must be a non-empty string' };
  }
  const body = raw.trim();
  if (body.length > ANNOUNCEMENT_MAX_CHARS) {
    return { ok: false, error: `body must be at most ${ANNOUNCEMENT_MAX_CHARS} characters` };
  }
  return { ok: true, body };
}

/** The public shape, identical on write and on the public read route, so a
 *  client never has to reconcile two views of the same row. */
function announcementPayload(row: typeof announcements.$inferSelect) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    body: row.body,
    publishedAt: row.publishedAt,
    editedAt: row.editedAt,
    originalBody: row.originalBody,
    publishedBy: row.publishedBy ?? null,
  };
}

/** Who an announcement is attributed to: the publishing participant's
 *  nickname when that participant is not the workspace owner, null when it
 *  is the owner's own (or the master key's, which has no identity). Owner
 *  decision 2026-08-25 ("dont publish under my name"): a delegate's words,
 *  results-agent's Monday post first of all, must never read as the owner's
 *  (docs/vision.md, "Workspace announcements"). */
async function attributedPublisher(
  auth: AuthInfo,
  ws: { id: string; createdBy: string | null },
): Promise<string | null> {
  if (auth.isMasterKey || !auth.agentId) return null;
  if (ws.createdBy && ws.createdBy === auth.agentId) return null;
  const ownerAgentId = await resolveWorkspaceOwnerAgentId(ws.id);
  if (ownerAgentId && ownerAgentId === auth.agentId) return null;
  const [row] = await db
    .select({ id: agents.id, nickname: agents.nickname })
    .from(agents)
    .where(eq(agents.id, auth.agentId));
  return row?.nickname ?? row?.id ?? auth.agentId;
}

/**
 * POST /api/workspaces/:id/announcements
 *
 * Publish an announcement: prose to everyone watching the workspace, from
 * the owner or from a participant the owner granted manage, which is what a
 * charter promising "I announce material news" needs and did not have
 * (docs/vision.md, "Workspace announcements"). A non-owner publisher is
 * named on the row (publishedBy), so its words never read as the owner's.
 *
 * `publishedAt` is the database's clock, never the caller's. The only thing
 * an announcement proves is that a disclosure existed at a time, so a
 * timestamp the publisher picks would make the whole surface decorative.
 */
workspacesRouter.post(
  '/:id/announcements',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = req.params.id as string;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!(await canManagePathWorkspace(req.auth!, wsId))) {
      res.status(403).json({ error: 'Forbidden: this identity lacks the "manage" capability in this workspace.' });
      return;
    }

    const parsed = readAnnouncementBody(req.body?.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const publishedBy = await attributedPublisher(req.auth!, ws);
    const [row] = await db
      .insert(announcements)
      .values({
        id: randomUUID(),
        workspaceId: wsId,
        body: parsed.body,
        publishedBy,
      })
      .returning();
    res.status(201).json(announcementPayload(row));
  }),
);

/**
 * PUT /api/workspaces/:id/announcements/:announcementId
 *
 * Correct an announcement without erasing what was published. The first edit
 * copies the published body into `originalBody` and stamps `editedAt`; both
 * are public from then on, so a reader can always see that a correction
 * happened and what the text said before it. Later edits keep the same
 * original. There is no delete: an announcement is superseded by publishing
 * another one. The database enforces all of this (migration 0057), so this
 * handler is the convenient path to the rule, not the rule itself.
 */
workspacesRouter.put(
  '/:id/announcements/:announcementId',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const wsId = req.params.id as string;
    const announcementId = req.params.announcementId as string;
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    if (!(await canManagePathWorkspace(req.auth!, wsId))) {
      res.status(403).json({ error: 'Forbidden: this identity lacks the "manage" capability in this workspace.' });
      return;
    }

    const parsed = readAnnouncementBody(req.body?.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.error });
      return;
    }

    const [existing] = await db
      .select()
      .from(announcements)
      .where(and(eq(announcements.workspaceId, wsId), eq(announcements.id, announcementId)));
    if (!existing) {
      res.status(404).json({ error: 'Announcement not found' });
      return;
    }

    // An edit that changes nothing is not an edit: stamping editedAt on a
    // no-op save would put a correction notice on the page with nothing
    // corrected.
    if (parsed.body === existing.body) {
      res.json(announcementPayload(existing));
      return;
    }

    const [row] = await db
      .update(announcements)
      .set({
        body: parsed.body,
        editedAt: new Date(),
        // Only the FIRST edit records the original; after that it is history.
        originalBody: existing.originalBody ?? existing.body,
      })
      .where(and(eq(announcements.workspaceId, wsId), eq(announcements.id, announcementId)))
      .returning();
    res.json(announcementPayload(row));
  }),
);

workspacesRouter.post(
  '/:id/join',
  requireIdentity,
  wrap(async (req, res) => {
    const { agentId, uid } = req.auth!;
    const wsId = req.params.id as string;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    // Same rule as POST /marketplace/:workspaceId/join: visibility is the access
    // boundary, and a private workspace 404s so the UUID cannot be probed.
    if (ws.visibility === 'private') {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
    const publicGroup = groups.find(g => g.type === 'public');
    if (!publicGroup) {
      res.status(500).json({ error: 'Workspace public group is missing' });
      return;
    }

    const participantId = agentId ?? uid;
    if (!participantId) {
      res.status(400).json({ error: 'No participant identity' });
      return;
    }

    const currentIds = (publicGroup.memberIds as string[]) ?? [];
    const alreadyMember = currentIds.includes(participantId);

    if (!alreadyMember) {
      await db
        .update(permissionGroups)
        .set({ memberIds: [...currentIds, participantId] })
        .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, wsId)));
    }

    res.status(alreadyMember ? 200 : 201).json({ ok: true, workspaceId: wsId, role: 'member', alreadyMember });
  }),
);

/**
 * POST /api/workspaces/:id/members
 * Admin-only: add a participant to a workspace with a specified role.
 * Requires master API key or workspace owner/admin session.
 * Body: { participantId: string, role: 'owner'|'admin'|'trader'|'viewer' }
 */
workspacesRouter.post(
  '/:id/members',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { uid, agentId } = req.auth!;
    const wsId = req.params.id as string;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // If not using master key, require workspace-level owner/admin
    if (uid || agentId) {
      const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
      if (!memberRole || !['owner', 'admin'].includes(memberRole)) {
        res.status(403).json({ error: 'Only workspace owner or admin can add members' });
        return;
      }
    }

    const { participantId, role } = req.body;
    if (!participantId || typeof participantId !== 'string') {
      res.status(400).json({ error: 'participantId is required' });
      return;
    }
    const validRoles = ['owner', 'admin', 'trader', 'viewer'];
    if (!role || !validRoles.includes(role)) {
      res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` });
      return;
    }

    // System groups by type: 'admin' (read+trade+manage), 'trader' (read+trade),
    // 'public' (read). The role parameter maps to membership in one or more of
    // these groups so the role flag actually shapes capabilities.
    //
    //   owner / admin → admin
    //   trader        → trader (also stays in public if it was there)
    //   viewer        → public  (and removed from admin/trader if previously in)
    const groupsForRole = (r: string) =>
      r === 'owner' || r === 'admin'
        ? new Set(['admin'])
        : r === 'trader'
          ? new Set(['trader', 'public'])
          : /* viewer */ new Set(['public']);

    const targetTypes = groupsForRole(role);
    const allSystemGroups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
    if (allSystemGroups.length === 0) {
      res.status(500).json({ error: 'Workspace system groups are missing' });
      return;
    }

    for (const group of allSystemGroups) {
      if (!group.type) continue;
      const currentIds = (group.memberIds as string[] | null) ?? [];
      const inTargets = targetTypes.has(group.type);
      const isMember = currentIds.includes(participantId);
      if (inTargets && !isMember) {
        await db
          .update(permissionGroups)
          .set({ memberIds: [...currentIds, participantId] })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, wsId)));
      } else if (!inTargets && isMember && ['admin', 'trader', 'public'].includes(group.type)) {
        await db
          .update(permissionGroups)
          .set({ memberIds: currentIds.filter(id => id !== participantId) })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, wsId)));
      }
    }

    res.status(201).json({ ok: true, workspaceId: wsId, participantId, role });
  }),
);

/**
 * DELETE /api/workspaces/:id
 * Requires the `manage_workspace` capability (held by the workspace creator
 * always, and by the Admin group by default; per-group toggle in the
 * Participants tab). Voids all open markets (refunding participants) before
 * deleting all workspace data.
 */
workspacesRouter.delete(
  '/:id',
  requireCapability('manage_workspace'),
  wrap(async (req, res) => {
    const wsId = req.params.id as string;

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // The route gate checked 'manage_workspace' against the header workspace
    // (req.auth.workspaceId), but this handler acts on the path id. Re-verify
    // against the path workspace so manage rights in one workspace cannot
    // delete another.
    if (wsId !== req.auth!.workspaceId) {
      const caps = await computeCapabilities({
        workspaceId: wsId,
        uid: req.auth!.uid,
        agentId: req.auth!.agentId,
        isMasterKey: req.auth!.isMasterKey,
      });
      if (!caps.has('manage_workspace')) {
        res
          .status(403)
          .json({ error: 'Forbidden: this identity lacks the "manage_workspace" capability in this workspace.' });
        return;
      }
    }

    // A season that scores this workspace is still running: its entrants'
    // profit is measured over these markets, so removing the venue mid-season
    // reorders who gets paid (docs/market-integrity.md).
    await assertNotInRunningSeason(wsId);

    // Void all unresolved markets (refunds positions to participants)
    const openMarkets = await db
      .select()
      .from(markets)
      .where(and(eq(markets.workspaceId, wsId), eq(markets.resolved, false)));
    let voided = 0;
    for (const m of openMarkets) {
      await voidMarket(m, wsId);
      voided++;
    }

    // Delete all workspace-scoped data
    await db.transaction(async tx => {
      // Deleting a workspace takes its settlement history and its published
      // announcements with it, which is the one time that is intended; both are
      // append-only otherwise.
      await allowLedgerAdmin(tx);
      await tx.delete(announcements).where(eq(announcements.workspaceId, wsId));
      await tx.delete(liquidityEvents).where(eq(liquidityEvents.workspaceId, wsId));
      await tx.delete(positions).where(eq(positions.workspaceId, wsId));
      await tx.delete(trades).where(eq(trades.workspaceId, wsId));
      await tx.delete(markets).where(eq(markets.workspaceId, wsId));
      await tx.delete(proposalMessages).where(eq(proposalMessages.workspaceId, wsId));
      await tx.delete(proposals).where(eq(proposals.workspaceId, wsId));
      await tx.delete(updates).where(eq(updates.workspaceId, wsId));
      await tx.delete(metricLogs).where(eq(metricLogs.workspaceId, wsId));
      await tx.delete(events).where(eq(events.workspaceId, wsId));
      await tx.delete(metrics).where(eq(metrics.workspaceId, wsId));
      await tx.delete(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
      await tx.delete(agentApiKeys).where(eq(agentApiKeys.workspaceId, wsId));
      await tx.delete(hookWatcher).where(eq(hookWatcher.workspaceId, wsId));
      await tx.delete(workspaceSlugAliases).where(eq(workspaceSlugAliases.workspaceId, wsId));
      await tx.delete(workspaces).where(eq(workspaces.id, wsId));
    });

    res.json({ ok: true, voided });
  }),
);
