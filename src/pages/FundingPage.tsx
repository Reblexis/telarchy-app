/**
 * The owner's money page for one workspace (docs/liquidity.md): buy a funding
 * package, see the liquidity budget and the monthly pools, and steer the
 * budget with weights and a spread. Requires manage_workspace on the
 * workspace; anyone else sees the floor's name and nothing to press.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { useAuth } from '../hooks/useAuth';
import {
  api,
  type PublicWorkspace,
  setActiveWorkspace,
  type WorkspaceFunding,
  type WorkspaceLiquidity,
} from '../lib/api';
import { floorPath, monthLabel, usd } from '../lib/money';

export function FundingPage() {
  const params = useParams();
  const location = useLocation();
  const idOrSlug = params.slug ?? params.workspaceId;
  const { user, loading: authLoading } = useAuth();
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [canFund, setCanFund] = useState<boolean | null>(null);
  const [funding, setFunding] = useState<WorkspaceFunding | null>(null);
  const [liquidity, setLiquidity] = useState<WorkspaceLiquidity | null>(null);
  const [amount, setAmount] = useState('100');
  const [target, setTarget] = useState('');
  const [weights, setWeights] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<'buy' | 'spread' | 'weights' | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const query = new URLSearchParams(location.search);
  const justPaid = query.get('funding') === 'paid';
  const cancelled = query.get('funding') === 'cancelled';

  const reload = useCallback(async (workspaceId: string) => {
    const [f, l] = await Promise.all([api.getWorkspaceFunding(workspaceId), api.getWorkspaceLiquidity(workspaceId)]);
    setFunding(f);
    setLiquidity(l);
    setWeights(Object.fromEntries(l.metrics.map(m => [m.id, String(m.weight)])));
  }, []);

  useEffect(() => {
    if (!idOrSlug || authLoading) return;
    let dead = false;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(async w => {
        if (dead) return;
        setWs(w);
        setActiveWorkspace(w.workspaceId);
        if (!user) {
          setCanFund(false);
          return;
        }
        const p = (await api.getProfile()) as { capabilities?: string[] };
        const ok = (p.capabilities ?? []).includes('manage_workspace');
        if (dead) return;
        setCanFund(ok);
        if (ok) await reload(w.workspaceId);
      })
      .catch(e => {
        console.error('funding page load failed:', e);
        if (!dead) setErr((e as Error).message || 'Could not load this workspace');
      });
    return () => {
      dead = true;
    };
  }, [idOrSlug, user, authLoading, reload]);

  const buy = async () => {
    if (!ws) return;
    const dollars = Number(amount);
    if (!Number.isFinite(dollars) || dollars < 1) {
      setErr('Enter at least $1.');
      return;
    }
    setBusy('buy');
    setErr('');
    try {
      const { url } = await api.createFundingCheckout(ws.workspaceId, Math.round(dollars * 100), location.pathname);
      // An external payment page: the provider's URL, never one of ours.
      window.location.assign(url);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };

  const spread = async () => {
    if (!ws) return;
    const t = Number(target);
    if (!Number.isFinite(t) || t <= 0) {
      setErr('Enter a target pool in credits.');
      return;
    }
    setBusy('spread');
    setErr('');
    try {
      const r = await api.spreadLiquidity(ws.workspaceId, t);
      setNote(
        r.funded.length
          ? `Funded ${r.funded.length} market${r.funded.length === 1 ? '' : 's'}; ${Math.round(r.budgetRemaining).toLocaleString('en-US')} credits left in the budget.`
          : 'Every market already holds that much, or the budget is empty.',
      );
      await reload(ws.workspaceId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const saveWeights = async () => {
    if (!ws) return;
    const clean: Record<string, number> = {};
    for (const [id, v] of Object.entries(weights)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        setErr('Weights are numbers from 0 up.');
        return;
      }
      clean[id] = n;
    }
    setBusy('weights');
    setErr('');
    try {
      await api.setLiquidityWeights(ws.workspaceId, clean);
      setNote('Weights saved. New markets and top-ups follow them.');
      await reload(ws.workspaceId);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const dollars = Number(amount);
  const preview =
    funding && Number.isFinite(dollars) && dollars >= 1
      ? {
          credits: Math.round(dollars * funding.rates.creditsPerUsd),
          pool: Math.floor((Math.round(dollars * 100) * funding.rates.poolFractionBp) / 10_000),
        }
      : null;

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-doc fundp">
        <Link className="annp-back" to={ws ? floorPath(ws) : `/${params.slug ?? ''}`}>
          {ws?.name ?? params.slug ?? 'Back to the market'}
        </Link>
        <h1 className="annp-head">Liquidity and prize pool</h1>
        {canFund === false && (
          <p className="annp-lead">
            {user ? 'This page is the owner’s. ' : 'Sign in as the owner to fund this workspace. '}
            Liquidity is the owner's steering wheel: a pool is how they say which question is worth answering well.
          </p>
        )}
        {err && <p className="adm-err">{err}</p>}
        {justPaid && (
          <p className="acctdlg-ok">
            Payment received. The credits land in the budget the moment the provider confirms it, usually within a
            minute.
          </p>
        )}
        {cancelled && <p className="acctdlg-hint">Checkout cancelled. Nothing was charged.</p>}
        {note && <p className="acctdlg-ok">{note}</p>}

        {canFund && funding && liquidity && (
          <>
            <div className="adm-figures">
              <div className="adm-fig">
                <span className="adm-fig-n">{Math.round(funding.budget.credits).toLocaleString('en-US')}</span>
                <span className="adm-fig-l">credits in the liquidity budget</span>
              </div>
              <div className="adm-fig">
                <span className="adm-fig-n">
                  {usd(funding.pools.find(p => p.status === 'running')?.totalCents ?? 0)}
                </span>
                <span className="adm-fig-l">prize pool this month</span>
              </div>
              <div className="adm-fig">
                <span className="adm-fig-n">
                  {usd(funding.pools.find(p => p.status === 'scheduled')?.totalCents ?? 0)}
                </span>
                <span className="adm-fig-l">next month, so far</span>
              </div>
            </div>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Buy a funding package</h2>
                <span className="pubws-lb-meta">
                  {funding.rates.creditsPerUsd.toLocaleString('en-US')} credits per dollar,{' '}
                  {funding.rates.poolFractionBp / 100}% to the pool
                </span>
              </div>
              <p className="adm-note">
                One payment does two things: credits of liquidity into this workspace's budget, which can only ever be
                placed into its markets, and a cash prize pool for next month, paid by Telarchy to the traders who take
                the most out of those markets. Non-refundable; nothing comes back as money.
              </p>
              {funding.enabled ? (
                <div className="jobform-line">
                  <label className="jobform-field">
                    <span className="ticket-label">Amount, USD</span>
                    <input
                      className="pubws-field-line"
                      type="number"
                      min={1}
                      step={1}
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                    />
                  </label>
                  {preview && (
                    <span className="acctdlg-hint">
                      {preview.credits.toLocaleString('en-US')} credits of liquidity and {usd(preview.pool)} into next
                      month's pool.
                    </span>
                  )}
                  <button type="button" className="ticket-go" disabled={busy === 'buy'} onClick={buy}>
                    {busy === 'buy' ? 'Opening checkout…' : 'Pay by card'}
                  </button>
                </div>
              ) : (
                <p className="acctdlg-hint">
                  Purchases open when Season 0 ends. The budget and pools below already work with granted credits.
                </p>
              )}
            </section>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Where the budget goes</h2>
                <span className="pubws-lb-meta">{liquidity.markets.length} open markets</span>
              </div>
              <p className="adm-note">
                Auto-fund{' '}
                {liquidity.autoFund.enabled
                  ? `puts ${liquidity.autoFund.creditsPerMarket} credits`
                  : 'is off, so nothing goes'}{' '}
                behind each new market, times the metric's weight; the budget pays first, your own balance second. A
                weight of 0 leaves that metric to you by hand.
              </p>
              <ul className="adm-list">
                {liquidity.metrics.map(m => (
                  <li className="adm-row" key={m.id}>
                    <div className="adm-left">
                      <span className="adm-value">{m.name}</span>
                      <span className="adm-sub">
                        {liquidity.markets
                          .filter(x => x.metricId === m.id)
                          .map(x => `${x.targetDate}: ${Math.round(x.pool).toLocaleString('en-US')}`)
                          .join(' · ') || 'no open market'}
                      </span>
                    </div>
                    <div className="adm-right">
                      <input
                        className="pubws-field-line fundp-weight"
                        type="number"
                        min={0}
                        step={0.1}
                        aria-label={`Weight for ${m.name}`}
                        value={weights[m.id] ?? '1'}
                        onChange={e => setWeights(w => ({ ...w, [m.id]: e.target.value }))}
                      />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="jobform-line">
                <button type="button" className="ticket-go" disabled={busy === 'weights'} onClick={saveWeights}>
                  {busy === 'weights' ? 'Saving…' : 'Save weights'}
                </button>
              </div>
              <div className="jobform-line">
                <label className="jobform-field">
                  <span className="ticket-label">Spread: fund every open market up to, in credits</span>
                  <input
                    className="pubws-field-line"
                    type="number"
                    min={1}
                    value={target}
                    placeholder={String(Math.max(liquidity.autoFund.creditsPerMarket, 1000))}
                    onChange={e => setTarget(e.target.value)}
                  />
                </label>
                <button type="button" className="ticket-go" disabled={busy === 'spread'} onClick={spread}>
                  {busy === 'spread' ? 'Funding…' : 'Spread the budget'}
                </button>
              </div>
            </section>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Prize pools</h2>
                <span className="pubws-lb-meta">one per month</span>
              </div>
              {funding.pools.length === 0 ? (
                <p className="adm-empty">No pool yet. The first package funds next month's.</p>
              ) : (
                <ul className="adm-list">
                  {funding.pools.map(p => (
                    <li className="adm-row" key={p.month}>
                      <div className="adm-left">
                        <span className="adm-value">
                          <Link className="pubws-inline-link" to={`${ws ? floorPath(ws) : ''}/pools/${p.month}`}>
                            {monthLabel(p.month)}
                          </Link>
                        </span>
                        <span className="adm-sub">
                          {p.status}
                          {p.rolloverCents > 0 ? `, ${usd(p.rolloverCents)} rolled in` : ''}
                          {p.status === 'settled' ? `, ${usd(p.distributedCents)} paid` : ''}
                        </span>
                      </div>
                      <div className="adm-right">
                        <span className="adm-mono">{usd(p.totalCents)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">Purchases</h2>
              </div>
              {funding.purchases.length === 0 ? (
                <p className="adm-empty">None yet.</p>
              ) : (
                <ul className="adm-list">
                  {funding.purchases.map(p => (
                    <li className="adm-row" key={p.id}>
                      <div className="adm-left">
                        <span className="adm-value">{usd(p.amountCents)}</span>
                        <span className="adm-sub">
                          {p.createdAt.slice(0, 10)},{' '}
                          {p.status === 'paid' ? `paid, ${monthLabel(p.poolMonth)} pool` : 'awaiting the provider'}
                        </span>
                      </div>
                      <div className="adm-right">
                        <span className="adm-mono">{Math.round(p.credits).toLocaleString('en-US')} cr</span>
                        <span className="adm-mono">{usd(p.poolCents)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
