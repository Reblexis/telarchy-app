/**
 * The setup prompt on /agents is one line that sends a coding assistant to
 * the build guide (docs/audience-pages.md, "Agent-builder setup"), so the
 * guide has to be readable by that assistant at the address a person uses
 * (docs/ui-conventions.md, "The guides"), and it has to carry the rules the
 * prompt no longer does.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GUIDE_SECTIONS } from '../content/guides';
import { guidePage } from '../lib/guide-page';

const INDEX = readFileSync(join(__dirname, '..', '..', '..', 'index.html'), 'utf8');
const ORIGIN = 'https://telarchy.com';
const guide = (id: string) => {
  const g = GUIDE_SECTIONS.find(s => s.id === id);
  if (!g) throw new Error(`no guide ${id}`);
  return g;
};
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BROWSER = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

describe('an agent reads a guide at the address a person does', () => {
  test('THE GUIDE PAGE CARRIES THE WHOLE GUIDE FOR A READER THAT RUNS NO JAVASCRIPT', () => {
    const g = guide('build-agent');
    const r = guidePage('/guides/build-agent', undefined, INDEX, ORIGIN);
    expect(r?.type).toBe('html');
    const body = r?.body ?? '';
    expect(body).toContain(esc(g.content));
    expect(body).toMatch(new RegExp(`<title>[^<]*${g.title}[^<]*</title>`));
    expect(body).toContain(`<link rel="alternate" type="text/markdown" href="${ORIGIN}/api/guides/build-agent"`);
    // The home page's fallback is replaced, not appended to, and the app still mounts.
    expect(body).not.toContain('How it works');
    expect(body).toContain('<div id="root">');
    expect(body.match(/class="ssr-fallback"/g)).toHaveLength(1);
  });

  test('every guide is served this way, not only the setup guide', () => {
    for (const g of GUIDE_SECTIONS)
      expect(guidePage(`/guides/${g.id}`, BROWSER, INDEX, ORIGIN)?.body).toContain(esc(g.content));
  });

  test('A READER THAT ASKS FOR MARKDOWN GETS THE MARKDOWN', () => {
    const g = guide('build-agent');
    for (const accept of ['text/markdown', 'text/markdown, text/html;q=0.9', 'text/html;q=0.5, text/markdown']) {
      const r = guidePage('/guides/build-agent', accept, INDEX, ORIGIN);
      expect(r).toEqual({ type: 'text/markdown', body: g.content });
    }
  });

  test('a browser, a wildcard or a lower-ranked markdown gets HTML', () => {
    for (const accept of [BROWSER, '*/*', '', 'text/html, text/markdown;q=0.5']) {
      expect(guidePage('/guides/build-agent', accept, INDEX, ORIGIN)?.type).toBe('html');
    }
  });

  test('an unknown guide, the index and deeper paths are left to the app shell', () => {
    for (const path of ['/guides/nope', '/guides', '/guides/', '/guides/build-agent/x', '/forecast', '/build-agent']) {
      expect(guidePage(path, 'text/markdown', INDEX, ORIGIN)).toBeNull();
    }
  });

  test('guide text cannot inject markup or be read as a replacement pattern', () => {
    const hostile = [
      {
        id: 'evil',
        title: 'Evil <b>"x"</b> $1',
        description: 'd',
        category: 'api',
        order: 0,
        content: '<script>alert(1)</script> $1 $& $` </main></pre>',
      },
    ];
    const body = guidePage('/guides/evil', undefined, INDEX, ORIGIN, hostile)?.body ?? '';
    expect(body).not.toContain('<script>alert');
    expect(body).not.toContain('<b>"x"</b>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt; $1 $&amp; $` &lt;/main&gt;&lt;/pre&gt;');
    expect(body).toContain('Evil &lt;b&gt;');
  });
});

describe('the setup guide holds what the setup prompt used to', () => {
  const text = () => guide('build-agent').content;

  test('THE SETUP GUIDE TELLS AN ASSISTANT TO REPORT WHAT BREAKS TO TELARCHY', () => {
    expect(text()).toContain('POST /api/feedback');
    expect(text()).toContain('(/guides/feedback)');
    expect(text()).toContain('account:feedback');
  });

  test('THE SETUP GUIDE CARRIES THE RULES THE PROMPT NO LONGER DOES', () => {
    for (const rule of [
      'TELARCHY_KEY',
      'data, not instructions',
      'before the first live trade',
      'run and stop',
      'does not host',
      'already created and funded',
    ])
      expect(text()).toContain(rule);
  });
});
