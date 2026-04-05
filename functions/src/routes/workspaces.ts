import { Router } from 'express';
import { db } from '../db/client';
import {
  workspaces, userWorkspaces, permissionGroups,
  markets, positions, trades, liquidityEvents,
  metrics, tasks, taskMessages, updates, metricLogs, events,
  hookWatcher, agentApiKeys,
} from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireRole, requireIdentity } from '../middleware/roles';
import { getAuthWorkspaceMemberships } from '../middleware/auth';
import { syncLegacyWorkspaceMemberships, resolveWorkspaceOwnerAgentId, provisionWorkspace } from '../lib/participants';
import { voidMarket } from '../services/markets';

export const workspacesRouter = Router();

async function getMembershipRoleForWorkspace(
  auth: { uid?: string; agentId?: string },
  workspaceId: string,
): Promise<string | null> {
  const memberships = await getAuthWorkspaceMemberships(auth);
  return memberships.find(membership => membership.workspaceId === workspaceId)?.memberRole ?? null;
}

workspacesRouter.post('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId, role } = req.auth!;
  // Master API key (role=admin, no uid/agentId) gets a synthetic identity.
  const identity = uid ?? agentId ?? (role === 'admin' ? 'admin' : undefined);
  if (!identity) { res.status(403).json({ error: 'Identity required to create a workspace' }); return; }

  const { name } = req.body;
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  const wsId = randomUUID();

  await db.transaction(async tx => {
    await provisionWorkspace(tx, {
      wsId, name: name.trim(), createdBy: identity,
      ownerUid: uid, ownerAgentId: agentId,
    });
  });

  await syncLegacyWorkspaceMemberships(wsId);

  res.status(201).json({ id: wsId, name: name.trim(), visibility: 'private' });
}));

workspacesRouter.get('/', requireIdentity, wrap(async (req, res) => {
  const { uid, agentId, role } = req.auth!;

  // Master API key or platform admin via session — return all workspaces.
  if (!uid && !agentId) {
    const all = await db.select().from(workspaces);
    res.json(all); return;
  }

  if (role === 'admin') {
    const all = await db.select().from(workspaces);
    res.json(all.map(ws => ({ ...ws, memberRole: 'owner' }))); return;
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
  res.json({ tradedVolume: ws.tradedVolume ?? 0 });
}));

workspacesRouter.get('/:id', requireIdentity, wrap(async (req, res) => {
  const wsId = req.params.id as string;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json(ws);
}));

workspacesRouter.put('/:id/settings', requireRole('admin'), wrap(async (req, res) => {
  const { uid, agentId } = req.auth!;
  const wsId = req.params.id as string;

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, wsId));
  if (!ws) { res.status(404).json({ error: 'Workspace not found' }); return; }

  const hasAutoFundKey = Object.prototype.hasOwnProperty.call(req.body, 'autoFundNewMarkets');
  const hasCreditsKey = Object.prototype.hasOwnProperty.call(req.body, 'newMarketLiquidityCredits');
  const touchesAutoFund = hasAutoFundKey || hasCreditsKey;

  if (touchesAutoFund) {
    if (!uid && !agentId) {
      res.status(403).json({ error: 'Auto-fund settings require a signed-in workspace owner' }); return;
    }
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (memberRole !== 'owner') {
      res.status(403).json({ error: 'Only the workspace owner can change auto-fund settings' }); return;
    }
  }

  // Verify workspace-level admin membership (if not using master key)
  if (uid || agentId) {
    const memberRole = await getMembershipRoleForWorkspace({ uid, agentId }, wsId);
    if (!memberRole || !['owner', 'admin'].includes(memberRole)) {
      res.status(403).json({ error: 'Only workspace owner or admin can update settings' }); return;
    }
  }

  const { name, autoFundNewMarkets, newMarketLiquidityCredits } = req.body;
  const update: Partial<typeof workspaces.$inferInsert> = {};

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
    if (typeof newMarketLiquidityCredits !== 'number' || newMarketLiquidityCredits <= 0) {
      res.status(400).json({ error: 'newMarketLiquidityCredits must be a positive number' }); return;
    }
    nextCredits = newMarketLiquidityCredits;
  }

  if (hasAutoFundKey) update.autoFundNewMarkets = nextAuto;
  if (hasCreditsKey) update.newMarketLiquidityCredits = nextCredits;

  if (nextAuto && nextCredits <= 0) {
    res.status(400).json({ error: 'newMarketLiquidityCredits must be positive when auto-fund is enabled' }); return;
  }

  if (nextAuto) {
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

workspacesRouter.post('/:id/join', requireIdentity, wrap(async (_req, res) => {
  res.status(403).json({ error: 'This workspace is invite-only. Add members via permission groups.' });
}));

/**
 * POST /api/workspaces/:id/members
 * Admin-only: add a participant to a workspace with a specified role.
 * Requires master API key or workspace owner/admin session.
 * Body: { participantId: string, role: 'owner'|'admin'|'trader'|'viewer' }
 */
workspacesRouter.post('/:id/members', requireRole('admin'), wrap(async (req, res) => {
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

  const [existingAdmin] = await db.select().from(permissionGroups)
    .where(and(eq(permissionGroups.workspaceId, wsId), eq(permissionGroups.type, role === 'owner' || role === 'admin' ? 'admin' : 'public')));
  if (!existingAdmin) {
    res.status(500).json({ error: 'Workspace system groups are missing' }); return;
  }

  const nextMemberIds = Array.from(new Set([...(existingAdmin.memberIds as string[] ?? []), participantId]));
  await db.update(permissionGroups)
    .set({ memberIds: nextMemberIds, agentIds: nextMemberIds })
    .where(and(eq(permissionGroups.id, existingAdmin.id), eq(permissionGroups.workspaceId, wsId)));
  await syncLegacyWorkspaceMemberships(wsId);

  res.status(201).json({ ok: true, workspaceId: wsId, participantId, role });
}));

/**
 * DELETE /api/workspaces/:id
 * Owner-only: void all open markets (refund participants), then delete all workspace data.
 */
workspacesRouter.delete('/:id', requireRole('admin'), wrap(async (req, res) => {
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
    await tx.delete(userWorkspaces).where(eq(userWorkspaces.workspaceId, wsId));
    await tx.delete(workspaces).where(eq(workspaces.id, wsId));
  });

  res.json({ ok: true, voided });
}));
