/**
 * The audience pages (docs/audience-pages.md) are served with their own head:
 * title, description, canonical URL and FAQPage structured data, because
 * crawlers and link scrapers do not run the SPA. Pin the surgery on
 * index.html and the sync between the generated meta and the markdown, the
 * way share-meta.test.ts and guides-content.test.ts do for their sources.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { audienceJsonLd, audienceRoutes, injectAudienceMeta, isAudienceRoute } from '../lib/audience-meta';
import { AUDIENCE_META } from '../lib/audience-meta.generated';

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Telarchy</title>
    <meta name="description" content="Generic site description.">
    <meta property="og:title" content="Telarchy">
    <meta name="twitter:card" content="summary">
    <link rel="icon" href="/favicon.ico">
  </head>
  <body><div id="root"></div></body>
</html>`;

const DOC = readFileSync(join(__dirname, '..', '..', '..', 'docs', 'audience-pages.md'), 'utf8');

describe('audience meta stays in sync with docs/audience-pages.md', () => {
  const headers = [...DOC.matchAll(/^## (\/\S+) \(/gm)].map(m => m[1]);

  test('every page in the markdown has meta, and nothing else does', () => {
    expect(audienceRoutes().sort()).toEqual([...headers].sort());
    expect(headers).toContain('/forecast');
    expect(headers).toContain('/owners');
  });

  test('title, description and FAQ count match the markdown', () => {
    for (const route of headers) {
      const start = DOC.indexOf(`## ${route} (`);
      const next = DOC.indexOf('\n## ', start + 1);
      const section = DOC.slice(start, next === -1 ? undefined : next);
      const title = /^Title: (.*)$/m.exec(section)?.[1];
      const description = /^Description: (.*)$/m.exec(section)?.[1];
      const questions = section.match(/^Q: /gm)?.length ?? 0;
      expect(AUDIENCE_META[route].title).toBe(title);
      expect(AUDIENCE_META[route].description).toBe(description);
      expect(AUDIENCE_META[route].faq).toHaveLength(questions);
      expect(questions).toBeGreaterThan(0);
    }
  });

  test('the copy carries no em or en dash and never leads with the mechanism', () => {
    expect(DOC).not.toMatch(/[–—]/);
    for (const route of headers) {
      // The first sentence of the description names the job, not "prediction market".
      const first = AUDIENCE_META[route].description.split('.')[0].toLowerCase();
      expect(first).not.toContain('prediction market');
    }
  });
});

describe('injectAudienceMeta', () => {
  test('swaps the title, drops the static competing tags, adds canonical and FAQ structured data', () => {
    const out = injectAudienceMeta(HTML, '/forecast', 'https://telarchy.com/forecast');
    // Apostrophes in the copy are escaped in attributes and the title alike.
    const esc = (s: string) => s.replace(/'/g, '&#39;');
    expect(out).toContain(`<title>${esc(AUDIENCE_META['/forecast'].title)}</title>`);
    expect(out).toContain(`content="${esc(AUDIENCE_META['/forecast'].description)}"`);
    expect(out).toContain('<link rel="canonical" href="https://telarchy.com/forecast">');
    expect(out).toContain('og:url" content="https://telarchy.com/forecast"');
    expect(out).not.toContain('Generic site description.');
    expect(out).not.toContain('content="Telarchy"');
    expect(out).toContain('<link rel="icon" href="/favicon.ico">');
    expect(out).toContain('<div id="root"></div>');
    const ld = /<script type="application\/ld\+json">(.*?)<\/script>/s.exec(out)?.[1];
    expect(ld).toBeTruthy();
    const parsed = JSON.parse(ld as string);
    const faq = parsed['@graph'].find((n: { '@type': string }) => n['@type'] === 'FAQPage');
    expect(faq.mainEntity).toHaveLength(AUDIENCE_META['/forecast'].faq.length);
    expect(faq.mainEntity[0].name).toBe(AUDIENCE_META['/forecast'].faq[0].q);
  });

  test('hubs carry a SoftwareApplication node, comparisons do not', () => {
    const hub = JSON.parse(audienceJsonLd('/owners', 'https://telarchy.com/owners'));
    const cmp = JSON.parse(audienceJsonLd('/compare/manifold', 'https://telarchy.com/compare/manifold'));
    const types = (g: { '@graph': { '@type': string }[] }) => g['@graph'].map(n => n['@type']);
    expect(types(hub)).toEqual(['FAQPage', 'SoftwareApplication']);
    expect(types(cmp)).toEqual(['FAQPage']);
  });

  test('a script element can never be closed from inside the JSON', () => {
    for (const route of audienceRoutes()) {
      expect(audienceJsonLd(route, `https://telarchy.com${route}`)).not.toContain('</');
    }
  });

  test('unknown routes are untouched', () => {
    expect(isAudienceRoute('/lookpilot')).toBe(false);
    expect(injectAudienceMeta(HTML, '/lookpilot', 'https://telarchy.com/lookpilot')).toBe(HTML);
  });
});

describe('app route heads', () => {
  const { ROUTE_HEADS } = require('../lib/audience-meta.generated');
  const { isHeadRoute, headRoutes, injectRouteHead } = require('../lib/audience-meta');

  test('the six duplicate routes from the crawl each get their own head', () => {
    for (const r of ['/marketplace', '/signup', '/login', '/guides', '/leaderboard', '/season']) {
      expect(isHeadRoute(r)).toBe(true);
    }
    // The home page keeps the canonical slogan head from index.html.
    expect(isHeadRoute('/')).toBe(false);
    // No overlap with the audience pages, which carry richer heads.
    for (const r of headRoutes()) expect(AUDIENCE_META[r]).toBeUndefined();
  });

  test('stays in sync with the markdown section', () => {
    const lines = [...DOC.matchAll(/^- (\/\S+) \| /gm)].map(m => m[1]);
    expect(headRoutes().sort()).toEqual(lines.sort());
  });

  test('swaps title, description, canonical and the fallback heading; no structured data', () => {
    const shell = HTML.replace(
      '<body><div id="root"></div></body>',
      '<body><div id="root"><main class="ssr-fallback"><h1 style="x">Telarchy: say what you want</h1></main></div></body>',
    );
    const out = injectRouteHead(shell, '/season', 'https://telarchy.com/season');
    const esc = (x: string) => x.replace(/'/g, '&#39;').replace(/&(?!#?\w+;)/g, '&amp;');
    expect(out).toContain(`<title>${esc(ROUTE_HEADS['/season'].title)}</title>`);
    expect(out).toContain('<link rel="canonical" href="https://telarchy.com/season">');
    expect(out).toContain('<h1 style="x">Season 0 pays the top five forecasters</h1>');
    expect(out).not.toContain('Generic site description.');
    expect(out).not.toContain('application/ld+json');
    expect(out).toContain('<div id="root">');
  });

  test('unknown routes untouched by the head injector', () => {
    expect(injectRouteHead(HTML, '/whatever', 'https://telarchy.com/whatever')).toBe(HTML);
  });
});
