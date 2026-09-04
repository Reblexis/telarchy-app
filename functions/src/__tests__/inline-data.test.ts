/**
 * Inline data for the first paint (lib/inline-data.ts).
 *
 * The home page and a floor page get their data inside the served HTML so the
 * client can paint with data on the first render instead of after a waterfall
 * of API calls. The injection is string surgery on index.html, so pin its
 * edges: the element lands before </head>, carries exactly the JSON it was
 * given, and no payload can close the script element early.
 */

import { injectFloorHint, injectHomeData } from '../lib/inline-data';

const HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Telarchy</title>
  </head>
  <body><div id="root"></div></body>
</html>`;

function scriptBody(html: string, id: string): string {
  const re = new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  expect(m).not.toBeNull();
  return m![1];
}

describe('injectHomeData', () => {
  test('inserts the JSON script element immediately before </head>', () => {
    const payload = { at: '2026-09-04T00:00:00.000Z', seasons: [], listings: [] };
    const out = injectHomeData(HTML, payload);
    const tag = `<script id="telarchy-home" type="application/json">${JSON.stringify(payload)}</script>`;
    expect(out).toContain(tag);
    expect(out.indexOf(tag)).toBeLessThan(out.indexOf('</head>'));
    // Immediately before: nothing but the tag between the previous head line and </head>.
    expect(out).toMatch(new RegExp(`${tag.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\s*</head>`));
    // The rest of the document is untouched.
    expect(out.replace(tag, '')).toBe(HTML);
  });

  test('round-trips through JSON.parse unchanged', () => {
    const payload = { name: 'A & B <c>', nested: [{ x: 1, y: null }], text: 'line\nbreak "quoted"' };
    const out = injectHomeData(HTML, payload);
    expect(JSON.parse(scriptBody(out, 'telarchy-home'))).toEqual(payload);
  });

  test('a payload carrying "</script><script>alert(1)</script>" cannot close the element', () => {
    const trap = '</script><script>alert(1)</script>';
    const payload = { listings: [{ name: trap, description: '<!-- sneaky -->' }] };
    const out = injectHomeData(HTML, payload);
    // Exactly one closing script tag in the whole document: ours.
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    // The trap text is still inside OUR element (an opening tag as text in an
    // unclosed JSON element is inert), never after its close.
    expect(out.indexOf('alert(1)')).toBeGreaterThan(out.indexOf('id="telarchy-home"'));
    expect(out.indexOf('alert(1)')).toBeLessThan(out.indexOf('</script>'));
    expect(out).not.toContain('<!--');
    // And the escaped form still decodes to the original string.
    const parsed = JSON.parse(scriptBody(out, 'telarchy-home'));
    expect(parsed.listings[0].name).toBe(trap);
    expect(parsed.listings[0].description).toBe('<!-- sneaky -->');
  });

  test('a document without </head> is returned unchanged', () => {
    expect(injectHomeData('<p>no head</p>', { a: 1 })).toBe('<p>no head</p>');
  });
});

describe('injectFloorHint', () => {
  test('carries id, slug, name, description and nothing else, before </head>', () => {
    const ws = {
      id: 'ws-1',
      slug: 'lookpilot',
      name: 'LookPilot',
      description: 'A real Steam product.',
      visibility: 'public',
      charter: 'secret-ish',
      createdBy: 'owner',
    };
    const out = injectFloorHint(HTML, ws);
    const body = scriptBody(out, 'telarchy-floor');
    expect(JSON.parse(body)).toEqual({
      id: 'ws-1',
      slug: 'lookpilot',
      name: 'LookPilot',
      description: 'A real Steam product.',
    });
    expect(body).not.toContain('charter');
    expect(body).not.toContain('createdBy');
    expect(out.indexOf('id="telarchy-floor"')).toBeLessThan(out.indexOf('</head>'));
  });

  test('keeps null slug and null description as null', () => {
    const out = injectFloorHint(HTML, { id: 'ws-2', slug: null, name: 'Nameless', description: null });
    expect(JSON.parse(scriptBody(out, 'telarchy-floor'))).toEqual({
      id: 'ws-2',
      slug: null,
      name: 'Nameless',
      description: null,
    });
  });

  test('a workspace name cannot close the element', () => {
    const out = injectFloorHint(HTML, {
      id: 'ws-3',
      slug: null,
      name: '</script><script>alert(1)</script>',
      description: null,
    });
    expect(out.match(/<\/script>/g)).toHaveLength(1);
    expect(out.indexOf('alert(1)')).toBeGreaterThan(out.indexOf('id="telarchy-floor"'));
    expect(out.indexOf('alert(1)')).toBeLessThan(out.indexOf('</script>'));
  });

  test('home data and floor hint can both be present', () => {
    const out = injectFloorHint(injectHomeData(HTML, { a: 1 }), {
      id: 'ws-4',
      slug: 's',
      name: 'n',
      description: null,
    });
    expect(out).toContain('id="telarchy-home"');
    expect(out).toContain('id="telarchy-floor"');
    expect(out.match(/<\/head>/g)).toHaveLength(1);
  });
});
