import { createPrivateKey, randomBytes, randomUUID, sign } from 'crypto';
import { and, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { permissionGroups, sources, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { getGroupMemberIds, getOwnerHandles } from '../lib/participants';
import { wrap } from '../lib/wrap';
import { requireCapability, requireIdentity } from '../middleware/roles';

export const sourcesRouter = Router();

/** Derive the public base URL for OAuth redirects. On localhost, use the
 *  request origin so the callback comes back to the local server instead
 *  of production (BETTER_AUTH_URL always points to the prod domain). */
function publicBaseUrl(req: import('express').Request): string {
  const host = req.get('host') || '';
  if (host.startsWith('127.0.0.1') || host.startsWith('localhost')) {
    return `${req.protocol}://${host}`;
  }
  return process.env.BETTER_AUTH_URL || `${req.protocol}://${host}`;
}

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
  const clientId = process.env.GITHUB_APP_CLIENT_ID;
  const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
  if (!appId || !privateKey || !slug || !clientId || !clientSecret) return null;
  return { appId, privateKey: privateKey.replace(/\\n/g, '\n'), slug, clientId, clientSecret };
}

function createAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iat: now - 60,
      exp: now + 10 * 60,
      iss: appId,
    }),
  ).toString('base64url');
  const signature = sign('sha256', Buffer.from(`${header}.${payload}`), createPrivateKey(privateKey)).toString(
    'base64url',
  );
  return `${header}.${payload}.${signature}`;
}

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
    const err = (await res.json().catch(() => ({}))) as { message?: string };
    throw new AppError(`Failed to get installation token: ${err.message || res.statusText}`, 502);
  }
  const data = (await res.json()) as { token: string };
  return data.token;
}

async function getSourceToken(source: { config: unknown }): Promise<string> {
  const app = getGitHubAppConfig();
  if (!app) throw new AppError('GitHub App is not configured', 503);
  const config = source.config as { installationId: string };
  return getInstallationToken(config.installationId, app.appId, app.privateKey);
}

/**
 * Where to send the browser back to after the GitHub install round-trip. The
 * Sources tab now lives at the canonical /{ownerHandle}/{slug}/sources path
 * (guarded by WorkspaceRouteGuard, which sets the active workspace). Returning
 * to the legacy flat /sources path went through FlatTabRedirect, which bounces
 * to /create-workspace whenever the just-reloaded SPA hasn't populated the
 * workspace list yet, so the repo picker was never reached. Resolve the
 * workspace's owner handle + slug here so we land directly on the right page
 * with the ?state= the picker needs. Falls back to the flat path if the
 * workspace has no resolvable handle/slug (should not happen post-backfill).
 */
export async function workspaceSourcesReturnPath(workspaceId: string, state: string): Promise<string> {
  const q = `?state=${encodeURIComponent(state)}`;
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId));
  if (!ws?.slug) return `/sources${q}`;
  const handle = (await getOwnerHandles([ws.createdBy])).get(ws.createdBy)?.ownerHandle ?? ws.createdBy;
  return `/${encodeURIComponent(handle)}/${encodeURIComponent(ws.slug)}/sources${q}`;
}

// ---------------------------------------------------------------------------
// Permission helpers
// ---------------------------------------------------------------------------

async function canReadSource(
  agentId: string | undefined,
  sourceId: string,
  workspaceId: string,
  isManager: boolean,
): Promise<boolean> {
  if (isManager) return true;
  if (!agentId) return false;
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(agentId)) continue;
    const sp = (group.sourcePermissions as Record<string, { read: boolean }>) ?? {};
    if (sp[sourceId]?.read) return true;
  }
  return false;
}

async function readableSourceIds(
  agentId: string | undefined,
  workspaceId: string,
  isManager: boolean,
): Promise<Set<string> | 'all'> {
  if (isManager) return 'all';
  if (!agentId) return new Set();
  const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));
  const ids = new Set<string>();
  for (const group of groups) {
    if (!getGroupMemberIds(group).includes(agentId)) continue;
    const sp = (group.sourcePermissions as Record<string, { read: boolean }>) ?? {};
    for (const [sourceId, perm] of Object.entries(sp)) {
      if (perm.read) ids.add(sourceId);
    }
  }
  return ids;
}

// ---------------------------------------------------------------------------
// GitHub App OAuth + installation flow (type='github' sources)
// ---------------------------------------------------------------------------

