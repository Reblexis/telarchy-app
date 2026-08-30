#!/usr/bin/env node
/**
 * Generate the audience pages from docs/audience-pages.md.
 *
 * The seven standalone pages (/forecast, /for-agents, /owners and the four
 * /compare/* pages) are copy, so they live as markdown under docs/ (docs
 * govern) and the code gets generated modules, the same way
 * scripts/build-guides.mjs feeds /api/guides:
 *
 *   src/content/audiencePages.generated.ts         what AudiencePage renders
 *   functions/src/lib/audience-meta.generated.ts   title, description and FAQ
 *                                                  the server puts in the HTML
 *                                                  head for scrapers and search
 *
 * Both generated files are committed; `npm run build` regenerates them and
 * functions/src/__tests__/audience-pages-content.test.ts fails when they are
 * out of sync with the markdown. The structure this parser reads is stated at
 * the top of docs/audience-pages.md.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(REPO, 'docs', 'audience-pages.md');
const OUT_PAGES = join(REPO, 'src', 'content', 'audiencePages.generated.ts');
const OUT_META = join(REPO, 'functions', 'src', 'lib', 'audience-meta.generated.ts');

/** Strip the markdown emphasis the copy uses; the renderer sets its own type. */
function plain(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function parseTable(lines) {
  const rows = lines.map(l =>
    l
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map(c => plain(c)),
  );
  const head = rows[0];
  const body = rows.slice(1).filter(r => !r.every(c => /^:?-+:?$/.test(c)));
  return { kind: 'table', head, rows: body };
}

function parseCta(line) {
  return line
    .replace(/^CTA:\s*/, '')
    .split(' · ')
    .map(part => {
      const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(part.trim());
      if (!m) throw new Error(`CTA part without (href): ${part}`);
      let href = m[2].trim();
      if (href.startsWith('telarchy.com')) href = href.slice('telarchy.com'.length) || '/';
      return { label: m[1].trim(), href };
    });
}

export function parsePage(header, body) {
  const hm = /^## (\/\S+) \((.*)\)$/.exec(header);
  if (!hm) throw new Error(`bad page header: ${header}`);
  const route = hm[1];
  const audience = hm[2];
  const page = {
    slug: route.slice(1).replace(/\//g, '-'),
    route,
    audience,
    title: '',
    description: '',
    h1: '',
    blocks: [],
    cta: [],
  };
  const lines = body.split('\n');
  let i = 0;
  let faq = null;
  const flushFaq = () => {
    if (faq) {
      page.blocks.push({ kind: 'faq', items: faq });
      faq = null;
    }
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('Title: ')) {
      page.title = plain(line.slice(7));
      i++;
      continue;
    }
    if (line.startsWith('Description: ')) {
      page.description = plain(line.slice(13));
      i++;
      continue;
    }
    if (line.startsWith('# ')) {
      page.h1 = plain(line.slice(2));
      i++;
      continue;
    }
    if (line.startsWith('### ')) {
      flushFaq();
      page.blocks.push({ kind: 'h2', text: plain(line.slice(4)) });
      i++;
      continue;
    }
    if (line.startsWith('CTA:')) {
      flushFaq();
      page.cta = parseCta(line);
      i++;
      continue;
    }
    if (line.startsWith('Q: ')) {
      const q = plain(line.slice(3));
      const next = lines[i + 1] ?? '';
      if (!next.startsWith('A: ')) throw new Error(`${route}: Q without A: ${q}`);
      faq = faq ?? [];
      faq.push({ q, a: plain(next.slice(3)) });
      i += 2;
      continue;
    }
    flushFaq();
    if (line.startsWith('|')) {
      const tbl = [];
      while (i < lines.length && lines[i].startsWith('|')) tbl.push(lines[i++]);
      page.blocks.push(parseTable(tbl));
      continue;
    }
    if (/^\d+\. /.test(line) || line.startsWith('- ')) {
      const ordered = /^\d+\. /.test(line);
      const items = [];
      while (i < lines.length && (ordered ? /^\d+\. /.test(lines[i]) : lines[i].startsWith('- '))) {
        items.push(plain(lines[i].replace(/^(\d+\.|-) /, '')));
        i++;
      }
      page.blocks.push({ kind: ordered ? 'ol' : 'ul', items });
      continue;
    }
    // Paragraph: consecutive non-empty lines; a bold opening becomes the lead.
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||Q: |CTA:|\d+\. |- )/.test(lines[i])) para.push(lines[i++]);
    const text = para.join(' ');
    const lm = /^\*\*([^*]+)\*\*\s*(.*)$/s.exec(text);
    if (lm) page.blocks.push({ kind: 'p', lead: plain(lm[1]), text: plain(lm[2]) });
    else page.blocks.push({ kind: 'p', text: plain(text) });
  }
  flushFaq();
  for (const k of ['title', 'description', 'h1']) {
    if (!page[k]) throw new Error(`${route}: missing ${k}`);
  }
  if (!page.blocks.some(b => b.kind === 'faq')) throw new Error(`${route}: no FAQ`);
  if (/[–—]/.test(body)) throw new Error(`${route}: contains an em or en dash`);
  return page;
}

