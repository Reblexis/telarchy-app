/**
 * Walk an Express app's router stack and list every mounted route.
 *
 * Read by route-auth-matrix.test.ts (pins statuses), route-auth-guard.test.ts
 * (checks the deny-by-default policy against what is actually mounted), and at
 * runtime by middleware/route-policy.ts, which needs to know whether a path is
 * a real route before it decides between 401 and 404.
 */
import type { Express } from 'express';

export interface RouteRef {
  method: string;
  path: string;
}

function mountPathOf(layer: { regexp: RegExp }): string | null {
  const src = layer.regexp.source;
  // Express turns app.use('/api/agents', ...) into ^\/api\/agents\/?(?=\/|$)
  const m = /^\^((?:\\\/[^\\/?(]+)*)\\\/\?\(\?=\\\/\|\$\)/.exec(src);
  if (!m) return src === '^\\/?(?=\\/|$)' ? '' : null;
  return m[1].replace(/\\\//g, '/');
}

function collect(stack: unknown[], prefix: string, out: RouteRef[]): void {
  for (const raw of stack) {
    const layer = raw as {
      route?: { path: string; methods: Record<string, boolean> };
      name: string;
      handle: { stack?: unknown[] };
      regexp: RegExp;
    };
    if (layer.route) {
      const path = prefix + layer.route.path;
      for (const method of Object.keys(layer.route.methods)) {
        if (method === '_all') continue;
        out.push({ method: method.toUpperCase(), path });
      }
    } else if (layer.name === 'router' && layer.handle.stack) {
      const mp = mountPathOf(layer);
      if (mp === null) continue; // regex-mounted limiter, no routes of its own
      collect(layer.handle.stack, prefix + mp, out);
    }
  }
}

/** Every distinct METHOD path under /api, sorted. */
export function listApiRoutes(app: Express): RouteRef[] {
  const out: RouteRef[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  collect((app as any)._router.stack, '', out);
  const seen = new Set<string>();
  return out
    .filter(r => r.path.startsWith('/api'))
    .filter(r => {
      const k = `${r.method} ${r.path}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method));
}

/**
 * A regex per mounted route, so a request can be asked "does any route match
 * this at all" without re-implementing Express routing.
 *
 * `:param` matches one segment, `:param?` makes the preceding slash and the
 * segment optional, and `*` matches the rest. Anything this cannot express
 * would be a route shape the codebase does not use; `route-policy` fails open
 * on an unbuilt matcher, and a test pins every mounted route as matchable, so
 * the failure mode of a gap here is the behaviour we had before, never a real
 * route answering 404.
 */
export function routeMatchers(app: Express): Array<{ method: string; test: (p: string) => boolean }> {
  return listApiRoutes(app).map(r => {
    // A router mounted at /api/metrics whose own route is '/' is inventoried as
    // '/api/metrics/'. Normalise before building so the matcher accepts both
    // forms rather than only the one with the slash.
    const source = r.path
      .replace(/\/+$/, '')
      .split('/')
      .map(seg => {
        if (seg === '') return '';
        if (seg === '*') return '.*';
        if (seg.startsWith(':')) return '[^/]+';
        return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    // A trailing slash is the same route; Express treats /api/x and /api/x/ alike.
    const re = new RegExp(`^${source}/?$`);
    return { method: r.method, test: (p: string) => re.test(p) };
  });
}
