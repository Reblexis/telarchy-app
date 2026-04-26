import { Router } from 'express';
import { db } from '../db/client';
import {
  workspaces, permissionGroups,
  markets, positions, trades, liquidityEvents,
  metrics, tasks, taskMessages, updates, metricLogs, events,
  hookWatcher, agentApiKeys,
} from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireCapability, requireIdentity } from '../middleware/roles';
import { getAuthWorkspaceMemberships } from '../middleware/auth';
import { resolveWorkspaceOwnerAgentId, provisionWorkspace } from '../lib/participants';
import { voidMarket } from '../services/markets';
import { ensureMarketsForTimePreference } from '../services/metrics';
import { getTemplate, type TemplateParams } from '../lib/templates';
import { parseVisibility, MIN_LIQUIDITY_CONTRIBUTION } from '../lib/validation';

export const workspacesRouter = Router();

async function getMembershipRoleForWorkspace(
  auth: { uid?: string; agentId?: string },
  workspaceId: string,
): Promise<string | null> {
  const memberships = await getAuthWorkspaceMemberships(auth);
  return memberships.find(membership => membership.workspaceId === workspaceId)?.memberRole ?? null;
}

workspacesRouter.post('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId, isMasterKey } = req.auth!;
  // Master API key has no real identity; use a synthetic one.
  const identity = uid ?? agentId ?? (isMasterKey ? 'admin' : undefined);
  if (!identity) { res.status(403).json({ error: 'Identity required to create a workspace' }); return; }

  const { name, template: templateId, templateParams, visibility: visibilityInput } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  let visibility: 'public' | 'unlisted' | 'private' = 'private';
  if (visibilityInput !== undefined) {
    const parsed = parseVisibility(visibilityInput);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    visibility = parsed.value;
  }

  let template;
  try {
    template = getTemplate(templateId);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
    return;
  }

  const params: TemplateParams = templateParams && typeof templateParams === 'object' ? templateParams : {};
  const templateMetrics = template.metrics(params);

  const wsId = randomUUID();
  const metricIdsWithTP: Array<{ id: string; halfLife: number }> = [];

  // For browser users, agentId may not be on req.auth if resolveUser returned null
  // (e.g. timing edge case). The identity string (uid) is the same as the agent ID
  // since ensureParticipant sets id = uid. Use it as fallback.
  const ownerAgentId = agentId ?? (uid ? uid : undefined);

  await db.transaction(async tx => {
    await provisionWorkspace(tx, {
      wsId, name: name.trim(), createdBy: identity,
      ownerAgentId, visibility,
    });

    const now = new Date();
    for (let i = 0; i < templateMetrics.length; i++) {
      const spec = templateMetrics[i];
      const id = randomUUID();
      await tx.insert(metrics).values({
        id,
        workspaceId: wsId,
        name: spec.name,
        value: spec.initialValue,
        formula: '0',
        description: spec.description,
        order: i,
        timePreference: { enabled: true, halfLife: spec.timePreferenceHalfLifeYears },
        marketRangeMax: spec.marketRangeMax,
        createdAt: now,
        updatedAt: now,
      });
      metricIdsWithTP.push({ id, halfLife: spec.timePreferenceHalfLifeYears });
    }
  });

  // Market creation touches multiple tables and emits events; keep it outside the provisioning transaction.
  for (const { id, halfLife } of metricIdsWithTP) {
    await ensureMarketsForTimePreference(id, halfLife, wsId);
  }

  res.status(201).json({
    id: wsId,
    name: name.trim(),
    visibility,
    template: template.id,
    metricsCreated: templateMetrics.length,
  });
}));

workspacesRouter.get('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;

  // Master API key (no uid/agentId): return all workspaces.
  if (!uid && !agentId) {
    const all = await db.select().from(workspaces);
    res.json(all); return;
  }

  const memberships = await getAuthWorkspaceMemberships({ uid, agentId });
  if (memberships.length === 0) { res.json([]); return; }

  const wsIds = memberships.map(m => m.workspaceId);
  const wsRows = await db.select().from(workspaces).where(inArray(workspaces.id, wsIds));
  const roleMap = Object.fromEntries(memberships.map(m => [m.workspaceId, m.memberRole]));

  res.json(wsRows.map(ws => ({ ...ws, memberRole: roleMap[ws.id] })));
}));

workspacesRouter.get('/:id/stats', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (!req.auth!.isMasterKey) {
    const memberships = await getAuthWorkspaceMemberships(req.auth!);
    if (!memberships.some(m => m.workspaceId === wsId)) {
      res.status(403).json({ error: 'Not a member of this workspace' }); return;
    }
  }
  res.json({ tradedVolume: ws.tradedVolume ?? 0 });
}));

