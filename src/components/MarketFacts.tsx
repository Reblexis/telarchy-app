import { useState } from 'react';
import { api } from '../lib/api';

/**
 * What a market says about itself (docs/ui-conventions.md): distinct
 * traders, credits in the pool, credits traded. Three icons and bare
 * numbers, the shape Manifold's market header uses, at the right end of the
 * Discussion / Positions / Trades row. Each carries its meaning as a hover.
 *
 * For an owner, the pool is also a control (docs/owner-on-the-floor.md):
 * deepening a market happens beside the number it changes, on the page the
 * visitor is looking at, and never on a settings screen.
 */
function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  return Math.round(n).toLocaleString('en-US');
}

const People = () => (
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
const Drop = () => (
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
const Bars = () => (
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

export function MarketFacts({
  traders,
  pool,
  volume,
  canManage = false,
  marketId,
  workspaceId,
  onDeepened,
}: {
  traders: number;
  pool: number;
  volume: number;
  /** The `trade` capability is what the server checks; `manage` is who this is for. */
  canManage?: boolean;
  marketId?: string;
  workspaceId?: string;
  onDeepened?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState('1000');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const deepen = async () => {
    const n = Number(amount.replace(/,/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      setErr('A number of credits.');
      return;
    }
    if (!marketId) return;
    setBusy(true);
    setErr('');
    try {
      await api.injectLiquidity(marketId, n, workspaceId);
      setOpen(false);
      onDeepened?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

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
      {canManage && marketId && !open && (
        <button type="button" className="pubws-facts-act" onClick={() => setOpen(true)}>
          Deepen
        </button>
      )}
      {canManage && marketId && open && (
        <span className="pubws-facts-deepen">
          <input
            className="pubws-facts-input"
            type="text"
            inputMode="decimal"
            aria-label="Credits to add to the pool"
            value={amount}
            disabled={busy}
            onChange={e => setAmount(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') void deepen();
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button type="button" className="pubws-facts-act" disabled={busy} onClick={() => void deepen()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
          <button type="button" className="pubws-facts-act" disabled={busy} onClick={() => setOpen(false)}>
            cancel
          </button>
          {err && <span className="pubws-facts-err">{err}</span>}
        </span>
      )}
    </span>
  );
}
