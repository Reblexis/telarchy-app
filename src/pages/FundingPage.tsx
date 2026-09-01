import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { useAuth } from '../hooks/useAuth';
import { api, type PublicWorkspace } from '../lib/api';

/**
 * telarchy.com/<floor>/funding: where real money enters one floor
 * (docs/liquidity-purchases.md governs; docs/owner-on-the-floor.md places it).
 *
 * The floor is where an owner steers liquidity, market by market. This page is
 * the other half and only the other half: where more of it comes from. It is a
 * page rather than a dialog because it is money with a history, read more
 * often than it is used.
 *
 * What it must never do is imply the payment buys a prize. It buys depth on
 * the buyer's own markets: credits land in the walled liquidity wallet, spend
 * only as pool contributions, and never reach a tradeable balance. The
 * purchaser is also exactly the class strict season eligibility pays nothing,
 * which is what keeps this a service rather than contest entry. That is one
 * line of terms, not three paragraphs: a page that argues with the reader
 * reads like a page with something to hide (owner, 2026-09-01: "too much
 * text.. and noisy.. looks shady").
 *
 * The packages are shortcuts, never tiers. Every amount buys at the same
 * 1,000 credits per dollar, said once above the strip, so there is no volume
 * discount to dress up, nothing to badge as popular, and no reason to read
 * five prices against each other.
 */

