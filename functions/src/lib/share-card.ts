import { Resvg } from '@resvg/resvg-js';
import { join } from 'path';

/**
 * The share card: the workspace's og:image, drawn server-side (owner
 * direction 2026-08-10: "a lot more graphics than text", optimize the
 * unfurl for clicks). Link scrapers cannot run the SPA, so the card is
 * the floor compressed into one picture: the live consensus number huge
 * in the floor's own mono, the market's step-line history in the amber
 * accent, bone background, ink type. Text is three quiet lines; the
 * number and the line do the talking.
 *
 * Rendered as SVG and rasterized with resvg against fonts shipped in
 * functions/assets/fonts, so the card is deterministic: no system fonts,
 * no headless browser, no network.
 */

// The floor's light palette (src/style.css :root), fixed: unfurls have no
// dark mode, and the bone/ink/amber identity IS the brand.
const BONE = '#fbf9f4';
const BONE_2 = '#f3efe6';
const INK = '#17171c';
const QUIET = '#6b6659';
const HAIRLINE = '#e3ddcd';
const AMBER = '#b45309';

const W = 1200;
const H = 630;

function fontFiles(): string[] {
  const dir = join(__dirname, '..', '..', 'assets', 'fonts');
  return [join(dir, 'JetBrainsMono-SemiBold.ttf'), join(dir, 'Fraunces-SemiBold.ttf'), join(dir, 'Inter-Medium.ttf')];
}

export interface ShareCardData {
  /** Workspace display name ("LookPilot"). */
  name: string;
  /** Metric label without the unit tail ("2026 profit"). */
  metricLabel: string;
  /** Currency/unit prefix ("$", "" for unitless). */
  unit: string;
  /** Current consensus, null when the market is unpriced. */
  consensus: number | null;
  /** Human resolution date ("31 December 2026"). */
  resolvesOn: string | null;
  /** Price history, oldest first, values in metric units. */
  history: number[];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtValue(v: number): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** The step path the floor's chart draws, scaled into the card's plot box. */
function stepPath(
  history: number[],
  x0: number,
  y0: number,
  w: number,
  h: number,
): { path: string; endX: number; endY: number } | null {
  if (history.length === 0) return null;
  const pts = history.length === 1 ? [history[0], history[0]] : history;
  let min = Math.min(...pts);
  let max = Math.max(...pts);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.18;
  min -= pad;
  max += pad;
  const xAt = (i: number) => x0 + (i / (pts.length - 1)) * w;
  const yAt = (v: number) => y0 + h - ((v - min) / (max - min)) * h;
  let d = `M${xAt(0).toFixed(1)},${yAt(pts[0]).toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    // Step: hold the previous value to this x, then jump.
    d += ` L${xAt(i).toFixed(1)},${yAt(pts[i - 1]).toFixed(1)} L${xAt(i).toFixed(1)},${yAt(pts[i]).toFixed(1)}`;
  }
  return { path: d, endX: xAt(pts.length - 1), endY: yAt(pts[pts.length - 1]) };
}

export function renderShareCardSvg(data: ShareCardData): string {
  const headline = data.consensus === null ? 'unpriced' : `${data.unit}${fmtValue(data.consensus)}`;
  // The number is the hero: scale it to fit the card's width.
  const headlineSize = headline.length <= 8 ? 168 : headline.length <= 11 ? 132 : 104;

  const plot = stepPath(data.history, 84, 336, W - 168, 180);
  const chart = plot
    ? `<path d="${plot.path}" fill="none" stroke="${AMBER}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"/>
       <circle cx="${plot.endX.toFixed(1)}" cy="${plot.endY.toFixed(1)}" r="13" fill="${AMBER}"/>
       <circle cx="${plot.endX.toFixed(1)}" cy="${plot.endY.toFixed(1)}" r="13" fill="none" stroke="${BONE}" stroke-width="4"/>`
    : `<line x1="84" y1="426" x2="${W - 84}" y2="426" stroke="${HAIRLINE}" stroke-width="3" stroke-dasharray="2 14" stroke-linecap="round"/>`;

  const resolves = data.resolvesOn ? `resolves ${data.resolvesOn}` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BONE}"/>
  <rect x="0" y="${H - 10}" width="${W}" height="10" fill="${AMBER}"/>
  <!-- faint ruled rows, the facts-table texture -->
  <g stroke="${BONE_2}" stroke-width="2">
    <line x1="84" y1="368" x2="${W - 84}" y2="368"/>
    <line x1="84" y1="428" x2="${W - 84}" y2="428"/>
    <line x1="84" y1="488" x2="${W - 84}" y2="488"/>
  </g>
  <text x="84" y="96" font-family="Inter" font-size="30" letter-spacing="6" fill="${QUIET}">${esc(data.name.toUpperCase())}</text>
  <text x="${W - 84}" y="96" text-anchor="end" font-family="Fraunces" font-size="34" fill="${QUIET}">Telarchy</text>
  <text x="84" y="252" font-family="JetBrains Mono" font-size="${headlineSize}" font-weight="600" fill="${INK}">${esc(headline)}</text>
  <text x="84" y="308" font-family="Inter" font-size="33" fill="${INK}">${esc(data.metricLabel)}</text>
  ${resolves ? `<text x="${W - 84}" y="308" text-anchor="end" font-family="Inter" font-size="27" fill="${QUIET}">${esc(resolves)}</text>` : ''}
  ${chart}
  <text x="84" y="566" font-family="Inter" font-size="29" fill="${QUIET}">Think it ends higher? Bet on it.</text>
</svg>`;
}

export function renderShareCardPng(data: ShareCardData): Buffer {
  const svg = renderShareCardSvg(data);
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: {
      fontFiles: fontFiles(),
      loadSystemFonts: false,
      defaultFontFamily: 'Inter',
    },
    background: BONE,
  });
  return Buffer.from(resvg.render().asPng());
}
