import { Router } from 'express';
import { db } from '../db/client';
import { connectors, permissionGroups } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID, randomBytes, createPrivateKey, sign } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { getGroupMemberIds } from '../lib/participants';
import { AppError } from '../lib/errors';

export const connectorsRouter = Router();

// In-memory state store for the installation flow (short-lived)
const installStates = new Map<string, { workspaceId: string; expiresAt: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of installStates) {
    if (val.expiresAt < now) installStates.delete(key);
  }
}, 60_000);

const GH_API = 'https://api.github.com';

// ---------------------------------------------------------------------------
// GitHub App JWT + installation token helpers
// ---------------------------------------------------------------------------

function getGitHubAppConfig() {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const slug = process.env.GITHUB_APP_SLUG;
  if (!appId || !privateKey || !slug) return null;
  return { appId, privateKey: privateKey.replace(/\\n/g, '\n'), slug };
}

/** Create a short-lived JWT to authenticate as the GitHub App itself. */
function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60,
    exp: now + 10 * 60,
    iss: appId,
  })).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), createPrivateKey(privateKey))
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/** Get an installation access token (short-lived, scoped to the repos the user granted). */
async function getInstallationToken(installationId: string, appId: string, privateKey: string): Promise<string> {
  const jwt = createAppJwt(appId, privateKey);
  const res = await fetch(`${GH_API}/app/installations/${installationId}/access_tokens`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { message?: string };
    throw new AppError(`Failed to get installation token: ${err.message || res.statusText}`, 502);
  }
  const data = await res.json() as { token: string };
  return data.token;
}

/** Get an installation token for a connector. */
async function getConnectorToken(connector: { providerConfig: unknown }): Promise<string> {
  const app = getGitHubAppConfig();
  if (!app) throw new AppError('GitHub App is not configured', 503);
  const config = connector.providerConfig as { installationId: string };
  return getInstallationToken(config.installationId, app.appId, app.privateKey);
}

// ---------------------------------------------------------------------------
// Permission helpers (same pattern as vaults)
// ---------------------------------------------------------------------------

async function canReadConnector(
  agentId: string | undefined,
  connectorId: string,
  workspaceId: string,
  isManager: boolean,
): Promise<boolean> {
  if (isManager) return true;
  if (!agentId) return false;
  const groups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));
  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(agentId)) continue;
    const cp = (group.connectorPermissions as Record<string, { read: boolean }>) ?? {};
    if (cp[connectorId]?.read) return true;
  }
  return false;
}

