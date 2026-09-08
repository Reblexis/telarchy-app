import { shortAgoOf } from '../lib/floor-horizons';

/**
 * The glyph set every icon row on the floor shares (docs/ui-conventions.md,
 * "The floor head, the owner row and the run-a-floor row"): a person for
 * traders, a droplet for credits in a pool (never a caret, which reads as a
 * menu), a book for books, bars for credits traded, a page for a proposal.
 * Facts are an icon row, never a sentence (owner rule 2026-09-03).
 */
export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString('en-US');
}

const stroke = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const People = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--people">
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4a3.5 3.5 0 0 1 0 7" />
    <path d="M21.5 20a6.5 6.5 0 0 0-5-6.3" />
  </svg>
);
export const Drop = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--pool">
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
);
export const Bars = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--bars">
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </svg>
);
export const Book = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--book">
    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" />
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
  </svg>
);
export const Clock = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--clock">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const Dollar = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--dollar">
    <path d="M12 2v20" />
    <path d="M17 6.5c-1-1.5-2.8-2-5-2-3 0-5 1.5-5 3.5 0 4.5 10 2.5 10 7.5 0 2.2-2.2 3.5-5 3.5-2.4 0-4.4-.8-5.5-2.5" />
  </svg>
);

/** A proposal being priced: the marketplace card's fourth fact. */
export const Page = () => (
  <svg {...stroke} className="pubws-glyph pubws-glyph--page">
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </svg>
);

/**
 * What one book says about itself, at the right end of the verbs panel's
 * stake row (docs/ui-conventions.md, "The verbs and the inline ticket", row
 * 1): its traders, its pool and its last trade, each behind its glyph with
 * the meaning as a hover title.
 */
export function MarketFacts({
  traders,
  pool,
  lastTradeAt,
  now,
}: {
  traders: number;
  pool: number;
  /** When the book last traded; absent, the row says so. */
  lastTradeAt: string | null;
  now?: Date;
}) {
  const ago = shortAgoOf(lastTradeAt, now);
  return (
    <span className="pubws-facts" aria-label="This book">
      <span title={`${traders} distinct participant${traders === 1 ? '' : 's'} have traded this book`}>
        <People /> {short(traders)}
      </span>
      <span
        title={`${short(pool)} credits in this book's pool: the liquidity put up by the owner and others, which winnings come out of`}
      >
        <Drop /> {short(pool)}
      </span>
      <span
        title={
          lastTradeAt
            ? `Last trade on this book at ${new Date(lastTradeAt).toUTCString()}`
            : 'No trade on this book yet'
        }
      >
        <Clock /> {ago ? `last trade ${ago}` : 'no trades yet'}
      </span>
    </span>
  );
}
