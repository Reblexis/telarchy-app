/**
 * Head injection for the audience pages (/forecast, /for-agents, /owners,
 * /compare/*).
 *
 * These pages exist to be found from a search or an AI answer, and neither a
 * crawler's first pass nor a link scraper runs the SPA. So the server
 * rewrites the head of index.html for exactly these routes with the page's
 * own title, description and FAQPage structured data (plus a
 * SoftwareApplication node on the three hubs), the same string surgery
 * share-meta.ts does for workspace links. The copy comes from
 * docs/audience-pages.md through scripts/build-audience-pages.mjs; this
 * file only knows how to put it in the head.
 */
import { AUDIENCE_META, ROUTE_HEADS } from './audience-meta.generated';

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ESCAPES[c]);
}

const HUBS = new Set(['/forecast', '/for-agents', '/owners']);

export function isAudienceRoute(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(AUDIENCE_META, path);
}

export function audienceRoutes(): string[] {
  return Object.keys(AUDIENCE_META);
}

export function audienceJsonLd(route: string, url: string): string {
  const meta = AUDIENCE_META[route];
  const graph: unknown[] = [
    {
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: meta.faq.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ];
  if (HUBS.has(route)) {
    graph.push({
      '@type': 'SoftwareApplication',
      '@id': 'https://telarchy.com/#app',
      name: 'Telarchy',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: 'https://telarchy.com',
      description: meta.description,
    });
  }
  // JSON inside a script element: "</" must not appear literally.
  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/<\//g, '<\\/');
}

export function injectAudienceMeta(html: string, route: string, url: string): string {
  const meta = AUDIENCE_META[route];
  if (!meta) return html;
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const tags = [
    `<meta name="description" content="${description}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="https://telarchy.com/logo.png">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    `<script type="application/ld+json">${audienceJsonLd(route, url)}</script>`,
  ].join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta\s+(?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
}

/**
 * The app's own public routes (/marketplace, /signup, ...) share one SPA
 * shell, so a crawl reads them as six copies of the home page (Ploy's site
 * audit, 2026-08-28). For these exact paths the server swaps the title,
 * description, canonical and Open Graph tags, and the heading of the no-JS
 * fallback, so each route states its own intent. No structured data: these
 * are app doors, not documents. Copy: docs/audience-pages.md, "App route
 * heads".
 */
export function isHeadRoute(path: string): boolean {
  return Object.prototype.hasOwnProperty.call(ROUTE_HEADS, path);
}

export function headRoutes(): string[] {
  return Object.keys(ROUTE_HEADS);
}

export function injectRouteHead(html: string, route: string, url: string): string {
  const head = ROUTE_HEADS[route];
  if (!head) return html;
  const title = escapeHtml(head.title);
  const description = escapeHtml(head.description);
  const tags = [
    `<meta name="description" content="${description}">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta property="og:image" content="https://telarchy.com/logo.png">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<link rel="canonical" href="${escapeHtml(url)}">`,
  ].join('\n    ');
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta\s+(?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`)
    .replace(/(<main class="ssr-fallback"[\s\S]*?<h1[^>]*>)[^<]*(<\/h1>)/, `$1${escapeHtml(head.h1)}$2`);
}