sourcesRouter.get(
  '/github/install',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const app = getGitHubAppConfig();
    if (!app)
      throw new AppError(
        'GitHub App is not configured (set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, GITHUB_APP_CLIENT_ID, GITHUB_APP_CLIENT_SECRET)',
        503,
      );

    const { workspaceId } = req.auth!;
    const state = randomBytes(16).toString('hex');
    installStates.set(state, { workspaceId, expiresAt: Date.now() + 10 * 60 * 1000 });

    const redirectUri = `${publicBaseUrl(req)}/api/sources/github/callback`;

    const params = new URLSearchParams({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      state,
    });

    res.redirect(`https://github.com/login/oauth/authorize?${params}`);
  }),
);

sourcesRouter.get(
  '/github/callback',
  wrap(async (req, res) => {
    const { code, state, installation_id, setup_action } = req.query as {
      code?: string;
      state?: string;
      installation_id?: string;
      setup_action?: string;
    };
    if (!state) throw new AppError('Missing state', 400);

    const stateData = installStates.get(state);
    if (!stateData || stateData.expiresAt < Date.now()) throw new AppError('Invalid or expired state', 400);

    const app = getGitHubAppConfig();
    if (!app) throw new AppError('GitHub App is not configured', 503);

    const baseUrl = publicBaseUrl(req);

    // Post-install return. When the workspace had no installation yet we send the
    // user to GitHub's "install app" page; GitHub bounces back here (to the App's
    // Setup URL) with installation_id + setup_action and no OAuth code. Record the
    // fresh installation and hand off to the repo picker.
    if (!code && installation_id && setup_action) {
      installStates.set(`install:${state}`, {
        workspaceId: String(installation_id),
        expiresAt: Date.now() + 5 * 60 * 1000,
      });
      res.redirect(`${baseUrl}${await workspaceSourcesReturnPath(stateData.workspaceId, state)}`);
      return;
    }

    if (!code) throw new AppError('Missing code or state', 400);

    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: app.clientId,
        client_secret: app.clientSecret,
        code,
      }),
    });
    const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
    if (!tokenData.access_token)
      throw new AppError(`GitHub OAuth failed: ${tokenData.error || 'no token returned'}`, 400);

    const installRes = await fetch(`${GH_API}/user/installations`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: 'application/vnd.github+json' },
    });
    const installData = (await installRes.json()) as {
      installations: Array<{ id: number; account: { login: string } }>;
    };
    const installations = installData.installations || [];

    if (installations.length === 0) {
      res.redirect(`https://github.com/apps/${app.slug}/installations/new?state=${state}`);
      return;
    }

    const installationId = String(installations[0].id);

    installStates.set(`install:${state}`, {
      workspaceId: installationId,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    res.redirect(`${baseUrl}${await workspaceSourcesReturnPath(stateData.workspaceId, state)}`);
  }),
);

sourcesRouter.get(
  '/github/repos',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { state } = req.query as { state?: string };
    if (!state) throw new AppError('Missing state parameter', 400);

    const stateData = installStates.get(state);
    const installData = installStates.get(`install:${state}`);
    if (!stateData || !installData || stateData.expiresAt < Date.now()) {
      throw new AppError('Invalid or expired state', 400);
    }
    if (stateData.workspaceId !== req.auth!.workspaceId) {
      throw new AppError('State workspace mismatch', 403);
    }

    const app = getGitHubAppConfig();
    if (!app) throw new AppError('GitHub App is not configured', 503);

    const installationId = installData.workspaceId;
    const token = await getInstallationToken(installationId, app.appId, app.privateKey);

    const repos: Array<{ full_name: string; private: boolean; default_branch: string; description: string | null }> =
      [];
    let page = 1;
    while (page <= 5) {
      const r = await fetch(`${GH_API}/installation/repositories?per_page=100&page=${page}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!r.ok) break;
      const data = (await r.json()) as {
        repositories: Array<{
          full_name: string;
          private: boolean;
          default_branch: string;
          description: string | null;
        }>;
      };
      repos.push(...data.repositories);
      if (data.repositories.length < 100) break;
      page++;
    }

    res.json({
      installationUrl: `https://github.com/settings/installations/${installationId}`,
      repos: repos.map(r => ({
        fullName: r.full_name,
        private: r.private,
        defaultBranch: r.default_branch,
        description: r.description,
      })),
    });
  }),
);

