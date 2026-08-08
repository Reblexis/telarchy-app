/**
 * Share-link meta injection for public workspace pages.
 *
 * The SPA ships one static index.html, so every route unfurls with the same
 * generic site card when pasted into Discord, Slack, a Steam forum, or a
 * tweet. For a workspace share link that card is the first impression most
 * people ever get, and "Telarchy" tells them nothing about the workspace they
 * were invited to. The server therefore rewrites the head of index.html for
 * GET /marketplace/:idOrSlug with the workspace's own name and description
 * before serving. Link scrapers do not run JavaScript; this is the only way
 * they see workspace-specific text.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ESCAPES[c]);
}

export interface ShareMetaWorkspace {
  name: string;
  description: string | null;
  charter: string | null;
}

/** First sentence-ish fragment of a charter, for workspaces with no description. */
function fallbackDescription(ws: ShareMetaWorkspace): string {
  if (ws.description) return ws.description;
  const charterLead = (ws.charter ?? '').split('\n')[0].trim();
  if (charterLead) return charterLead.length > 200 ? `${charterLead.slice(0, 197)}...` : charterLead;
  return 'Propose actions, trade on their impact, and see what the owner ships.';
}

export function injectWorkspaceMeta(html: string, ws: ShareMetaWorkspace, url: string): string {
  const title = escapeHtml(`${ws.name} · Telarchy`);
  const description = escapeHtml(fallbackDescription(ws));
  const tags = [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    `<meta name="twitter:card" content="summary">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="description" content="${description}">`,
  ].join('\n    ');
  // Replace the static title; drop any static description/og tags so scrapers
  // do not see two competing sets; inject ours at the end of head.
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta\s+(?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
}
