import { Router } from 'express';
import { db } from '../db/client';
import { vaults, permissionGroups } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getGroupMemberIds } from '../lib/participants';

export const vaultsRouter = Router();

/** Check whether a participant can read a vault based on permission groups. */
async function canReadVault(
  agentId: string | undefined,
  vaultId: string,
  workspaceId: string,
  isManager: boolean,
): Promise<boolean> {
  if (isManager) return true;
  if (!agentId) return false;

  const groups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));

  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(agentId)) continue;
    const vp = (group.vaultPermissions as Record<string, { read: boolean }>) ?? {};
    if (vp[vaultId]?.read) return true;
  }
  return false;
}

/** Return the set of vault IDs the caller can read. */
async function readableVaultIds(
  agentId: string | undefined,
  workspaceId: string,
  isManager: boolean,
): Promise<Set<string> | 'all'> {
  if (isManager) return 'all';
  if (!agentId) return new Set();

  const groups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));

  const ids = new Set<string>();
  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(agentId)) continue;
    const vp = (group.vaultPermissions as Record<string, { read: boolean }>) ?? {};
    for (const [vaultId, perm] of Object.entries(vp)) {
      if (perm.read) ids.add(vaultId);
    }
  }
  return ids;
}

// GET /api/vaults - list vaults (id, name, description only; no content)
vaultsRouter.get('/', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;

  const rows = await db.select().from(vaults)
    .where(eq(vaults.workspaceId, workspaceId))
    .orderBy(vaults.name);

  const allowed = await readableVaultIds(agentId, workspaceId, capabilities.has('manage'));
  const filtered = allowed === 'all'
    ? rows
    : rows.filter(r => allowed.has(r.id));

  res.json(filtered.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
}));

// GET /api/vaults/:id - get vault with content
vaultsRouter.get('/:id', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;
  const vaultId = req.params.id as string;

  const [vault] = await db.select().from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, workspaceId)));
  if (!vault) { res.status(404).json({ error: 'Vault not found' }); return; }

  if (!(await canReadVault(agentId, vaultId, workspaceId, capabilities.has('manage')))) {
    res.status(403).json({ error: 'No read access to this vault' }); return;
  }

  res.json({
    id: vault.id,
    name: vault.name,
    description: vault.description,
    content: vault.content,
    createdAt: vault.createdAt,
    updatedAt: vault.updatedAt,
  });
}));

// POST /api/vaults - create vault (admin only)
vaultsRouter.post('/', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { name, description = '', content = '' } = req.body;

  if (!name || typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' }); return;
  }

  const id = randomUUID();
  const now = new Date();
  await db.insert(vaults).values({
    id, workspaceId,
    name: name.trim(),
    description: typeof description === 'string' ? description.trim() : '',
    content: typeof content === 'string' ? content : '',
    createdAt: now, updatedAt: now,
  });

  res.status(201).json({ id, name: name.trim(), description, content });
}));

// PUT /api/vaults/:id - update vault (admin only)
vaultsRouter.put('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const vaultId = req.params.id as string;

  const [existing] = await db.select({ id: vaults.id }).from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, workspaceId)));
  if (!existing) { res.status(404).json({ error: 'Vault not found' }); return; }

  const { name, description, content } = req.body;
  const update: Record<string, unknown> = { updatedAt: new Date() };

  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name must be a non-empty string' }); return;
    }
    update.name = name.trim();
  }
  if (description !== undefined) {
    if (typeof description !== 'string') {
      res.status(400).json({ error: 'description must be a string' }); return;
    }
    update.description = description.trim();
  }
  if (content !== undefined) {
    if (typeof content !== 'string') {
      res.status(400).json({ error: 'content must be a string' }); return;
    }
    update.content = content;
  }

  await db.update(vaults).set(update)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, workspaceId)));
  res.json({ ok: true });
}));

// DELETE /api/vaults/:id - delete vault (admin only)
vaultsRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const vaultId = req.params.id as string;

  const [existing] = await db.select({ id: vaults.id }).from(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, workspaceId)));
  if (!existing) { res.status(404).json({ error: 'Vault not found' }); return; }

  // Clean up vaultPermissions references in all permission groups
  const groups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));

  for (const group of groups) {
    const vp = (group.vaultPermissions as Record<string, { read: boolean }>) ?? {};
    if (vaultId in vp) {
      const { [vaultId]: _, ...rest } = vp;
      await db.update(permissionGroups).set({ vaultPermissions: rest })
        .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
    }
  }

  await db.delete(vaults)
    .where(and(eq(vaults.id, vaultId), eq(vaults.workspaceId, workspaceId)));
  res.status(204).send();
}));
