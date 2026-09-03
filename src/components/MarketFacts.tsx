/**
 * What a market says about itself (docs/ui-conventions.md): distinct
 * traders, credits in the pool, credits traded. Three icons and bare
 * numbers, the shape Manifold's market header uses, at the right end of the
 * Discussion / Positions / Trades row. Each carries its meaning as a hover.
 *
 * For an owner, the pool is also where its control lives
 * (docs/owner-on-the-floor.md): the Inject button opens the inject-liquidity
 * dialog beside the number it changes, never on a settings screen.
 */
export function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString('en-US');
}

export const People = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 4a3.5 3.5 0 0 1 0 7" />
    <path d="M21.5 20a6.5 6.5 0 0 0-5-6.3" />
  </svg>
);
export const Drop = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
  </svg>
);
export const Bars = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <path d="M4 20V10" />
    <path d="M10 20V4" />
    <path d="M16 20v-7" />
    <path d="M22 20H2" />
  </svg>
);

/** A proposal being priced: the marketplace card's fourth fact. */
export const Page = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M8 13h8" />
    <path d="M8 17h5" />
  </svg>
);

export function MarketFacts({
  traders,
  pool,
  volume,
  canManage = false,
  canTrade = false,
  onInject,
  fundingHref,
}: {
  traders: number;
  pool: number;
  volume: number;
  canManage?: boolean;
  /** Anyone who can trade this market can deepen it, which is what the API
   *  has always said (`requireCapability('trade')`) and what the button did
   *  not (owner ask 2026-09-02). Depth is not an owner's private duty: a
   *  trader who wants a market worth trading can pay for one. */
  canTrade?: boolean;
  /** Opens the inject-liquidity dialog; the parent owns it. */
  onInject?: () => void;
  /** The floor's funding page, where the credits to inject are bought. */
  fundingHref?: string;
}) {
  return (
    <span className="pubws-facts" aria-label="Market facts">
      <span title={`${traders} distinct participant${traders === 1 ? '' : 's'} have traded this market`}>
        <People /> {short(traders)}
      </span>
      <span
        title={`${short(pool)} credits in the pool: the liquidity put up by the owner and others, which winnings come out of`}
      >
        <Drop /> {short(pool)}
      </span>
      <span title={`${short(volume)} credits traded on this market over its life`}>
        <Bars /> {short(volume)}
      </span>
      {(canManage || canTrade) && onInject && (
        <button type="button" className="pubws-facts-act" onClick={onInject}>
          Inject
        </button>
      )}
      {canManage && fundingHref && (
        // Where more credits come from, one step from where they are spent
        // (docs/liquidity-purchases.md). Only for someone who can spend them.
        <a className="pubws-facts-act" href={fundingHref}>
          Buy
        </a>
      )}
    </span>
  );
}
