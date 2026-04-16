import { Router } from 'express';
import { db } from '../db/client';
import { connectors, permissionGroups } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { randomUUID, randomBytes } from 'crypto';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { requireUser } from '../middleware/roles';
import { getGroupMemberIds } from '../lib/participants';
import { AppError } from '../lib/errors';

export const connectorsRouter = Router();

// In-memory OAuth state store (short-lived, keyed by random state param)
const oauthStates = new Map<string, { workspaceId: string; expiresAt: number }>();

// Clean up expired states periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of oauthStates) {
    if (val.expiresAt < now) oauthStates.delete(key);
  }
}, 60_000);

/** GitHub API base for REST v3 */
const GH_API = 'https://api.github.com';

/** Check whether a participant can read a connector based on permission groups. */
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

/** Return the set of connector IDs the caller can read. */
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

function getGitHubOAuthConfig() {
  const clientId = process.env.GITHUB_CONNECTOR_CLIENT_ID || process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CONNECTOR_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------------
// GitHub OAuth flow
// ---------------------------------------------------------------------------

// GET /api/connectors/github/auth - start OAuth flow
connectorsRouter.get('/github/auth', requireCapability('manage'), requireUser, wrap(async (req, res) => {
  const gh = getGitHubOAuthConfig();
  if (!gh) throw new AppError('GitHub OAuth is not configured (set GITHUB_CONNECTOR_CLIENT_ID/SECRET or GITHUB_CLIENT_ID/SECRET)', 503);

  const { workspaceId } = req.auth!;
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, { workspaceId, expiresAt: Date.now() + 10 * 60 * 1000 });

  const baseUrl = process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${baseUrl}/api/connectors/github/callback`;

  const params = new URLSearchParams({
    client_id: gh.clientId,
    redirect_uri: redirectUri,
    scope: 'repo',
    state,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
}));

// GET /api/connectors/github/callback - exchange code for token
connectorsRouter.get('/github/callback', wrap(async (req, res) => {
  const { code, state } = req.query as { code?: string; state?: string };
  if (!code || !state) throw new AppError('Missing code or state', 400);

  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expiresAt < Date.now()) throw new AppError('Invalid or expired OAuth state', 400);
  oauthStates.delete(state);

  const gh = getGitHubOAuthConfig();
  if (!gh) throw new AppError('GitHub OAuth is not configured', 503);

  // Exchange code for access token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      client_id: gh.clientId,
      client_secret: gh.clientSecret,
      code,
    }),
  });
  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) throw new AppError(`GitHub OAuth failed: ${tokenData.error || 'no token returned'}`, 400);

  const accessToken = tokenData.access_token;

  // Redirect to frontend repo picker with the token in a short-lived param
  // We store the token temporarily and pass a claim ticket to the frontend
  const ticket = randomBytes(16).toString('hex');
  oauthStates.set(`ticket:${ticket}`, {
    workspaceId: stateData.workspaceId,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });
  // Store token alongside ticket (reusing the map with a different key prefix)
  oauthStates.set(`token:${ticket}`, {
    workspaceId: accessToken, // abuse workspaceId field to store token
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  const baseUrl = process.env.BETTER_AUTH_URL || `${req.protocol}://${req.get('host')}`;
  res.redirect(`${baseUrl}/connectors?ticket=${ticket}`);
}));

// GET /api/connectors/github/repos?ticket=... - list repos accessible with the OAuth token
connectorsRouter.get('/github/repos', requireCapability('manage'), wrap(async (req, res) => {
  const ticket = req.query.ticket as string | undefined;
  if (!ticket) throw new AppError('Missing ticket parameter', 400);

  const ticketData = oauthStates.get(`ticket:${ticket}`);
  const tokenData = oauthStates.get(`token:${ticket}`);
  if (!ticketData || !tokenData || ticketData.expiresAt < Date.now()) {
    throw new AppError('Invalid or expired ticket', 400);
  }

  // Verify workspace matches
  if (ticketData.workspaceId !== req.auth!.workspaceId) {
    throw new AppError('Ticket workspace mismatch', 403);
  }

  const accessToken = tokenData.workspaceId; // stored in workspaceId field
  const repos: Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }> = [];
  let page = 1;
  while (page <= 5) { // cap at 5 pages (500 repos)
    const r = await fetch(`${GH_API}/user/repos?per_page=100&page=${page}&sort=updated`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) break;
    const batch = await r.json() as Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }>;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }

  res.json(repos.map(r => ({
    fullName: r.full_name,
    private: r.private,
    defaultBranch: r.default_branch,
    description: r.description,
  })));
}));

