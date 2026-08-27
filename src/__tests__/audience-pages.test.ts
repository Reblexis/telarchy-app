import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { AUDIENCE_PAGES } from '../content/audiencePages.generated';

/**
 * The audience pages are one list of routes that several files must agree
 * on: the router, the server's reserved names (so a workspace slug can never
 * shadow /owners), the sitemap, llms.txt and the generated meta. Pin the
 * agreement here so adding a page to docs/audience-pages.md and forgetting
 * one of them fails loudly. Copy: docs/audience-pages.md.
 */

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');
const routes = AUDIENCE_PAGES.map(p => p.route);

describe('audience pages', () => {
  test('there are seven, each with a title, description, H1, FAQ and a call to action', () => {
    expect(routes).toHaveLength(7);
    for (const p of AUDIENCE_PAGES) {
      expect(p.title.length).toBeGreaterThan(20);
      expect(p.description.length).toBeGreaterThan(60);
      expect(p.description.length).toBeLessThan(220);
      expect(p.h1.length).toBeGreaterThan(8);
      expect(p.blocks.some(b => b.kind === 'faq')).toBe(true);
      if (!p.route.startsWith('/compare/')) expect(p.cta.length).toBeGreaterThan(0);
    }
  });

  test('every route is in the router, the sitemap, llms.txt and the server meta', () => {
    const app = read('src/App.tsx');
    const sitemap = read('public/sitemap.xml');
    const llms = read('public/llms.txt');
    const meta = read('functions/src/lib/audience-meta.generated.ts');
    for (const r of routes) {
      expect(app).toContain(`'${r}'`);
      expect(sitemap).toContain(`<loc>https://telarchy.com${r}</loc>`);
      expect(llms).toContain(`https://telarchy.com${r}`);
      expect(meta).toContain(`"${r}"`);
    }
  });

  test('single-segment routes are reserved on the server so no workspace slug can shadow them', () => {
    const server = read('functions/src/server.ts');
    for (const r of routes.filter(r => r.split('/').length === 2)) {
      expect(server).toContain(`'${r.slice(1)}',`);
    }
  });

  test('the sibling navigation on the pages covers every route once', () => {
    const src = read('src/pages/AudiencePage.tsx');
    const lists = src.slice(src.indexOf('FORECASTER_ROUTES ='), src.indexOf('SIBLING_LABELS'));
    for (const r of routes) {
      expect(lists.split(`'${r}'`).length - 1).toBe(1);
      expect(src).toContain(`'${r}': `);
    }
  });

  test('no dash of the AI kind anywhere in the copy', () => {
    expect(JSON.stringify(AUDIENCE_PAGES)).not.toMatch(/[–—]/);
  });
});
