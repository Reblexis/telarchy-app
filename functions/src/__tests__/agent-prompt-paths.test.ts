/**
 * Every API path written into a copied agent prompt must be a route this app
 * actually mounts.
 *
 * Companion to agent-prompt-proposal.test.ts, which checks the trade call's
 * body. This one is the cheap general net: it reads `src/lib/agent-prompt.ts`
 * as text, pulls out every `METHOD /api/...` it tells an agent to call, and
 * checks each against the real router stack. A renamed or moved route now
 * breaks a test here instead of breaking a stranger's first session.
 */
process.env.API_KEY = process.env.API_KEY || 'test-master-key-for-prompt-paths';
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET || 'prompt-paths-secret-prompt-paths-1234';

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('better-auth/node', () => ({
  fromNodeHeaders: (h: Record<string, unknown>) => h,
  toNodeHandler: () => (_req: unknown, res: { status: (n: number) => { json: (b: unknown) => void } }) =>
    res.status(404).json({ error: 'auth handler stubbed in tests' }),
}));
jest.mock('../auth', () => ({ auth: { api: { getSession: async () => null } } }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from '../app';
import { listApiRoutes } from './harness/routes';

const PROMPT_SRC = join(__dirname, '..', '..', '..', 'src', 'lib', 'agent-prompt.ts');

/**
 * `METHOD /api/...` as the prompts write it. Paths carry either a real
 * placeholder the operator substitutes (`{id}`, `<slug>`) or an interpolated
 * template value (`${state.workspaceId}`), so both collapse to the `:param`
 * the router declares before comparison.
 */
function documentedCalls(src: string): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  const re = /\b(GET|POST|PUT|PATCH|DELETE)\s+((?:\$\{origin\})?\/api\/[^\s`'")]+)/g;
  for (const m of src.matchAll(re)) {
    const path = m[2]
      // The prompts are built with template literals, so an origin-prefixed
      // path arrives here as the literal text `${origin}/api/...`. Stripped
      // with a pattern rather than a string so the marker is not itself a
      // template-looking string literal.
      .replace(/^\$\{origin\}/, '')
      .replace(/\?.*$/, '')
      .replace(/\$\{[^}]+\}/g, ':p')
      .replace(/\{[^}]+\}/g, ':p')
      .replace(/<[^>]+>/g, ':p')
      .replace(/[.,;:]+$/, '')
      .replace(/\/+$/, '');
    out.push({ method: m[1], path });
  }
  return out;
}

/** A router path with its own `:params` flattened the same way. */
const flatten = (p: string) => p.replace(/:[A-Za-z_]+\??/g, ':p').replace(/\/+$/, '');

describe('paths written into the copied agent prompts', () => {
  const src = readFileSync(PROMPT_SRC, 'utf8');
  const calls = documentedCalls(src);
  const mounted = new Set(listApiRoutes(app).map(r => `${r.method} ${flatten(r.path)}`));

  test('the prompts document at least the calls we know they carry', () => {
    // Guards the regex itself: if a refactor stops it matching, the per-call
    // test below would pass vacuously on an empty list.
    expect(calls.length).toBeGreaterThanOrEqual(8);
  });

  test.each(Array.from(new Set(calls.map(c => `${c.method} ${c.path}`))))('%s is a route this app mounts', key => {
    expect({ key, mounted: mounted.has(key) }).toEqual({ key, mounted: true });
  });
});
