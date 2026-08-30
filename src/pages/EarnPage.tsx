import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ManifoldButton } from '../components/ManifoldButton';
import { useAuth } from '../hooks/useAuth';
import { api, type DailyStreak, type EarnRule, type MyEarnRule } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { TopBar } from './TradePage';

/**
 * telarchy.com/earn: every way to get credits, what it pays, and the
 * button that does it.
 *
 * Trimmed to the table on 2026-08-30 (owner: "i feel like this is too
 * verbose ... less words.. everywher on the website"). The page used to
 * open with a paragraph on how grants are priced and close with another
 * on why prices change; both were the operator's reasoning, which is a
 * thing to defend in the docs and not a thing a reader needs in order to
 * act. What survives is a row per earn and its verb.
 *
 * Reads the live table, so the page can never drift from what the code
 * grants, including after the operator re-prices a row on /admin.
 */

/** One link earn, claimable with either provider (owner decision
 *  2026-08-30): the second account somebody attaches is the same person
 *  proving they hold another free account, so it earns nothing. */
const LINK_KEY = 'link_oauth';

/** The recurring earns lead: trading is how credits are actually made,
 *  and a table that opened with signup bonuses said the opposite. */
const ORDER = ['trade_profit', 'daily_trade'];

const n = (v: number) => Math.round(v).toLocaleString('en-US');

export function EarnPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rules, setRules] = useState<Array<EarnRule | MyEarnRule> | null>(null);
  const [mine, setMine] = useState<{ earned: number; available: number; streak: DailyStreak | null } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    if (!user) {
      const r = await api.getEarnTable().catch(e => {
        console.error('earn table fetch failed:', e);
        return { rules: [] };
      });
      setRules(r.rules);
      setMine(null);
      return;
    }
    // Reconcile first: coming back from a provider's consent screen, the
    // link exists but has not been paid for yet, and the reader expects
    // the credits to be there when the page appears.
    const synced = await api.syncEarnLinks().catch(e => {
      console.error('earn link sync failed:', e);
      return { granted: 0, paid: [], takenElsewhere: [] as string[] };
    });
    if (synced.granted > 0) setNote(`+${n(synced.granted)} credits`);
    else if (synced.takenElsewhere.length > 0) {
      setNote('That account already earned this on another Telarchy account.');
    }
    const r = await api.getMyEarn().catch(e => {
      console.error('my earn fetch failed:', e);
      return null;
    });
    if (r) {
      setRules(r.rules);
      setMine({ earned: r.earned, available: r.available, streak: r.streak });
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    void load();
  }, [authLoading, load]);

  const connect = async (provider: 'google' | 'github') => {
    setBusy(provider);
    setNote('');
    // A full-page redirect to the provider and back to this page, where
    // the sync above pays for it.
    const { error } = await authClient.linkSocial({ provider, callbackURL: '/earn' }).catch((e: unknown) => ({
      error: { message: e instanceof Error ? e.message : 'Could not start the connection' },
    }));
    if (error) {
      setNote(error.message || `Could not connect ${provider}`);
      setBusy(null);
    }
  };

  const ordered = (rules ?? []).slice().sort((a, b) => {
    const rank = (k: string) => (ORDER.indexOf(k) >= 0 ? ORDER.indexOf(k) : ORDER.length);
    return rank(a.key) - rank(b.key) || b.credits - a.credits;
  });
  const streak = mine?.streak ?? null;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">Get credits</h1>

        {mine && (
          <div className="earn-tally">
            <span>
              <span className="earn-tally-n">{n(mine.earned)}</span> <span className="earn-tally-l">earned</span>
            </span>
            {streak && (
              <span className="earn-tally-l">
                <span className="earn-tally-n earn-tally-n--avail">{streak.days}</span> day streak
              </span>
            )}
            <span className="earn-tally-l">
              <span className="earn-tally-n earn-tally-n--avail">{n(mine.available)}</span> left to claim
            </span>
          </div>
        )}
        {note && <p className="earn-note">{note}</p>}

        {rules === null ? null : ordered.length === 0 ? (
          <p className="lbp-empty">The earn table is unavailable right now.</p>
        ) : (
          <table className="lbt earn-tbl">
            <thead>
              <tr>
                <th className="lbt-h is-left">What you do</th>
                <th className="lbt-h">Credits</th>
                {mine && <th className="lbt-h earn-act">&nbsp;</th>}
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => {
                const claimed = 'claimed' in r ? r.claimed : false;
                return (
                  <tr key={r.key} className={claimed ? 'is-earned' : undefined}>
                    <td className="lbt-cell is-left">
                      <span className="earn-label">{r.label}</span>
                      {r.note && <span className="earn-why">{r.note}</span>}
                    </td>
                    <td className="lbt-num">
                      {r.kind === 'open' ? (
                        <span className="earn-open">no limit</span>
                      ) : r.kind === 'daily' ? (
                        // The row's price is day one; the streak multiplies
                        // it up to four times, so the range is the honest
                        // number to show.
                        `${n(r.credits)}-${n(r.credits * 4)}`
                      ) : r.credits > 0 ? (
                        <>
                          {r.kind === 'cap' && <span className="earn-upto">up to </span>}
                          {n(r.credits)}
                        </>
                      ) : (
                        <span className="is-zero">none</span>
                      )}
                    </td>
                    {mine && (
                      <td className="earn-act">
                        {r.kind === 'open' || (r.kind === 'daily' && !streak?.earnedToday) ? (
                          <Link className="earn-btn" to="/">
                            Trade
                          </Link>
                        ) : r.kind === 'daily' ? (
                          <span className="earn-done">✓ +{n(streak?.todayCredits ?? 0)} today</span>
                        ) : claimed ? (
                          <span className="earn-done">✓ earned</span>
                        ) : r.key === LINK_KEY ? (
                          // Either provider claims the same row, so both
                          // are offered and whichever they finish pays.
                          <span className="earn-pair">
                            <button
                              type="button"
                              className="earn-btn"
                              disabled={busy !== null}
                              onClick={() => void connect('google')}
                            >
                              {busy === 'google' ? 'Opening…' : 'Google'}
                            </button>
                            <button
                              type="button"
                              className="earn-btn earn-btn--alt"
                              disabled={busy !== null}
                              onClick={() => void connect('github')}
                            >
                              {busy === 'github' ? 'Opening…' : 'GitHub'}
                            </button>
                          </span>
                        ) : r.key === 'manifold_link' ? (
                          // The real import flow, in place: it is the same
                          // component the floor carries, so the bio-code
                          // dance has one implementation.
                          <ManifoldButton signedIn={!!user} onRequireSignup={() => navigate('/signup')} />
                        ) : (
                          <span className="earn-muted">not yet</span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <p className="lbp-foot">
          {user ? <Link to="/leaderboard">Leaderboard</Link> : <Link to="/signup">Create an account</Link>}
        </p>
      </main>
    </div>
  );
}

export default EarnPage;