// POST /api/connectors/github/connect - create connector from ticket + selected repo
connectorsRouter.post('/github/connect', requireCapability('manage'), wrap(async (req, res) => {
  const { ticket, repo, name } = req.body as { ticket?: string; repo?: string; name?: string };
  if (!ticket || !repo) throw new AppError('Missing ticket or repo', 400);

  const ticketData = oauthStates.get(`ticket:${ticket}`);
  const tokenData = oauthStates.get(`token:${ticket}`);
  if (!ticketData || !tokenData || ticketData.expiresAt < Date.now()) {
    throw new AppError('Invalid or expired ticket', 400);
  }
  if (ticketData.workspaceId !== req.auth!.workspaceId) {
    throw new AppError('Ticket workspace mismatch', 403);
  }

  const accessToken = tokenData.workspaceId;

  // Verify we can access the repo
  const repoRes = await fetch(`${GH_API}/repos/${repo}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
  });
  if (!repoRes.ok) throw new AppError(`Cannot access repo "${repo}"`, 400);
  const repoData = await repoRes.json() as { default_branch: string; full_name: string };

  // Clean up ticket
  oauthStates.delete(`ticket:${ticket}`);
  oauthStates.delete(`token:${ticket}`);

  const { workspaceId } = req.auth!;
  const id = randomUUID();
  const now = new Date();
  const connectorName = name?.trim() || repoData.full_name;

  await db.insert(connectors).values({
    id,
    workspaceId,
    name: connectorName,
    provider: 'github',
    providerConfig: { repo: repoData.full_name, defaultBranch: repoData.default_branch },
    credentials: accessToken,
    createdAt: now,
    updatedAt: now,
  });

  res.status(201).json({
    id,
    name: connectorName,
    provider: 'github',
    providerConfig: { repo: repoData.full_name, defaultBranch: repoData.default_branch },
    createdAt: now,
    updatedAt: now,
  });
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

  const config = connector.providerConfig as { repo: string; defaultBranch: string };
  const path = (req.query.path as string) || '';
  const ref = (req.query.ref as string) || config.defaultBranch;

  const ghUrl = path
    ? `${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`
    : `${GH_API}/repos/${config.repo}/contents?ref=${ref}`;

  const ghRes = await fetch(ghUrl, {
    headers: { Authorization: `Bearer ${connector.credentials}`, Accept: 'application/vnd.github+json' },
  });

  if (!ghRes.ok) {
    const err = await ghRes.json().catch(() => ({})) as { message?: string };
    res.status(ghRes.status === 404 ? 404 : 502).json({ error: err.message || 'GitHub API error' });
    return;
  }

  const data = await ghRes.json() as Array<{ name: string; path: string; type: string; size: number }>;

  // GitHub returns an array for directories, or a single object for files
  if (!Array.isArray(data)) {
    // It's a file, not a directory
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

  const config = connector.providerConfig as { repo: string; defaultBranch: string };
  const path = req.query.path as string;
  if (!path) { res.status(400).json({ error: 'path query parameter is required' }); return; }
  const ref = (req.query.ref as string) || config.defaultBranch;

  const ghRes = await fetch(`${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
    headers: { Authorization: `Bearer ${connector.credentials}`, Accept: 'application/vnd.github+json' },
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

  // GitHub returns base64-encoded content
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

  // Clean up connectorPermissions references in all permission groups
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
