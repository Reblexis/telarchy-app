/**
 * Share-link meta injection (lib/share-meta.ts).
 *
 * Link scrapers (Discord, Slack, Steam forum, Twitter) do not run JavaScript,
 * so the workspace name and description must be in the HTML the server sends
 * for /marketplace/:idOrSlug, or every share link unfurls as the generic site
 * card. The injection is string surgery on index.html, so pin its edges: the
 * title swap, the removal of the static tags it supersedes, and the escaping
 * that stops a workspace name from becoming markup.
 */

import { injectWorkspaceMeta } from '../lib/share-meta';

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

describe('injectWorkspaceMeta', () => {
  test('injects workspace title and description, drops the static competing tags', () => {
    const out = injectWorkspaceMeta(
      HTML,
      {
        name: 'LookPilot',
        description: 'A real Steam product. The winner ships.',
        charter: null,
      },
      'https://telarchy.com/marketplace/lookpilot',
    );

    expect(out).toContain('<title>LookPilot · Telarchy</title>');
    // The workspace's own line, then what Telarchy is: a stranger seeing
    // this link in a Discord has no idea what the site does, and a lone
    // product one-liner reads like a link to the product itself.
    expect(out).toContain('A real Steam product. The winner ships. One number, run in the open on Telarchy');
    expect(out).toMatch(/offer a proposal to move it and get paid/);
    expect(out).toContain('og:url" content="https://telarchy.com/marketplace/lookpilot"');
    // The static generic tags must be gone, or scrapers see two competing sets.
    expect(out).not.toContain('Generic site description.');
    expect(out).not.toContain('content="Telarchy"');
    // Untouched structure survives.
    expect(out).toContain('<link rel="icon" href="/favicon.ico">');
    expect(out).toContain('<div id="root"></div>');
  });

  test('falls back to the charter first line, capped, when description is null', () => {
    const out = injectWorkspaceMeta(
      HTML,
      {
        name: 'WS',
        description: null,
        charter: `${'x'.repeat(300)}\n\nSecond paragraph never appears.`,
      },
      'https://telarchy.com/marketplace/ws',
    );

    // Capped hard enough that the mechanism after it survives what a
    // scraper shows: truncating THAT would cut the half the reader needs.
    expect(out).toContain(`${'x'.repeat(87)}... One number, run in the open on Telarchy`);
    expect(out).not.toContain('Second paragraph');
  });

  test('a workspace with no text of its own still says what Telarchy is', () => {
    const out = injectWorkspaceMeta(
      HTML,
      { name: 'WS', description: null, charter: null },
      'https://telarchy.com/marketplace/ws',
    );
    expect(out).toContain('One number, run in the open on Telarchy');
  });

  test('does not double the full stop when the lead already ends in one', () => {
    const out = injectWorkspaceMeta(
      HTML,
      { name: 'WS', description: 'Ends in a stop.', charter: null },
      'https://telarchy.com/marketplace/ws',
    );
    expect(out).toContain('Ends in a stop. One number');
    expect(out).not.toContain('stop.. One number');
  });

  test('escapes markup in workspace-controlled text', () => {
    const out = injectWorkspaceMeta(
      HTML,
      {
        name: '<script>alert(1)</script>',
        description: 'He said "hi" & left',
        charter: null,
      },
      'https://telarchy.com/marketplace/x',
    );

    expect(out).not.toContain('<script>alert(1)</script>');
    expect(out).toContain('&lt;script&gt;');
    expect(out).toContain('&quot;hi&quot; &amp; left');
  });
});

describe('the og:image card', () => {
  test('a card URL upgrades the unfurl to a large image', () => {
    const out = injectWorkspaceMeta(
      HTML,
      {
        name: 'LookPilot',
        description: 'd',
        charter: null,
      },
      'https://telarchy.com/lookpilot',
      'https://telarchy.com/api/marketplace/lookpilot/card.png',
    );
    expect(out).toContain('og:image" content="https://telarchy.com/api/marketplace/lookpilot/card.png"');
    expect(out).toContain('twitter:card" content="summary_large_image"');
    expect(out).toContain('og:image:width" content="1200"');
  });

  test('without a card URL the unfurl stays a summary', () => {
    const out = injectWorkspaceMeta(HTML, { name: 'WS', description: 'd', charter: null }, 'https://telarchy.com/x');
    expect(out).not.toContain('og:image');
    expect(out).toContain('twitter:card" content="summary"');
  });
});
