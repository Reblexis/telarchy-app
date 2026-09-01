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

describe('advertised routes are actually served', () => {
  test('every single-segment path in the sitemap has a route or is a known API surface', () => {
    const app = read('src/App.tsx');
    const sitemap = read('public/sitemap.xml');
    const paths = [...sitemap.matchAll(/<loc>https:\/\/telarchy\.com(\/[a-z0-9-]*)<\/loc>/g)]
      .map(m => m[1])
      .filter(
        p => p !== '/' && !p.startsWith('/api') && !p.endsWith('.txt') && !p.endsWith('.json') && !p.endsWith('.xml'),
      );
    expect(paths.length).toBeGreaterThan(5);
    for (const p of paths) {
      // A path we advertise and do not route falls through to the workspace
      // slug route and tells the visitor there is no market at that address
      // (which is what /guides did until 2026-08-30).
      expect(app.includes(`path="${p}"`) || app.includes(`'${p}'`)).toBe(true);
    }
  });
});

/**
 * Pictures on these pages (docs/audience-pages.md, "Pictures").
 *
 * A picture is a line in the markdown, so the doc stays the single source
 * and the FAQ the crawlers read keeps coming from the same file. The point
 * of the block is to spend fewer words: /forecast argued its case in 1,160
 * of them, and a cold visitor decides in five to ten seconds (owner ask
 * 2026-09-01, and `notes/yc-landing-explainer-2026-09-01.md`).
 */
describe('pictures', () => {
  const forecast = AUDIENCE_PAGES.find(p => p.route === '/forecast');

  test('a VIZ line becomes a picture block, named', () => {
    expect(forecast).toBeTruthy();
    const viz = forecast?.blocks.filter(b => b.kind === 'viz') ?? [];
    expect(viz.length).toBeGreaterThanOrEqual(4);
    expect(viz.map(v => (v as { name: string }).name)).toContain('conditional-pair');
  });

  test('EVERY PICTURE THE DOC NAMES IS ONE THE RENDERER KNOWS', () => {
    // A doc naming a drawing nobody wrote would ship a page with a hole in
    // it, and a hole is invisible in review.
    const doc = read('docs/audience-pages.md');
    const component = read('src/components/AudienceViz.tsx');
    const named = [...doc.matchAll(/^VIZ: (\S+)$/gm)].map(m => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const n of named) expect(component).toContain(`case '${n}'`);
  });

  test('the picture page spends WORDS, not paragraphs: /forecast is under 400', () => {
    const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
    let n = words(forecast?.h1 ?? '');
    for (const b of forecast?.blocks ?? []) {
      if (b.kind === 'p') n += words(b.lead ?? '') + words(b.text ?? '');
      if (b.kind === 'h2') n += words(b.text);
      if (b.kind === 'ol' || b.kind === 'ul') n += b.items.reduce((a, i) => a + words(i), 0);
      if (b.kind === 'faq') n += b.items.reduce((a, i) => a + words(i.q) + words(i.a), 0);
    }
    expect(n).toBeLessThan(400);
  });

  test('and the FAQ survives, because it is where the structured data comes from', () => {
    const faq = forecast?.blocks.find(b => b.kind === 'faq');
    expect(faq).toBeTruthy();
    expect((faq as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(3);
  });
});
