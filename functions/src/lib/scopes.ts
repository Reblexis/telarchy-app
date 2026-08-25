import type { Capability } from '../types';

/**
 * Per-key scopes.
 *
 * An API key's scopes are the upper bound on what the key can do, regardless
 * of what its agent could do. Effective permissions = (agent's group-derived
 * capabilities) ∩ (key scopes), per request.
 *
 * Two axes:
 *
 *   workspace:*  filters workspace capabilities (read / trade / manage) when
 *                operating inside an X-Workspace-Id workspace. Implications
 *                are inclusive: workspace:manage covers workspace:trade and
 *                workspace:read; workspace:trade covers workspace:read.
 *
 *   account:*    gates self-targeted endpoints (the caller's own profile,
 *                wallet, key management, etc.). Orthogonal to workspace caps.
 *
 * Wildcard '*' means "every scope". Existing keys created before this
 * migration are stored as ['*'] so behavior is unchanged for them. New keys
 * minted from the API page default to least-privilege at the route layer
 * (see lib/scope-presets.ts → SCOPE_PRESETS.trader).
 *
 * Browser-session callers and the master API key bypass scope checks and
 * have full access; scopes only apply to per-agent keys.
 */

export const WORKSPACE_SCOPES = ['workspace:read', 'workspace:trade', 'workspace:manage'] as const;

export const ACCOUNT_SCOPES = [
  'account:read',
  'account:write',
  'account:wallet',
  'account:keys',
  'account:agents',
  'account:feedback',
] as const;

export const ALL_KEY_SCOPES = [...WORKSPACE_SCOPES, ...ACCOUNT_SCOPES] as const;
export const WILDCARD_SCOPE = '*';

export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];
export type KeyScope = WorkspaceScope | AccountScope;
export type ScopeValue = KeyScope | typeof WILDCARD_SCOPE;

const VALID_SCOPE_SET = new Set<string>([WILDCARD_SCOPE, ...ALL_KEY_SCOPES]);

export function isValidScope(s: unknown): s is ScopeValue {
  return typeof s === 'string' && VALID_SCOPE_SET.has(s);
}

/** Validate a candidate scopes list. Empty array is allowed (a useless key,
 *  but not invalid). Duplicates are silently de-duped by the caller via Set. */
export function parseScopesInput(input: unknown): { ok: true; scopes: string[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: 'scopes must be an array of strings' };
  const out = new Set<string>();
  for (const v of input) {
    if (!isValidScope(v)) {
      return {
        ok: false,
        error: `unknown scope "${String(v)}"; allowed: ${[WILDCARD_SCOPE, ...ALL_KEY_SCOPES].join(', ')}`,
      };
    }
    out.add(v);
  }
  // Apply implications so callers don't have to set them by hand. Wildcard
  // already covers everything so we skip it in that case.
  if (!out.has(WILDCARD_SCOPE)) {
    if (out.has('workspace:manage')) {
      out.add('workspace:trade');
      out.add('workspace:read');
    }
    if (out.has('workspace:trade')) out.add('workspace:read');
  }
  return { ok: true, scopes: [...out] };
}

export function hasScope(scopes: string[] | null | undefined, target: KeyScope): boolean {
  if (!scopes) return false;
  if (scopes.includes(WILDCARD_SCOPE)) return true;
  return scopes.includes(target);
}

/** Filter a workspace capability set down to what the per-key scope allows.
 *  Wildcard scope returns the full set unchanged. Used by authMiddleware to
 *  build req.auth.capabilities for agent-key auth. */
export function intersectWorkspaceCaps(caps: Set<Capability>, scopes: string[] | null | undefined): Set<Capability> {
  if (!scopes || scopes.includes(WILDCARD_SCOPE)) return caps;
  const out = new Set<Capability>();
  if (caps.has('read') && scopes.includes('workspace:read')) out.add('read');
  if (caps.has('trade') && scopes.includes('workspace:trade')) out.add('trade');
  if (caps.has('manage') && scopes.includes('workspace:manage')) out.add('manage');
  if (caps.has('manage_workspace') && scopes.includes('workspace:manage')) out.add('manage_workspace');
  return out;
}

/** True when the granter's scopes already cover every scope in `requested`,
 *  used to enforce "an agent-key caller cannot mint a key wider than itself".
 *  Wildcard granter implies everything. */
export function granterCoversScopes(granterScopes: string[] | null | undefined, requested: string[]): boolean {
  if (!granterScopes || granterScopes.length === 0) return false;
  if (granterScopes.includes(WILDCARD_SCOPE)) return true;
  if (requested.includes(WILDCARD_SCOPE)) return false;
  return requested.every(s => granterScopes.includes(s));
}

/** Named presets surfaced in the API tab UI. Order matters for display. */
export const SCOPE_PRESETS: Record<string, { label: string; description: string; scopes: string[] }> = {
  trader: {
    label: 'Trader',
    description: 'Read workspace data and place trades. The default for bot keys.',
    scopes: ['workspace:read', 'workspace:trade'],
  },
  reader: {
    label: 'Read-only',
    description: 'View workspace data and your own account; no trades, no admin.',
    scopes: ['workspace:read', 'account:read'],
  },
  manager: {
    label: 'Workspace admin',
    description: 'Full workspace access (read, trade, admin operations).',
    scopes: ['workspace:read', 'workspace:trade', 'workspace:manage'],
  },
  account: {
    label: 'Account access',
    description: 'Manage your own account from a script: profile, wallet, register sub-agents, file feedback.',
    scopes: ['account:read', 'account:write', 'account:wallet', 'account:agents', 'account:feedback'],
  },
  full: {
    label: 'Full access',
    description: 'Wildcard. Equivalent to a legacy unrestricted key. Use only when you know you need it.',
    scopes: ['*'],
  },
};

/** Documentation: which scope each named account endpoint requires. Mirrored
 *  in /api/help and used by the auth-and-keys guide. */
export const ACCOUNT_SCOPE_FOR_ROUTE: Record<AccountScope, string[]> = {
  'account:read': ['GET /api/auth/me', 'GET /api/auth/me/export', 'GET /api/agents/mine'],
  'account:write': ['POST /api/auth/profile'],
  'account:wallet': [
    'PUT /api/agents/:id/wallet',
    'POST /api/agents/:id/deposit',
    'POST /api/agents/:id/withdraw',
    'POST /api/agents/:id/spend',
  ],
  'account:keys': [
    'GET /api/agents/:id/keys',
    'POST /api/agents/:id/keys',
    'PATCH /api/agents/:id/keys/:keyId',
    'DELETE /api/agents/:id/keys/:keyId',
  ],
  'account:agents': ['POST /api/agents'],
  'account:feedback': ['POST /api/feedback'],
};
