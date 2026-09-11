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
  'One number, run in the open on Telarchy: bet on where it lands, or offer a proposal to move it and get paid if the owner approves.';

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

export interface ShareMetaProposal {
  /** The floor it is on ("Telarchy"). */
  floorName: string;
  /** The proposal's number and its title, without the "$80: " convention. */
  number: number;
  title: string;
  /** What approving it pays, null when it asks for nothing. */
  askUsd: number | null;
  /** The impact on the floor's hero metric, and that metric's own words. */
  impact: number | null;
  metricLabel: string;
  unit: string;
  /** The day the owner decides, spelled out ("15 September 2026"). */
  decideBy: string | null;
  /** Already decided: the card and the title say so instead of asking. */
  decided: 'approved' | 'declined' | null;
  /** A proposal with options (docs/guides/proposals.md, "More than two
   *  options"): `impact` is then the leader's lead over the next best, and
   *  the words name options instead of worlds. */
  options?: boolean;
  /** The leading option's label, null while fewer than two are priced and on a tie. */
  leaderLabel?: string | null;
  /** Two or more options share the top price: nobody leads. */
  tied?: boolean;
  /** The chosen option's label once an option proposal is approved. */
  chosenLabel?: string | null;
}

function fmtImpact(v: number, unit: string): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${v > 0 ? '+' : v < 0 ? '-' : '\u00b1'}${unit}${num}`;
}

/**
 * A decision, in the terms someone who has never heard of the floor can read
 * (docs/ui-conventions.md, "A proposal has an address and a card",
 * 2026-09-09). The title says what is being decided and what the market
 * thinks it does; the description says who pays what, and by when.
 *
 * This is the half that makes an expert reachable: a proposal used to unfurl
 * with the site's one generic card, so a decision could not be sent to the
 * person who knows how to price it.
 */
export function proposalMetaText(p: ShareMetaProposal): { title: string; description: string } {
  const ask = p.askUsd === null ? null : `$${p.askUsd.toLocaleString('en-US')}`;
  const verb = ask ? `pay ${ask} for` : 'do';
  const opts = p.options === true;
  const head =
    opts && p.decided === 'approved' && p.chosenLabel
      ? `${p.floorName} chose ${p.chosenLabel} on #${p.number}: ${p.title}`
      : p.decided
        ? `${p.floorName} ${p.decided} #${p.number}: ${p.title}`
        : `Should ${p.floorName} ${verb}: ${p.title}?`;
  const says =
    p.impact !== null && opts && p.tied === true
      ? 'The market has the options tied.'
      : p.impact === null || (opts && !p.leaderLabel)
        ? 'Nobody has priced it yet.'
        : opts
          ? `The market says ${p.leaderLabel} leads by ${fmtImpact(p.impact, p.unit)} ${p.metricLabel}.`
          : `The market says ${fmtImpact(p.impact, p.unit)} ${p.metricLabel} if approved.`;
  const title = `${head} ${says}`.replace(/\s+/g, ' ').trim();
  const parts = [
    ask ? `${ask} to the proposer if ${opts ? 'chosen' : 'approved'}.` : 'No payment asked.',
    p.decideBy && !p.decided ? `Decided by ${p.decideBy}.` : null,
    `Anyone can price it: bet on which ${opts ? 'option' : 'world'} lands higher, or post a proposal of your own.`,
  ].filter(Boolean);
  return { title, description: parts.join(' ') };
}

/** The same injection the workspace card uses, with a proposal's words. */
export function injectProposalMeta(html: string, p: ShareMetaProposal, url: string, cardUrl?: string): string {
  const text = proposalMetaText(p);
  const title = escapeHtml(text.title);
  const description = escapeHtml(text.description);
  const tags = [
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
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
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta\s+(?:name="description"|property="og:[^"]*"|name="twitter:[^"]*")[^>]*>\s*/g, '')
    .replace('</head>', `    ${tags}\n  </head>`);
}