export function parseHeadSection(text) {
  const m = /## App route heads\n([\s\S]*?)\n## /.exec(text);
  if (!m) throw new Error('docs/audience-pages.md: missing "App route heads" section');
  const heads = {};
  for (const line of m[1].split('\n')) {
    if (!line.startsWith('- /')) continue;
    // route | title (may itself contain " | Telarchy") is disambiguated by
    // splitting from both ends: route first, heading last, description
    // second-to-last; whatever remains in the middle is the title.
    const parts = line
      .slice(2)
      .split(' | ')
      .map(x => x.trim());
    if (parts.length < 4) throw new Error(`bad route-head line: ${line}`);
    const route = parts[0];
    const h1 = parts[parts.length - 1];
    const description = parts[parts.length - 2];
    const title = parts.slice(1, parts.length - 2).join(' | ');
    if (/[–—]/.test(line)) throw new Error(`${route}: contains an em or en dash`);
    heads[route] = { title, description, h1 };
  }
  if (Object.keys(heads).length === 0) throw new Error('App route heads: no routes');
  return heads;
}

export function parseDoc(text) {
  const sections = text.split(/\n(?=## )/);
  const pages = [];
  for (const s of sections) {
    const nl = s.indexOf('\n');
    const header = s.slice(0, nl).trim();
    if (!header.startsWith('## /')) continue;
    pages.push(parsePage(header, s.slice(nl + 1)));
  }
  if (pages.length === 0) throw new Error('docs/audience-pages.md: no pages');
  return pages;
}

const HEADER = `// GENERATED by scripts/build-audience-pages.mjs from docs/audience-pages.md.\n// Do not edit: change the markdown and run \`npm run build:audience\`.\n`;

export function renderPagesModule(pages) {
  return `${HEADER}
export type AudienceBlock =
  | { kind: 'p'; lead?: string; text: string }
  | { kind: 'h2'; text: string }
  | { kind: 'ol'; items: string[] }
  | { kind: 'ul'; items: string[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'faq'; items: { q: string; a: string }[] };

export interface AudiencePage {
  slug: string;
  route: string;
  audience: string;
  title: string;
  description: string;
  h1: string;
  blocks: AudienceBlock[];
  cta: { label: string; href: string }[];
}

export const AUDIENCE_PAGES: AudiencePage[] = ${JSON.stringify(pages, null, 2)};
`;
}

export function renderMetaModule(pages, heads) {
  const meta = Object.fromEntries(
    pages.map(p => [
      p.route,
      {
        title: p.title,
        description: p.description,
        faq: p.blocks.filter(b => b.kind === 'faq').flatMap(b => b.items),
      },
    ]),
  );
  return `${HEADER}
export interface AudienceMeta {
  title: string;
  description: string;
  faq: { q: string; a: string }[];
}

export const AUDIENCE_META: Record<string, AudienceMeta> = ${JSON.stringify(meta, null, 2)};

export interface RouteHead {
  title: string;
  description: string;
  h1: string;
}

/** The app's own public routes (docs/audience-pages.md, "App route heads"). */
export const ROUTE_HEADS: Record<string, RouteHead> = ${JSON.stringify(heads, null, 2)};
`;
}

export function build() {
  const text = readFileSync(SRC, 'utf8');
  const pages = parseDoc(text);
  const heads = parseHeadSection(text);
  return { pages: renderPagesModule(pages), meta: renderMetaModule(pages, heads) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const out = build();
  writeFileSync(OUT_PAGES, out.pages);
  writeFileSync(OUT_META, out.meta);
  console.log(`audience pages: wrote ${OUT_PAGES} and ${OUT_META}`);
}
