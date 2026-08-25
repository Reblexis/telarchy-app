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
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ESCAPES[c]);
}

export interface ShareMetaWorkspace {
  name: string;
  description: string | null;
  charter: string | null;
}

/**
 * What Telarchy is, in the terms of the thing being shared. The card image
 * already carries the number, the metric and the date, so the text carries
 * the mechanism instead of repeating them.
 */
const MECHANISM =
  'One number, run in the open on Telarchy: bet on where it lands, or offer a contract to move it and get paid if the owner approves.';

/** First sentence-ish fragment of a charter, for workspaces with no description. */
function workspaceLead(ws: ShareMetaWorkspace): string {
  if (ws.description) return ws.description.trim();
  const charterLead = (ws.charter ?? '').split('\n')[0].trim();
  return charterLead;
}

/**
 * The unfurl's one paragraph: what this workspace is, then what Telarchy is
 * (owner report 2026-08-15: a shared link "just explains the workspace").
 * Someone seeing a Telarchy link for the first time in a Discord or a forum
 * has no idea what the site does, and a lone product one-liner reads like a
 * link to that product rather than to a market on it.
 *
 * The lead is capped so the pair survives the ~200 characters a scraper
 * shows: a truncated mechanism would cut exactly the half that is new to
 * the reader.
 */
function fallbackDescription(ws: ShareMetaWorkspace): string {
  const lead = workspaceLead(ws);
  if (!lead) return MECHANISM;
  const capped = lead.length > 90 ? `${lead.slice(0, 87).trimEnd()}...` : lead;
  const joined = /[.!?]$/.test(capped) ? capped : `${capped}.`;
  return `${joined} ${MECHANISM}`;
}

export function injectWorkspaceMeta(html: string, ws: ShareMetaWorkspace, url: string, cardUrl?: string): string {
  const title = escapeHtml(`${ws.name} · Telarchy`);
  const description = escapeHtml(fallbackDescription(ws));
  const tags = [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    // The card (owner direction 2026-08-10): a server-drawn picture of the
    // floor, so the unfurl leads with the live number and the chart, not
    // text. summary_large_image makes Twitter/Discord show it full-width.
    ...(cardUrl
      ? [
          `<meta property="og:image" content="${escapeHtml(cardUrl)}">`,
          `<meta property="og:image:width" content="1200">`,
          `<meta property="og:image:height" content="630">`,
        ]
      : []),
    `<meta name="twitter:card" content="${cardUrl ? 'summary_large_image' : 'summary'}">`,
    ...(cardUrl ? [`<meta name="twitter:image" content="${escapeHtml(cardUrl)}">`] : []),
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
