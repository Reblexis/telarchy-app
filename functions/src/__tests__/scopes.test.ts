import {
  ACCOUNT_SCOPE_FOR_ROUTE,
  ACCOUNT_SCOPES,
  ALL_KEY_SCOPES,
  granterCoversScopes,
  hasScope,
  intersectWorkspaceCaps,
  isValidScope,
  parseScopesInput,
  SCOPE_PRESETS,
  WILDCARD_SCOPE,
  WORKSPACE_SCOPES,
} from '../lib/scopes';
import type { Capability } from '../types';

const cap = (...c: Capability[]) => new Set<Capability>(c);

describe('scope vocabulary', () => {
  test('exposes the documented workspace and account scopes', () => {
    expect([...WORKSPACE_SCOPES]).toEqual(['workspace:read', 'workspace:trade', 'workspace:manage']);
    expect([...ACCOUNT_SCOPES]).toEqual([
      'account:read',
      'account:write',
      'account:wallet',
      'account:keys',
      'account:agents',
      'account:feedback',
    ]);
    expect(ALL_KEY_SCOPES.length).toBe(WORKSPACE_SCOPES.length + ACCOUNT_SCOPES.length);
  });
  test('the wildcard is not part of the listable scope set', () => {
    expect(ALL_KEY_SCOPES.includes(WILDCARD_SCOPE as never)).toBe(false);
  });
});

describe('isValidScope', () => {
  test('accepts every named scope and the wildcard', () => {
    for (const s of ALL_KEY_SCOPES) expect(isValidScope(s)).toBe(true);
    expect(isValidScope('*')).toBe(true);
  });
  test('rejects unknown / non-string', () => {
    expect(isValidScope('write')).toBe(false);
    expect(isValidScope('workspace:write')).toBe(false);
    expect(isValidScope('Account:Read')).toBe(false); // case-sensitive
    expect(isValidScope('')).toBe(false);
    expect(isValidScope(undefined)).toBe(false);
    expect(isValidScope(null)).toBe(false);
    expect(isValidScope(42)).toBe(false);
    expect(isValidScope(['workspace:read'])).toBe(false);
  });
});

describe('parseScopesInput', () => {
  test('returns the list verbatim when it contains only known scopes', () => {
    const r = parseScopesInput(['workspace:read', 'account:feedback']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes.sort()).toEqual(['account:feedback', 'workspace:read']);
  });
  test('rejects non-arrays', () => {
    expect(parseScopesInput('workspace:read').ok).toBe(false);
    expect(parseScopesInput(null).ok).toBe(false);
    expect(parseScopesInput({ 0: 'workspace:read' }).ok).toBe(false);
  });
  test('rejects unknown entries with a useful error', () => {
    const r = parseScopesInput(['workspace:read', 'workspace:nuke']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/workspace:nuke/);
  });
  test('expands workspace implications: trade implies read; manage implies trade and read', () => {
    const trade = parseScopesInput(['workspace:trade']);
    expect(trade.ok).toBe(true);
    if (trade.ok) expect(trade.scopes.sort()).toEqual(['workspace:read', 'workspace:trade']);

    const manage = parseScopesInput(['workspace:manage']);
    expect(manage.ok).toBe(true);
    if (manage.ok) expect(manage.scopes.sort()).toEqual(['workspace:manage', 'workspace:read', 'workspace:trade']);
  });
  test('does not expand wildcard', () => {
    const r = parseScopesInput(['*']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes).toEqual(['*']);
  });
  test('account scopes do not propagate', () => {
    const r = parseScopesInput(['account:read', 'account:wallet']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes.sort()).toEqual(['account:read', 'account:wallet']);
  });
  test('de-dupes duplicates', () => {
    const r = parseScopesInput(['workspace:read', 'workspace:read', 'account:read']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes.sort()).toEqual(['account:read', 'workspace:read']);
  });
  test('empty array is valid (a useless key but not malformed)', () => {
    const r = parseScopesInput([]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.scopes).toEqual([]);
  });
});

describe('hasScope', () => {
  test('true when the scope is present', () => {
    expect(hasScope(['workspace:read'], 'workspace:read')).toBe(true);
  });
  test('wildcard covers everything', () => {
    for (const s of ALL_KEY_SCOPES) {
      expect(hasScope(['*'], s)).toBe(true);
    }
  });
  test('false when missing or unset', () => {
    expect(hasScope(null, 'workspace:read')).toBe(false);
    expect(hasScope(undefined, 'workspace:read')).toBe(false);
    expect(hasScope([], 'workspace:read')).toBe(false);
    expect(hasScope(['account:read'], 'workspace:read')).toBe(false);
  });
});