function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The button says a price, and a price has no trailing zeros to read past. */
function usdWhole(n: number): string {
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function cr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PACKS = [25, 50, 100, 250] as const;
type Choice = '25' | '50' | '100' | '250' | 'custom';

export function FundingPage() {
  const params = useParams();
  const [search] = useSearchParams();
  const returned = search.get('liquidity');
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const [purchases, setPurchases] = useState<
    Array<{ id: string; usdAmount: number; credits: number; status: string; createdAt: string }>
  >([]);
  const [choice, setChoice] = useState<Choice>('50');
  const [custom, setCustom] = useState('75');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [loadErr, setLoadErr] = useState('');

  const floorHref = params.workspaceId ? `/marketplace/${params.workspaceId}` : `/${params.slug ?? ''}`;

  useEffect(() => {
    if (!idOrSlug) return;
    let cancelled = false;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(w => {
        if (!cancelled) setWs(w);
      })
      .catch(e => {
        if (!cancelled) setLoadErr(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug]);

  useEffect(() => {
    if (!user || !ws) {
      if (!authLoading && !user) setCanManage(false);
      return;
    }
    api
      .getProfile()
      .then(p => setCanManage(((p as { capabilities?: string[] }).capabilities ?? []).includes('manage')))
      .catch(() => setCanManage(false));
  }, [user, ws, authLoading]);

  const load = useCallback(() => {
    if (!ws?.workspaceId || !canManage) return;
    api
      .getParticipant()
      .then(p => setWallet((p as { liquidityBalance?: number }).liquidityBalance ?? 0))
      .catch(() => {});
    api
      .getLiquidityPurchases(ws.workspaceId)
      .then(r => setPurchases(r.purchases))
      .catch(() => {});
  }, [ws?.workspaceId, canManage]);

  useEffect(() => {
    load();
  }, [load]);

  // Stripe's redirect races Stripe's webhook: the payer can be standing here
  // before the money is confirmed. Rather than show them an unchanged wallet
  // with no explanation, the page says the confirmation is still coming and
  // keeps looking until it lands (or gives up after a minute and leaves the
  // purchase row saying "pending", which is the truth).
  const newest = purchases[0] ?? null;
  const awaitingStripe = returned === 'purchased' && (!newest || newest.status !== 'completed');

  useEffect(() => {
    if (!awaitingStripe) return;
    let tries = 0;
    const t = setInterval(() => {
      tries += 1;
      if (tries > 20) {
        clearInterval(t);
        return;
      }
      load();
    }, 3000);
    return () => clearInterval(t);
  }, [awaitingStripe, load]);

  const dollars = choice === 'custom' ? Number(custom.replace(/[^0-9.]/g, '')) : Number(choice);
  const valid = Number.isFinite(dollars) && dollars >= 5 && dollars <= 5000;

  const buy = async () => {
    if (!ws?.workspaceId || !valid) return;
    setBusy(true);
    setErr('');
    try {
      const r = await api.buyLiquidityCredits(ws.workspaceId, dollars);
      // Stripe hosts the card form; nothing changes here until its webhook
      // confirms payment, so this is a handoff, not a purchase.
      window.location.href = r.url;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-doc fundp">
        <Link className="annp-back" to={floorHref}>
          {ws?.name ?? params.slug ?? 'Back to the market'}
        </Link>
        <h1 className="annp-head">Funding</h1>
        <p className="annp-lead">Credits are the depth in your markets.</p>

        {loadErr && <p className="adm-err">{loadErr}</p>}

        {returned === 'purchased' && (
          <p className="fundp-back" role="status">
            <strong>Payment received.</strong>{' '}
            {newest && newest.status === 'completed'
              ? `${cr(newest.credits)} credits are in your wallet, ready to go behind a market.`
              : 'Still confirming with Stripe; the credits appear here as soon as it does.'}
          </p>
        )}
        {returned === 'cancelled' && (
          <p className="fundp-back is-quiet" role="status">
            Nothing was charged. The wallet is as you left it.
          </p>
        )}

        {canManage === false && (
          <p className="mpg-none">
            This page is the owner's. <Link to={floorHref}>The market is open to everyone</Link>.
          </p>
        )}

        {canManage && ws && (
          <>
            <div className="adm-figures">
              <div className="adm-fig">
                <span className="adm-fig-n">{wallet === null ? '—' : cr(wallet)}</span>
                <span className="adm-fig-l">credits in your liquidity wallet</span>
              </div>
              <div className="adm-fig">
                <span className="adm-fig-n">{ws.openMarketCount ?? 0}</span>
                <span className="adm-fig-l">open markets to place them in</span>
              </div>
            </div>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Buy credits</h2>
                <span className="pubws-lb-meta">1,000 credits per $1, any amount</span>
              </div>

              <div className="fundp-packs">
                {PACKS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`fundp-pack${choice === String(p) ? ' is-active' : ''}`}
                    aria-pressed={choice === String(p)}
                    disabled={busy}
                    onClick={() => setChoice(String(p) as Choice)}
                  >
                    <span className="fundp-pack-n">${p}</span>
                    <span className="fundp-pack-l">{cr(p * 1000)}</span>
                  </button>
                ))}
                <button
                  type="button"
                  className={`fundp-pack${choice === 'custom' ? ' is-active' : ''}`}
                  aria-pressed={choice === 'custom'}
                  disabled={busy}
                  onClick={() => setChoice('custom')}
                >
                  <span className="fundp-pack-n">Custom</span>
                  <span className="fundp-pack-l">any amount</span>
                </button>
              </div>

              {choice === 'custom' && (
                <label className="fundp-amt">
                  <span className="ticket-label">Amount, USD</span>
                  <input
                    className="pubws-field-line odlg-mono"
                    type="text"
                    inputMode="decimal"
                    value={custom}
                    disabled={busy}
                    onChange={e => setCustom(e.target.value)}
                    aria-label="Amount in US dollars"
                  />
                </label>
              )}

              <button type="button" className="ticket-go fundp-go" disabled={busy || !valid} onClick={() => void buy()}>
                {busy ? 'Opening checkout…' : valid ? `Pay ${usdWhole(dollars)} by card` : 'Pay by card'}
                <span className="ticket-go-sub">
                  {valid ? `${cr(dollars * 1000)} credits into your wallet` : 'Between $5 and $5,000'}
                </span>
              </button>
              <p className="adm-note fundp-fine">Stripe takes the card. Nothing moves until it confirms.</p>
              <p className="adm-note fundp-fine">
                Credits go into your own market pools, never a balance you can trade or withdraw. What a pool does not
                pay out returns to your wallet, and buying is not season entry.
              </p>
              {err && <p className="ticket-err">{err}</p>}
            </section>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Purchases</h2>
                <span className="pubws-lb-meta">{purchases.length === 0 ? 'none yet' : 'newest first'}</span>
              </div>
              {purchases.length === 0 ? (
                <p className="adm-empty">
                  Nothing bought yet. Your markets run on your signup credits until they need more.
                </p>
              ) : (
                <ul className="adm-list">
                  {purchases.map(p => (
                    <li className="adm-row" key={p.id}>
                      <div className="adm-left">
                        <span className="adm-value">{usd(p.usdAmount)}</span>
                        <span className="adm-sub">
                          {when(p.createdAt)} · {p.status === 'completed' ? 'paid' : p.status}
                        </span>
                      </div>
                      <div className="adm-right">
                        <span className="adm-mono">{cr(p.credits)} cr</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <p className="mpg-foot">
              Place credits from Inject under any market. <Link to={floorHref}>Back to {ws.name}</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