workspacesRouter.get('/:id', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  if (!req.auth!.isMasterKey) {
    const memberships = await getAuthWorkspaceMemberships(req.auth!);
    if (!memberships.some(m => m.workspaceId === wsId)) {
      res.status(403).json({ error: 'Not a member of this workspace' }); return;
    }
  }
  res.json(ws);
}));

workspacesRouter.put('/:id/settings', requireCapability('manage'), wrap(async (req, res) => {
  const { uid, agentId, isMasterKey } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const hasAutoFundKey = Object.prototype.hasOwnProperty.call(req.body, 'autoFundNewMarkets');
  const hasCreditsKey = Object.prototype.hasOwnProperty.call(req.body, 'newMarketLiquidityCredits');
  const hasVisibilityKey = Object.prototype.hasOwnProperty.call(req.body, 'visibility');
  const touchesOwnerOnly = hasAutoFundKey || hasCreditsKey || hasVisibilityKey;

  // Master key is platform-level admin — allow it to set owner-only fields.
  // For session/agent callers, require the workspace-owner role.
  if (touchesOwnerOnly && !isMasterKey) {
    if (!uid && !agentId) {
      res.status(403).json({ error: 'These settings require a signed-in workspace owner' }); return;
    }
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (memberRole !== 'owner') {
      res.status(403).json({ error: 'Only the workspace owner can change these settings' }); return;
    }
  }

  // Verify workspace-level admin membership (if not using master key)
  if (uid || agentId) {
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (!memberRole || !['owner', 'admin'].includes(memberRole)) {
      res.status(403).json({ error: 'Only workspace owner or admin can update settings' }); return;
    }
  }

  const { name, autoFundNewMarkets, newMarketLiquidityCredits, visibility } = req.body;
  const update: Partial<typeof workspaces.$inferInsert> = {};

  if (hasVisibilityKey) {
    const parsed = parseVisibility(visibility);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    update.visibility = parsed.value;
  }

  if (name !== undefined) {
    if (typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }

  let nextAuto = ws.autoFundNewMarkets;
  let nextCredits = ws.newMarketLiquidityCredits ?? 0;
  if (hasAutoFundKey) {
    if (typeof autoFundNewMarkets !== 'boolean') {
      res.status(400).json({ error: 'autoFundNewMarkets must be a boolean' }); return;
    }
    nextAuto = autoFundNewMarkets;
  }
  if (hasCreditsKey) {
    if (typeof newMarketLiquidityCredits !== 'number' || newMarketLiquidityCredits < MIN_LIQUIDITY_CONTRIBUTION) {
      res.status(400).json({ error: `newMarketLiquidityCredits must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits` }); return;
    }
    nextCredits = newMarketLiquidityCredits;
  }

  if (hasAutoFundKey) update.autoFundNewMarkets = nextAuto;
  if (hasCreditsKey) update.newMarketLiquidityCredits = nextCredits;

  if (nextAuto && nextCredits <= 0) {
    res.status(400).json({ error: 'newMarketLiquidityCredits must be positive when auto-fund is enabled' }); return;
  }

  // Only block when this request *enables* auto-fund (true at the end while
  // it was false before, OR explicitly toggling to true). Don't punish
  // requests that just edit the name on a workspace that already has
  // auto-fund on — the owner may not yet have an agent record but the
  // setting isn't actually changing.
  const turningOn = nextAuto && (
    (hasAutoFundKey && autoFundNewMarkets === true && !ws.autoFundNewMarkets) ||
    (hasAutoFundKey && autoFundNewMarkets === true)
  );
  if (turningOn) {
    const ownerAgentId = await resolveWorkspaceOwnerAgentId(wsId);
    if (!ownerAgentId) {
      res.status(400).json({ error: 'Workspace owner must have an agent record to enable auto-fund' }); return;
    }
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: 'No fields to update' }); return;
  }

  await db.update(workspaces).set(update).where(eq(workspaces.id, wsId));
  res.json({ ok: true });
}));

workspacesRouter.post('/:id/join', requireIdentity, wrap(async (req, res) => {
  const { agentId, uid } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
  const publicGroup = groups.find(g => g.type === 'public');
  if (!publicGroup) { res.status(500).json({ error: 'Workspace public group is missing' }); return; }

  const participantId = agentId ?? uid;
  if (!participantId) { res.status(400).json({ error: 'No participant identity' }); return; }

  const currentIds = (publicGroup.memberIds as string[]) ?? [];
  const alreadyMember = currentIds.includes(participantId);

  if (!alreadyMember) {
    await db.update(permissionGroups)
      .set({ memberIds: [...currentIds, participantId] })
      .where(and(eq(permissionGroups.id, publicGroup.id), eq(permissionGroups.workspaceId, wsId)));
  }

  res.status(alreadyMember ? 200 : 201).json({ ok: true, workspaceId: wsId, role: 'member', alreadyMember });
}));