async function readableConnectorIds(
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
    const cp = (group.connectorPermissions as Record<string, { read: boolean }>) ?? {};
    for (const [connectorId, perm] of Object.entries(cp)) {
      if (perm.read) ids.add(connectorId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// GitHub App installation flow
// ---------------------------------------------------------------------------

// GET /api/connectors/github/install - redirect to GitHub App installation page
connectorsRouter.get('/github/install', requireCapability('manage'), wrap(async (req, res) => {
  const app = getGitHubAppConfig();
  if (!app) throw new AppError('GitHub App is not configured (set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG)', 503);

  const { workspaceId } = req.auth!;
  const state = randomBytes(16).toString('hex');
  installStates.set(state, { workspaceId, expiresAt: Date.now() + 10 * 60 * 1000 });

  res.redirect(`https://github.com/apps/${app.slug}/installations/new?state=${state}`);
}));

// GET /api/connectors/github/repos - list repos from an installation
// Called by the frontend after GitHub redirects back with installation_id + state
connectorsRouter.get('/github/repos', requireCapability('manage'), wrap(async (req, res) => {
  const { installation_id, state } = req.query as { installation_id?: string; state?: string };
  if (!installation_id || !state) throw new AppError('Missing installation_id or state', 400);

  const stateData = installStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) {
    throw new AppError('Invalid or expired state', 400);
  }
  if (stateData.workspaceId !== req.auth!.workspaceId) {
    throw new AppError('State workspace mismatch', 403);
  }

  const app = getGitHubAppConfig();
  if (!app) throw new AppError('GitHub App is not configured', 503);

  const token = await getInstallationToken(installation_id, app.appId, app.privateKey);

  const repos: Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }> = [];
  let page = 1;
  while (page <= 5) {
    const r = await fetch(`${GH_API}/installation/repositories?per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) break;
    const data = await r.json() as { repositories: Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }> };
    repos.push(...data.repositories);
    if (data.repositories.length < 100) break;
    page++;
  }

  res.json(repos.map(r => ({
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description,
  })));
}));

// POST /api/connectors/github/connect - create connector(s) from installation + selected repos
connectorsRouter.post('/github/connect', requireCapability('manage'), wrap(async (req, res) => {
  const { installation_id, state, repos } = req.body as { installation_id?: string; state?: string; repos?: string[] };
  if (!installation_id || !state || !repos || !Array.isArray(repos) || repos.length === 0) {
    throw new AppError('Missing installation_id, state, or repos', 400);
  }

  const stateData = installStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) {
    throw new AppError('Invalid or expired state', 400);
  }
  if (stateData.workspaceId !== req.auth!.workspaceId) {
    throw new AppError('State workspace mismatch', 403);
  }

  const app = getGitHubAppConfig();
  if (!app) throw new AppError('GitHub App is not configured', 503);

  const token = await getInstallationToken(installation_id, app.appId, app.privateKey);

  const created: Array<{ id: string; name: string; provider: string; providerConfig: Record<string, unknown> }> = [];
  const { workspaceId } = req.auth!;

  for (const repo of repos) {
    const repoRes = await fetch(`${GH_API}/repos/${repo}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (!repoRes.ok) {
      console.error(`Cannot access repo "${repo}" via installation ${installation_id}`);
      continue;
    }
    const repoData = await repoRes.json() as { default_branch: string; full_name: string };

    const id = randomUUID();
    const now = new Date();
    const config = {
      repo: repoData.full_name,
      defaultBranch: repoData.default_branch,
      installationId: installation_id,
    };

    await db.insert(connectors).values({
      id,
      workspaceId,
      name: repoData.full_name,
      provider: 'github',
      providerConfig: config,
      credentials: '',
      createdAt: now,
      updatedAt: now,
    });

    created.push({ id, name: repoData.full_name, provider: 'github', providerConfig: config });
  }

  // Clean up state (one-time use)
  installStates.delete(state);

  res.status(201).json(created);
}));

// ---------------------------------------------------------------------------
// CRUD + browsing
// ---------------------------------------------------------------------------

// GET /api/connectors - list connectors (no credentials)
connectorsRouter.get('/', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;

  const rows = await db.select().from(connectors)
    .where(eq(connectors.workspaceId, workspaceId))
    .orderBy(connectors.name);

  const allowed = await readableConnectorIds(agentId, workspaceId, capabilities.has('manage'));
  const filtered = allowed === 'all'
    ? rows
    : rows.filter(r => allowed.has(r.id));

  res.json(filtered.map(r => ({
    id: r.id,
    name: r.name,
    provider: r.provider,
    providerConfig: r.providerConfig,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })));
}));

// GET /api/connectors/:id - connector metadata (no credentials)
connectorsRouter.get('/:id', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;
  const connectorId = req.params.id as string;

  const [connector] = await db.select().from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, workspaceId)));
  if (!connector) { res.status(404).json({ error: 'Connector not found' }); return; }

  if (!(await canReadConnector(agentId, connectorId, workspaceId, capabilities.has('manage')))) {
    res.status(403).json({ error: 'No read access to this connector' }); return;
  }

  res.json({
    id: connector.id,
    name: connector.name,
    provider: connector.provider,
    providerConfig: connector.providerConfig,
    createdAt: connector.createdAt,
    updatedAt: connector.updatedAt,
  });
}));

