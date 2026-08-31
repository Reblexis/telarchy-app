import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP } from '../lib/help-catalog';

/**
 * The static discovery documents must not describe endpoints that do not exist.
 *
 * public/openapi.json, public/llms.txt and the two .well-known documents are
 * the surface AI agents read before they read anything else, and unlike the
 * live catalog nothing tied them to reality: on 2026-08-30 all four described
 * `POST /api/predictions/markets/:id/trade` with a body of `{ side, credits }`,
 * an endpoint that has never existed, and a registration body of
 * `{ name, operator }` instead of `{ agentId, workspaceId }`. An agent that
 * trusted them could not place a trade or register.
 *
 * api-parity.test.ts already pins HELP to the real routes in both directions,
 * so checking these documents against HELP checks them against the router.
 */

const ROOT = join(__dirname, '..', '..', '..');
const PUBLIC = join(ROOT, 'public');
const read = (p: string) => readFileSync(join(PUBLIC, p), 'utf8');
/** index.html is a discovery surface too: its no-JavaScript fallback and its
 *  FAQ structured data are what an agent that does not run scripts reads. */
const readRoot = (p: string) => readFileSync(join(ROOT, p), 'utf8');

/** Compare with the catalog's own placeholder style: /api/x/:id vs /api/x/{id}. */
function normalise(path: string): string {
  return path
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param')
    .replace(/\/$/, '');
}

const catalogPaths = new Set(HELP.endpoints.map(e => normalise(e.path)));

describe('discovery documents describe endpoints that exist', () => {
  test('every OpenAPI path is in the live catalog', () => {
    const spec = JSON.parse(read('openapi.json'));
    const base = (spec.servers?.[0]?.url ?? '').replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
    const missing = Object.keys(spec.paths)
      .map(p => normalise(`${base}${p}`))
      .filter(p => !catalogPaths.has(p));
    expect(missing).toEqual([]);
  });

  test('every /api path llms.txt names is in the live catalog', () => {
    // Only the paths it presents as endpoints: inside backticks, after a verb
    // or on their own. Prose mentions of /api/help and friends are covered too,
    // which is fine: they are endpoints as well.
    const text = read('llms.txt');
    const found = new Set<string>();
    for (const [, path] of text.matchAll(/`(?:GET|POST|PUT|PATCH|DELETE)?\s*(\/api\/[A-Za-z0-9_:/{}-]+)/g)) {
      found.add(normalise(path.replace(/\?.*$/, '')));
    }
    expect(found.size).toBeGreaterThan(5);
    const missing = [...found].filter(p => !catalogPaths.has(p) && !p.startsWith('/api/cron'));
    expect(missing).toEqual([]);
  });

  test('the registration body the discovery documents advertise matches the real one', () => {
    const spec = JSON.parse(read('openapi.json'));
    const schema = spec.components.schemas.RegisterAgentRequest;
    expect(schema.required).toEqual(['agentId', 'workspaceId']);

    const card = JSON.parse(read('.well-known/agent.json'));
    expect(card.authentication.registration_body_schema.required).toEqual(['agentId', 'workspaceId']);
  });

  test('agents.json only references operationIds the OpenAPI spec defines', () => {
    const spec = JSON.parse(read('openapi.json'));
    const ops = new Set<string>();
    for (const methods of Object.values(spec.paths as Record<string, Record<string, { operationId?: string }>>)) {
      for (const op of Object.values(methods)) if (op.operationId) ops.add(op.operationId);
    }
    const flows = JSON.parse(read('.well-known/agents.json'));
    const referenced = [...JSON.stringify(flows).matchAll(/"operationId":\s*"([^"]+)"/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    expect(referenced.filter(o => !ops.has(o))).toEqual([]);
  });
});

describe('no surface advertises the trade or registration shapes that never existed', () => {
  // The 2026-08-30 correction fixed openapi.json, llms.txt and two .well-known
  // documents, and an agent-readiness audit on 2026-08-31 found the same two
  // lies still live in llms-full.txt, ai-plugin.json and the home page's
  // no-JavaScript fallback, because this test only covered the first four.
  // Every surface an agent can read is checked now.
  const surfaces: Array<[string, string]> = [
    ['llms.txt', read('llms.txt')],
    ['llms-full.txt', read('llms-full.txt')],
    ['openapi.json', read('openapi.json')],
    ['.well-known/ai-plugin.json', read('.well-known/ai-plugin.json')],
    ['.well-known/agent.json', read('.well-known/agent.json')],
    ['.well-known/agents.json', read('.well-known/agents.json')],
    ['index.html', readRoot('index.html')],
  ];

  test.each(surfaces)('%s does not advertise a per-market trade endpoint', (_name, text) => {
    // The real one is POST /api/predictions/trade with a marketId in the body.
    expect(text).not.toMatch(/predictions\/markets\/[^\s"'`]*\/trade/);
    expect(text).not.toMatch(/markets\/(?::id|\{marketId\}|&lt;id&gt;|<id>)\/trade/);
  });

  test.each(surfaces)('%s does not advertise the { name, operator } registration body', (_name, text) => {
    const compact = text.replace(/\\"/g, '"').replace(/\s+/g, '');
    expect(compact).not.toContain('"operator"');
  });

  test.each(surfaces)('%s does not quote a credit grant as a number', (_name, text) => {
    // Grants are priced in a live table and moved three times in four days.
    // Name the route, link /api/earn, never write the figure.
    expect(text).not.toMatch(/[0-9][0-9,]*\s+free\s+credits/i);
  });
});