describe('intersectWorkspaceCaps', () => {
  test('wildcard returns the cap set unchanged', () => {
    const caps = cap('read', 'trade', 'manage');
    expect([...intersectWorkspaceCaps(caps, ['*'])]).toEqual(['read', 'trade', 'manage']);
  });
  test('null/undefined scopes return the cap set unchanged (legacy keys)', () => {
    const caps = cap('read', 'trade');
    expect([...intersectWorkspaceCaps(caps, null)].sort()).toEqual(['read', 'trade']);
    expect([...intersectWorkspaceCaps(caps, undefined)].sort()).toEqual(['read', 'trade']);
  });
  test('workspace:read filters down to just read', () => {
    const caps = cap('read', 'trade', 'manage');
    expect([...intersectWorkspaceCaps(caps, ['workspace:read'])]).toEqual(['read']);
  });
  test('workspace:trade scope alone permits only what the agent can do that is read or trade', () => {
    const caps = cap('read', 'trade', 'manage');
    expect([...intersectWorkspaceCaps(caps, ['workspace:read', 'workspace:trade'])].sort()).toEqual(['read', 'trade']);
  });
  test('the lower of (caps, scopes) wins', () => {
    // Agent can only read; key has trade scope. Effective = read only.
    const caps = cap('read');
    expect([...intersectWorkspaceCaps(caps, ['workspace:read', 'workspace:trade'])]).toEqual(['read']);
  });
  test('account-only scopes leave workspace caps empty', () => {
    const caps = cap('read', 'trade');
    expect([...intersectWorkspaceCaps(caps, ['account:read'])]).toEqual([]);
  });
  test('workspace:manage scope passes manage_workspace capability through', () => {
    const caps = cap('read', 'trade', 'manage', 'manage_workspace');
    expect([...intersectWorkspaceCaps(caps, ['workspace:read', 'workspace:trade', 'workspace:manage'])].sort()).toEqual(
      ['manage', 'manage_workspace', 'read', 'trade'],
    );
  });
  test('without workspace:manage scope, manage_workspace capability is filtered out', () => {
    const caps = cap('read', 'trade', 'manage_workspace');
    expect([...intersectWorkspaceCaps(caps, ['workspace:read', 'workspace:trade'])].sort()).toEqual(['read', 'trade']);
  });
});

describe('granterCoversScopes (self-elevation guard)', () => {
  test('wildcard granter can grant anything', () => {
    expect(granterCoversScopes(['*'], ['workspace:trade', 'account:wallet'])).toBe(true);
    expect(granterCoversScopes(['*'], ['*'])).toBe(true);
  });
  test('non-wildcard granter cannot grant the wildcard', () => {
    expect(granterCoversScopes(['workspace:read', 'workspace:trade'], ['*'])).toBe(false);
  });
  test('granter that holds X can grant X', () => {
    expect(granterCoversScopes(['workspace:read', 'account:read'], ['workspace:read'])).toBe(true);
  });
  test('granter cannot grant a scope it does not have', () => {
    expect(granterCoversScopes(['workspace:read'], ['workspace:trade'])).toBe(false);
    expect(granterCoversScopes(['workspace:read'], ['account:keys'])).toBe(false);
  });
  test('an empty granter cannot grant anything', () => {
    expect(granterCoversScopes([], ['workspace:read'])).toBe(false);
    expect(granterCoversScopes(null, ['workspace:read'])).toBe(false);
  });
  test('an empty request is trivially covered by any non-empty granter', () => {
    expect(granterCoversScopes(['workspace:read'], [])).toBe(true);
  });
  test('account:keys cannot self-elevate: a key without account:keys cannot grant itself account:keys', () => {
    expect(granterCoversScopes(['workspace:read', 'workspace:trade'], ['account:keys'])).toBe(false);
  });
});

describe('SCOPE_PRESETS', () => {
  test('every preset uses only known scopes', () => {
    for (const p of Object.values(SCOPE_PRESETS)) {
      for (const s of p.scopes) {
        expect(isValidScope(s)).toBe(true);
      }
    }
  });
  test('Trader preset is least-privilege relative to wildcard (the safe default for a bot)', () => {
    const trader = SCOPE_PRESETS.trader.scopes;
    expect(trader).toContain('workspace:read');
    expect(trader).toContain('workspace:trade');
    expect(trader).not.toContain('*');
    expect(trader).not.toContain('workspace:manage');
    expect(trader.some(s => s.startsWith('account:'))).toBe(false);
  });
  test('Read-only preset cannot trade', () => {
    expect(SCOPE_PRESETS.reader.scopes).not.toContain('workspace:trade');
  });
  test('Manager preset implies trade and read', () => {
    expect(SCOPE_PRESETS.manager.scopes).toEqual(
      expect.arrayContaining(['workspace:read', 'workspace:trade', 'workspace:manage']),
    );
  });
  test('Account preset has no workspace scopes', () => {
    expect(SCOPE_PRESETS.account.scopes.every(s => s.startsWith('account:'))).toBe(true);
  });
  test('Full preset is the literal wildcard', () => {
    expect(SCOPE_PRESETS.full.scopes).toEqual(['*']);
  });
});

describe('ACCOUNT_SCOPE_FOR_ROUTE', () => {
  test('every account scope is documented against at least one route', () => {
    for (const s of ACCOUNT_SCOPES) {
      const routes = ACCOUNT_SCOPE_FOR_ROUTE[s];
      expect(Array.isArray(routes)).toBe(true);
      expect(routes.length).toBeGreaterThan(0);
    }
  });
  test('account:keys is gated against the four key-management routes', () => {
    const routes = ACCOUNT_SCOPE_FOR_ROUTE['account:keys'];
    expect(routes).toContain('GET /api/agents/:id/keys');
    expect(routes).toContain('POST /api/agents/:id/keys');
    expect(routes).toContain('PATCH /api/agents/:id/keys/:keyId');
    expect(routes).toContain('DELETE /api/agents/:id/keys/:keyId');
  });
  test('account:agents is the scope guarding POST /api/agents', () => {
    expect(ACCOUNT_SCOPE_FOR_ROUTE['account:agents']).toContain('POST /api/agents');
  });
});