/**
 * POST /api/workspaces/:id/members
 * Admin-only: add a participant to a workspace with a specified role.
 * Requires master API key or workspace owner/admin session.
 * Body: { participantId: string, role: 'owner'|'admin'|'trader'|'viewer' }
 */
workspacesRouter.post('/:id/members', requireCapability('manage'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  // If not using master key, require workspace-level owner/admin
  if (uid || agentId) {
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (!memberRole || !['owner', 'admin'].includes(memberRole)) {
      res.status(403).json({ error: 'Only workspace owner or admin can add members' }); return;
    }
  }

  const { participantId, role } = req.body;
  if (!participantId || typeof participantId !== 'string') {
    res.status(400).json({ error: 'participantId is required' }); return;
  }
  const validRoles = ['owner', 'admin', 'trader', 'viewer'];
  if (!role || !validRoles.includes(role)) {
    res.status(400).json({ error: `role must be one of: ${validRoles.join(', ')}` }); return;
  }

  // System groups by type: 'admin' (read+trade+manage), 'trader' (read+trade),
  // 'public' (read). The role parameter maps to membership in one or more of
  // these groups so the role flag actually shapes capabilities.
  //
  //   owner / admin → admin
  //   trader        → trader (also stays in public if it was there)
  //   viewer        → public  (and removed from admin/trader if previously in)
  const groupsForRole = (r: string) =>
    r === 'owner' || r === 'admin' ? new Set(['admin'])
    : r === 'trader' ? new Set(['trader', 'public'])
    : /* viewer */     new Set(['public']);

  const targetTypes = groupsForRole(role);
  const allSystemGroups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, wsId));
  if (allSystemGroups.length === 0) {
    res.status(500).json({ error: 'Workspace system groups are missing' }); return;
  }

  for (const group of allSystemGroups) {
    if (!group.type) continue;
    const currentIds = (group.memberIds as string[] | null) ?? [];
    const inTargets = targetTypes.has(group.type);
    const isMember = currentIds.includes(participantId);
    if (inTargets && !isMember) {
      await db.update(permissionGroups)
        .set({ memberIds: [...currentIds, participantId] })
        .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, wsId)));
    } else if (!inTargets && isMember && ['admin', 'trader', 'public'].includes(group.type)) {
      await db.update(permissionGroups)
        .set({ memberIds: currentIds.filter(id => id !== participantId) })
        .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, wsId)));
    }
  }

  res.status(201).json({ ok: true, workspaceId: wsId, participantId, role });
}));

/**
 * DELETE /api/workspaces/:id
 * Owner-only: void all open markets (refund participants), then delete all workspace data.
 */
workspacesRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  if (uid || agentId) {
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (memberRole !== 'owner') {
      res.status(403).json({ error: 'Only the workspace owner can delete a workspace' }); return;
    }
  }

  // Void all unresolved markets (refunds positions to participants)
  const openMarkets = await db.select().from(markets)
    .where(and(eq(markets.workspaceId, wsId), eq(markets.resolved, false)));
  let voided = 0;
  for (const m of openMarkets) {
    await voidMarket(m, wsId);
    voided++;
  }

  // Delete all workspace-scoped data
  await db.transaction(async tx => {
    await tx.delete(liquidityEvents).where(eq(liquidityEvents.workspaceId, wsId));
    await tx.delete(positions).where(eq(positions.workspaceId, wsId));
    await tx.delete(trades).where(eq(trades.workspaceId, wsId));
    await tx.delete(markets).where(eq(markets.workspaceId, wsId));
    await tx.delete(taskMessages).where(eq(taskMessages.workspaceId, wsId));
    await tx.delete(tasks).where(eq(tasks.workspaceId, wsId));
    await tx.delete(updates).where(eq(updates.workspaceId, wsId));
    await tx.delete(metricLogs).where(eq(metricLogs.workspaceId, wsId));
    await tx.delete(events).where(eq(events.workspaceId, wsId));
    await tx.delete(metrics).where(eq(metrics.workspaceId, wsId));
    await tx.delete(permissionGroups).where(eq(permissionGroups.workspaceId, wsId));
    await tx.delete(agentApiKeys).where(eq(agentApiKeys.workspaceId, wsId));
    await tx.delete(hookWatcher).where(eq(hookWatcher.workspaceId, wsId));
    await tx.delete(workspaces).where(eq(workspaces.id, wsId));
  });

  res.json({ ok: true, voided });
}));