// GET /api/connectors/:id/tree?path=/ - browse repo directory
connectorsRouter.get('/:id/tree', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;
  const connectorId = req.params.id as string;

  const [connector] = await db.select().from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, workspaceId)));
  if (!connector) { res.status(404).json({ error: 'Connector not found' }); return; }
  if (connector.provider !== 'github') { res.status(400).json({ error: 'Tree browsing only supported for GitHub connectors' }); return; }

  if (!(await canReadConnector(agentId, connectorId, workspaceId, capabilities.has('manage')))) {
    res.status(403).json({ error: 'No read access to this connector' }); return;
  }

  const token = await getConnectorToken(connector);
  const config = connector.providerConfig as { repo: string; defaultBranch: string };
  const path = (req.query.path as string) || '';
  const ref = (req.query.ref as string) || config.defaultBranch;

  const ghUrl = path
    ? `${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`
    : `${GH_API}/repos/${config.repo}/contents?ref=${ref}`;

  const ghRes = await fetch(ghUrl, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({})) as { message?: string };
    res.status(ghRes.status === 404 ? 404 : 502).json({ error: err.message || 'GitHub API error' });
    return;
  }

  const data = await ghRes.json() as Array<{ name: string; path: string; type: string; size: number }>;

  if (!Array.isArray(data)) {
    res.json([{ path: (data as { path: string }).path, type: 'file', size: (data as { size: number }).size }]);
    return;
  }

  res.json(data.map(entry => ({
    path: entry.path,
    type: entry.type === 'dir' ? 'dir' : 'file',
    size: entry.size,
  })));
}));

// GET /api/connectors/:id/file?path=src/index.ts - read file content
connectorsRouter.get('/:id/file', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId, agentId, capabilities } = req.auth!;
  const connectorId = req.params.id as string;

  const [connector] = await db.select().from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, workspaceId)));
  if (!connector) { res.status(404).json({ error: 'Connector not found' }); return; }
  if (connector.provider !== 'github') { res.status(400).json({ error: 'File reading only supported for GitHub connectors' }); return; }

  if (!(await canReadConnector(agentId, connectorId, workspaceId, capabilities.has('manage')))) {
    res.status(403).json({ error: 'No read access to this connector' }); return;
  }

  const token = await getConnectorToken(connector);
  const config = connector.providerConfig as { repo: string; defaultBranch: string };
  const path = req.query.path as string;
  if (!path) { res.status(400).json({ error: 'path query parameter is required' }); return; }
  const ref = (req.query.ref as string) || config.defaultBranch;

  const ghRes = await fetch(`${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
  });

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({})) as { message?: string };
    res.status(ghRes.status === 404 ? 404 : 502).json({ error: err.message || 'GitHub API error' });
    return;
  }

  const data = await ghRes.json() as { path: string; content?: string; size: number; encoding?: string; type: string };
  if (data.type === 'dir') {
    res.status(400).json({ error: 'Path is a directory, use /tree endpoint' });
    return;
  }

  const content = data.content ? Buffer.from(data.content, 'base64').toString('utf-8') : '';

  res.json({
    path: data.path,
    content,
    size: data.size,
  });
}));

// DELETE /api/connectors/:id - delete connector (admin only)
connectorsRouter.delete('/:id', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const connectorId = req.params.id as string;

  const [existing] = await db.select({ id: connectors.id }).from(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, workspaceId)));
  if (!existing) { res.status(404).json({ error: 'Connector not found' }); return; }

  const groups = await db.select().from(permissionGroups)
    .where(eq(permissionGroups.workspaceId, workspaceId));

  for (const group of groups) {
    const cp = (group.connectorPermissions as Record<string, { read: boolean }>) ?? {};
    if (connectorId in cp) {
      const { [connectorId]: _, ...rest } = cp;
      await db.update(permissionGroups).set({ connectorPermissions: rest })
        .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
    }
  }

  await db.delete(connectors)
    .where(and(eq(connectors.id, connectorId), eq(connectors.workspaceId, workspaceId)));
  res.status(204).send();
}));
