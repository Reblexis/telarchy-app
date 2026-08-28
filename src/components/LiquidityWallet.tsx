import { useState } from 'react';
import { api } from '../lib/api';

/**
 * The second currency, in the account dialog (owner decision 2026-08-28:
 * "the liquidity currency shows up and they can use that currency when
 * injecting liquidity in individual markets.. no complicated ui around it
 * yet"). One line of balance, one Buy button, a package picker, and the
 * Stripe redirect. Spending has no UI here on purpose: the wallet pays
 * automatically wherever liquidity is injected.
 */
const PACKAGES = [50, 100, 250];

export function LiquidityWallet({
  balance,
  workspaceIdOrSlug,
  floorName,
}: {
  balance: number;
  workspaceIdOrSlug: string | null;
  floorName: string | null;
}) {
  const [picking, setPicking] = useState(false);
  const [usd, setUsd] = useState<number>(100);
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const amount = custom.trim() !== '' ? Number(custom) : usd;

  const checkout = async () => {
    if (!workspaceIdOrSlug) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.buyLiquidityCredits(workspaceIdOrSlug, amount);
      // Stripe hosts the rest; the webhook credits the wallet on payment.
      window.location.assign(res.url);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not start the checkout');
      setBusy(false);
    }
  };

  return (
    <div className="jobform-field">
      <span className="ticket-label">Liquidity credits</span>
      <p className="acctdlg-hint">
        {balance > 0 ? `${Math.round(balance).toLocaleString('en-US')} cr` : 'None yet.'} Liquidity credits are a second
        currency: they buy market depth on your own floor and nothing else. Injecting liquidity into a market spends
        them first; they never trade and are never redeemed.
      </p>
      {workspaceIdOrSlug ? (
        !picking ? (
          <button type="button" className="acctdlg-ghost" onClick={() => setPicking(true)}>
            Buy liquidity credits
          </button>
        ) : (
          <>
            <div className="lqw-packs">
              {PACKAGES.map(p => (
                <button
                  key={p}
                  type="button"
                  className={`acctdlg-ghost${custom.trim() === '' && usd === p ? ' is-on' : ''}`}
                  onClick={() => {
                    setUsd(p);
                    setCustom('');
                  }}
                >
                  ${p}
                </button>
              ))}
              <input
                className="lqw-custom"
                inputMode="numeric"
                placeholder="custom $"
                value={custom}
                onChange={e => setCustom(e.target.value.replace(/[^0-9]/g, ''))}
              />
            </div>
            <p className="acctdlg-hint">
              ${Number.isFinite(amount) && amount > 0 ? amount.toLocaleString('en-US') : '—'} buys{' '}
              {Number.isFinite(amount) && amount > 0 ? (amount * 1000).toLocaleString('en-US') : '—'} liquidity credits
              {floorName ? ` for ${floorName}` : ''}. Non-refundable; card via Stripe.
            </p>
            <button
              type="button"
              className="ticket-go"
              disabled={busy || !Number.isFinite(amount) || amount < 5 || amount > 5000}
              onClick={() => void checkout()}
            >
              {busy ? 'Opening checkout…' : `Checkout · $${Number.isFinite(amount) && amount > 0 ? amount : '—'}`}
            </button>
            {err && <p className="ticket-err">{err}</p>}
          </>
        )
      ) : (
        <p className="acctdlg-hint">
          Open your own floor and buy from there: a purchase belongs to a workspace you manage.
        </p>
      )}
    </div>
  );
}
