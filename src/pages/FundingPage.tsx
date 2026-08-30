import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
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
 * which is what keeps this a service rather than contest entry. The page says
 * so in the owner's terms rather than making them read the doc.
 */

function usd(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function cr(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

function when(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const PRESETS = [25, 50, 100, 250];

export function FundingPage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const [wallet, setWallet] = useState<number | null>(null);
  const [purchases, setPurchases] = useState<
    Array<{ id: string; usdAmount: number; credits: number; status: string; createdAt: string }>
  >([]);
  const [amount, setAmount] = useState('50');
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

  const dollars = Number(amount.replace(/[^0-9.]/g, ''));
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
        <p className="annp-lead">
          Credits are what your markets run on. Deeper pools mean a price that is harder to move and worth more to be
          right about, which is what pulls forecasters to your number rather than someone else's.
        </p>

        {loadErr && <p className="adm-err">{loadErr}</p>}

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
                <span className="pubws-lb-meta">1,000 credits per dollar</span>
              </div>
              <p className="adm-note">
                They can only ever go into your own market pools: never a tradeable balance, never a withdrawal, and
                what a market does not pay out at settlement comes back to the wallet. Buying does not enter you into
                the prize season, and as the operator here you are not eligible for it either way.
              </p>

              <div className="fundp-presets">
                {PRESETS.map(p => (
                  <button
                    key={p}
                    type="button"
                    className={`pubws-seg-btn fundp-preset${dollars === p ? ' is-active' : ''}`}
                    aria-pressed={dollars === p}
                    disabled={busy}
                    onClick={() => setAmount(String(p))}
                  >
                    ${p}
                  </button>
                ))}
              </div>

              <div className="fundp-buy">
                <label className="jobform-field fundp-amt">
                  <span className="ticket-label">Amount, USD</span>
                  <input
                    className="pubws-field-line odlg-mono"
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={e => setAmount(e.target.value)}
                    aria-label="Amount in US dollars"
                  />
                </label>
                <button
                  type="button"
                  className="ticket-go fundp-go"
                  disabled={busy || !valid}
                  onClick={() => void buy()}
                >
                  {busy
                    ? 'Opening checkout…'
                    : valid
                      ? `Pay ${usd(dollars)} for ${cr(dollars * 1000)} credits`
                      : 'Pay by card'}
                </button>
              </div>
              <p className="adm-note fundp-fine">
                Between $5 and $5,000. Card details are handled by Stripe, never by us, and nothing changes on any
                market until Stripe confirms the payment.
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
              Placing the credits happens beside the price each pool moves: the Inject button under any market.{' '}
              <Link to={floorHref}>Back to {ws.name}</Link>.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