sourcesRouter.post(
  '/github/connect',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { state, repos } = req.body as { state?: string; repos?: string[] };
    if (!state || !repos || !Array.isArray(repos) || repos.length === 0) {
      throw new AppError('Missing state or repos', 400);
    }

    const stateData = installStates.get(state);
    const installData = installStates.get(`install:${state}`);
    if (!stateData || !installData || stateData.expiresAt < Date.now()) {
      throw new AppError('Invalid or expired state', 400);
    }
    if (stateData.workspaceId !== req.auth!.workspaceId) {
      throw new AppError('State workspace mismatch', 403);
    }

    const app = getGitHubAppConfig();
    if (!app) throw new AppError('GitHub App is not configured', 503);

    const installationId = installData.workspaceId;
    const token = await getInstallationToken(installationId, app.appId, app.privateKey);

    const created: Array<{ id: string; name: string; type: string; config: Record<string, unknown> }> = [];
    const { workspaceId } = req.auth!;

    for (const repo of repos) {
      const repoRes = await fetch(`${GH_API}/repos/${repo}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      });
      if (!repoRes.ok) {
        console.error(`Cannot access repo "${repo}" via installation ${installationId}`);
        continue;
      }
      const repoData = (await repoRes.json()) as { default_branch: string; full_name: string };

      const id = randomUUID();
      const now = new Date();
      const config = {
        repo: repoData.full_name,
        defaultBranch: repoData.default_branch,
        installationId,
      };

      await db.insert(sources).values({
        id,
        workspaceId,
        name: repoData.full_name,
        description: '',
        type: 'github',
        content: '',
        config,
        credentials: '',
        createdAt: now,
        updatedAt: now,
      });

      created.push({ id, name: repoData.full_name, type: 'github', config });
    }

    installStates.delete(state);
    installStates.delete(`install:${state}`);

    res.status(201).json(created);
  }),
);

// ---------------------------------------------------------------------------
// CRUD + browsing
// ---------------------------------------------------------------------------

// GET /api/sources - list sources (no content, no credentials)
/**
 * Member-only read (owner direction 2026-08-20). Anonymous callers can read a
 * public workspace's MARKET data without a key, but not its internals: this
 * endpoint answers who is in which permission group / what a source is
 * configured with, which is workspace plumbing rather than a price. An
 * identity is cheap (register, or self-join an Open workspace) and it makes
 * the read attributable.
 */
sourcesRouter.get(
  '/',
  requireIdentity,
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId, agentId, capabilities } = req.auth!;

    const rows = await db.select().from(sources).where(eq(sources.workspaceId, workspaceId)).orderBy(sources.name);

    const allowed = await readableSourceIds(agentId, workspaceId, capabilities.has('manage'));
    const filtered = allowed === 'all' ? rows : rows.filter(r => allowed.has(r.id));

    res.json(
      filtered.map(r => ({
        id: r.id,
        name: r.name,
        description: r.description,
        type: r.type,
        config: r.config,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    );
  }),
);

// GET /api/sources/:id - get source, including content for text sources
sourcesRouter.get(
  '/:id',
  requireIdentity,
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId, agentId, capabilities } = req.auth!;
    const sourceId = req.params.id as string;

    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    if (!(await canReadSource(agentId, sourceId, workspaceId, capabilities.has('manage')))) {
      res.status(403).json({ error: 'No read access to this source' });
      return;
    }

    res.json({
      id: source.id,
      name: source.name,
      description: source.description,
      type: source.type,
      content: source.type === 'text' ? source.content : undefined,
      config: source.config,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    });
  }),
);

// POST /api/sources - create a text source (GitHub sources are created via /github/connect).
sourcesRouter.post(
  '/',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { name, description = '', content = '', type = 'text' } = req.body;

    if (type !== 'text') {
      res.status(400).json({
        error: 'Only type="text" sources can be created via POST. Use /api/sources/github/* for GitHub sources.',
      });
      return;
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'name is required' });
      return;
    }

    const id = randomUUID();
    const now = new Date();
    await db.insert(sources).values({
      id,
      workspaceId,
      name: name.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      type: 'text',
      content: typeof content === 'string' ? content : '',
      config: {},
      credentials: '',
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id, name: name.trim(), description, type: 'text', content });
  }),
);

// PUT /api/sources/:id - update name/description (any type), content (text only).
sourcesRouter.put(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const sourceId = req.params.id as string;

    const [existing] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    if (!existing) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    const { name, description, content } = req.body;
    const update: Record<string, unknown> = { updatedAt: new Date() };

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ error: 'name must be a non-empty string' });
        return;
      }
      update.name = name.trim();
    }
    if (description !== undefined) {
      if (typeof description !== 'string') {
        res.status(400).json({ error: 'description must be a string' });
        return;
      }
      update.description = description.trim();
    }
    if (content !== undefined) {
      if (existing.type !== 'text') {
        res.status(400).json({ error: 'content can only be updated on text sources' });
        return;
      }
      if (typeof content !== 'string') {
        res.status(400).json({ error: 'content must be a string' });
        return;
      }
      update.content = content;
    }

    await db
      .update(sources)
      .set(update)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    res.json({ ok: true });
  }),
);

// GET /api/sources/:id/tree - browse a GitHub source (directory listing).
sourcesRouter.get(
  '/:id/tree',
  requireIdentity,
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId, agentId, capabilities } = req.auth!;
    const sourceId = req.params.id as string;

    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    if (source.type !== 'github') {
      res.status(400).json({ error: 'Tree browsing only supported for GitHub sources' });
      return;
    }

    if (!(await canReadSource(agentId, sourceId, workspaceId, capabilities.has('manage')))) {
      res.status(403).json({ error: 'No read access to this source' });
      return;
    }

    const token = await getSourceToken(source);
    const config = source.config as { repo: string; defaultBranch: string };
    const path = (req.query.path as string) || '';
    const ref = (req.query.ref as string) || config.defaultBranch;

    const ghUrl = path
      ? `${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`
      : `${GH_API}/repos/${config.repo}/contents?ref=${ref}`;

    const ghRes = await fetch(ghUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });

    if (!ghRes.ok) {
      const err = (await ghRes.json().catch(() => ({}))) as { message?: string };
      res.status(ghRes.status === 404 ? 404 : 502).json({ error: err.message || 'GitHub API error' });
      return;
    }

    const data = (await ghRes.json()) as Array<{ name: string; path: string; type: string; size: number }>;

    if (!Array.isArray(data)) {
      res.json([{ path: (data as { path: string }).path, type: 'file', size: (data as { size: number }).size }]);
      return;
    }

    res.json(
      data.map(entry => ({
        path: entry.path,
        type: entry.type === 'dir' ? 'dir' : 'file',
        size: entry.size,
      })),
    );
  }),
);

// GET /api/sources/:id/file - read a file from a GitHub source.
sourcesRouter.get(
  '/:id/file',
  requireIdentity,
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId, agentId, capabilities } = req.auth!;
    const sourceId = req.params.id as string;

    const [source] = await db
      .select()
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    if (source.type !== 'github') {
      res.status(400).json({ error: 'File reading only supported for GitHub sources' });
      return;
    }

    if (!(await canReadSource(agentId, sourceId, workspaceId, capabilities.has('manage')))) {
      res.status(403).json({ error: 'No read access to this source' });
      return;
    }

    const token = await getSourceToken(source);
    const config = source.config as { repo: string; defaultBranch: string };
    const path = req.query.path as string;
    if (!path) {
      res.status(400).json({ error: 'path query parameter is required' });
      return;
    }
    const ref = (req.query.ref as string) || config.defaultBranch;

    const ghRes = await fetch(`${GH_API}/repos/${config.repo}/contents/${encodeURIComponent(path)}?ref=${ref}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });

    if (!ghRes.ok) {
      const err = (await ghRes.json().catch(() => ({}))) as { message?: string };
      res.status(ghRes.status === 404 ? 404 : 502).json({ error: err.message || 'GitHub API error' });
      return;
    }

    const data = (await ghRes.json()) as {
      path: string;
      content?: string;
      size: number;
      encoding?: string;
      type: string;
    };
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
  }),
);

// DELETE /api/sources/:id - delete any source + clean up permission references.
sourcesRouter.delete(
  '/:id',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const sourceId = req.params.id as string;

    const [existing] = await db
      .select({ id: sources.id })
      .from(sources)
      .where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    if (!existing) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    const groups = await db.select().from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));

    for (const group of groups) {
      const sp = (group.sourcePermissions as Record<string, { read: boolean }>) ?? {};
      if (sourceId in sp) {
        const { [sourceId]: _, ...rest } = sp;
        await db
          .update(permissionGroups)
          .set({ sourcePermissions: rest })
          .where(and(eq(permissionGroups.id, group.id), eq(permissionGroups.workspaceId, workspaceId)));
      }
    }

    await db.delete(sources).where(and(eq(sources.id, sourceId), eq(sources.workspaceId, workspaceId)));
    res.status(204).send();
  }),
);
