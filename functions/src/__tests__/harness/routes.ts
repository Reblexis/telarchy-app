/**
 * Walk an Express app's router stack and list every mounted route. Shared by
 * route-auth-matrix.test.ts (pins statuses) and route-auth-guard.test.ts
 * (checks the deny-by-default policy against what is actually mounted).
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
