import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { ALL_KEY_SCOPES, WILDCARD_SCOPE } from '../lib/scopes';

/**
 * Static check that every `scope:` annotation in /api/help refers to
 * a known scope from the live vocabulary. If a scope is renamed or removed,
 * the docs would drift silently; this test fails the build instead.
 *
 * Pairs with api-parity.test.ts. Static (no DB, no server boot).
 */

const REPO_ROOT = resolve(__dirname, '../../..');
// The catalog lives in its own module since 2026-08-21 (app.ts serves it,
// Otto searches it), so the static checks read it there.
const APP_TS_PATH = join(REPO_ROOT, 'functions/src/lib/help-catalog.ts');

interface DocumentedEndpoint {
  method: string;
  path: string;
  auth: string;
  scope?: string;
}

function readDocumentedEndpoints(): DocumentedEndpoint[] {
  const src = readFileSync(APP_TS_PATH, 'utf8');
  const start = src.indexOf('endpoints: [');
  expect(start).toBeGreaterThan(0);
  const block = src.slice(start);
  // Same shape as api-parity.test.ts but also captures an optional scope field
  // sitting between auth and description.
  const re =
    /\{\s*method:\s*'([A-Z]+)',\s*path:\s*'([^']+)',\s*auth:\s*(?:'([^']+)'|(false))(?:,\s*scope:\s*'([^']+)')?/g;
  const out: DocumentedEndpoint[] = [];
  for (let m = re.exec(block); m !== null; m = re.exec(block)) {
    out.push({
      method: m[1],
      path: m[2],
      auth: m[3] ?? 'false',
      scope: m[5] ?? undefined,
    });
  }
  return out;
}

const VALID_SCOPES = new Set<string>([WILDCARD_SCOPE, ...ALL_KEY_SCOPES]);

describe('/api/help scope annotations', () => {
  let documented: DocumentedEndpoint[];
  beforeAll(() => {
    documented = readDocumentedEndpoints();
  });

  test('parses a non-empty endpoint list', () => {
    expect(documented.length).toBeGreaterThan(40);
  });

  test('every documented scope is from the live vocabulary', () => {
    const offenders = documented.filter(e => e.scope !== undefined && !VALID_SCOPES.has(e.scope));
    if (offenders.length > 0) {
      const detail = offenders.map(e => `${e.method} ${e.path} -> scope:${e.scope}`).join('\n');
      throw new Error(
        `Endpoint(s) reference unknown scopes:\n${detail}\n` + `Allowed: ${[...VALID_SCOPES].join(', ')}.`,
      );
    }
  });

  test('scope-annotated endpoints are also auth-gated (no scope on a public endpoint)', () => {
    // Optional-auth endpoints: anonymous callers are accepted, but a caller
    // presenting an agent key must still hold the scope (enforced inline in
    // the route). The annotation is meaningful there, not a drift.
    const ANONYMOUS_WITH_SCOPE = new Set(['POST /api/feedback']);
    const broken = documented.filter(
      e => e.scope !== undefined && e.auth === 'false' && !ANONYMOUS_WITH_SCOPE.has(`${e.method} ${e.path}`),
    );
    if (broken.length > 0) {
      const detail = broken.map(e => `${e.method} ${e.path}`).join('\n');
      throw new Error(`Endpoint(s) have a scope but auth: false (the scope is meaningless):\n${detail}`);
    }
  });

  test('the four key-management routes all carry account:keys', () => {
    const required: Array<[string, string]> = [
      ['GET', '/api/agents/:id/keys'],
      ['POST', '/api/agents/:id/keys'],
      ['PATCH', '/api/agents/:id/keys/:keyId'],
      ['DELETE', '/api/agents/:id/keys/:keyId'],
    ];
    for (const [method, path] of required) {
      const row = documented.find(e => e.method === method && e.path === path);
      expect({ method, path, scope: row?.scope }).toEqual({ method, path, scope: 'account:keys' });
    }
  });

  test('POST /api/agents (authenticated create) carries account:agents', () => {
    const row = documented.find(e => e.method === 'POST' && e.path === '/api/agents');
    expect(row?.scope).toBe('account:agents');
  });

  test('account-touching wallet routes carry account:wallet', () => {
    const wallet: Array<[string, string]> = [
      ['POST', '/api/agents/:id/spend'],
      ['POST', '/api/agents/:id/deposit'],
      ['PUT', '/api/agents/:id/wallet'],
      ['POST', '/api/agents/:id/withdraw'],
    ];
    for (const [method, path] of wallet) {
      const row = documented.find(e => e.method === method && e.path === path);
      expect({ method, path, scope: row?.scope }).toEqual({ method, path, scope: 'account:wallet' });
    }
  });

  test('account-read endpoints carry account:read', () => {
    const reads: Array<[string, string]> = [
      ['GET', '/api/auth/me'],
      ['GET', '/api/auth/me/export'],
      ['GET', '/api/agents/mine'],
    ];
    for (const [method, path] of reads) {
      const row = documented.find(e => e.method === method && e.path === path);
      expect({ method, path, scope: row?.scope }).toEqual({ method, path, scope: 'account:read' });
    }
  });

  test('POST /api/feedback carries account:feedback', () => {
    const row = documented.find(e => e.method === 'POST' && e.path === '/api/feedback');
    expect(row?.scope).toBe('account:feedback');
  });

  test('DELETE /api/auth/me has no scope (intentionally browser-session-only)', () => {
    // A leaked key must never be able to wipe its owner's account regardless
    // of scopes; the endpoint enforces uid presence inline. Documenting a
    // scope here would be a lie.
    const row = documented.find(e => e.method === 'DELETE' && e.path === '/api/auth/me');
    expect(row).toBeDefined();
    expect(row?.scope).toBeUndefined();
  });
});
