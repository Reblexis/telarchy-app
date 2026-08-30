import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ManifoldButton } from '../components/ManifoldButton';
import { useAuth } from '../hooks/useAuth';
import { api, type EarnRule, type MyEarnRule } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { TopBar } from './TradePage';

/**
 * telarchy.com/earn: how credits are earned, what each way is worth, and
 * for a signed-in reader, which ones they have already taken and which
 * they can do right now (owner ask 2026-08-30; design
 * https://claude.ai/code/artifact/3d605cc3-5d42-450e-bb42-3f07b21bcb38).
 *
 * Written as an exchange, not a rewards screen. Every row says what the
 * platform is paying FOR, because the honest reason is the argument: an
 * email address earns a little and an established forecasting record
 * earns a lot, and a reader who can see why does not read the page as a
 * game to farm.
 *
 * Reads the live table, so the page can never drift from what the code
 * grants, including after the operator re-prices a row on /admin.
 */

/** One link earn, claimable with either provider (owner decision
 *  2026-08-30): the second account somebody attaches is the same person
 *  proving they hold another free account, so it earns nothing. */
const LINK_KEY = 'link_oauth';

export function EarnPage() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [rules, setRules] = useState<Array<EarnRule | MyEarnRule> | null>(null);
  const [mine, setMine] = useState<{ earned: number; available: number } | null>(null);
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
    if (synced.granted > 0) setNote(`+${synced.granted.toLocaleString('en-US')} credits`);
    else if (synced.takenElsewhere.length > 0) {
      setNote('That account has already earned this on another Telarchy account. One account, one earn.');
    }
    const r = await api.getMyEarn().catch(e => {
      console.error('my earn fetch failed:', e);
      return null;
    });
    if (r) {
      setRules(r.rules);
      setMine({ earned: r.earned, available: r.available });
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
    const rank = (k: string) => (k.startsWith('signup') ? 0 : k.startsWith('link') ? 1 : 2);
    return rank(a.key) - rank(b.key) || b.credits - a.credits;
  });

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">How credits are earned</h1>
        <p className="lbp-lead">
          Credits are what you trade with: never bought, never cashed out. You earn them by bringing something the floor
          needs, and each way is priced at <strong>roughly what that thing is worth here</strong>.
        </p>

        {mine && (
          <div className="earn-tally">
            <span>
              <span className="earn-tally-n">{Math.round(mine.earned).toLocaleString('en-US')}</span>{' '}
              <span className="earn-tally-l">earned so far</span>
            </span>
            <span className="earn-tally-l">
              <span className="earn-tally-n earn-tally-n--avail">
                {Math.round(mine.available).toLocaleString('en-US')}
              </span>{' '}
              still available to you
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
                      {r.credits > 0 ? (
                        <>
                          {r.kind === 'cap' && <span className="earn-upto">up to </span>}
                          {Math.round(r.credits).toLocaleString('en-US')}
                        </>
                      ) : (
                        <span className="is-zero">none</span>
                      )}
                    </td>
                    {mine && (
                      <td className="earn-act">
                        {claimed ? (
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

        <p className="lbp-note earn-foot">
          Each of these can be earned once, and every connected account pays once across the whole platform. Prices
          change when something turns out to be worth more or less to the floor than we thought; this page always shows
          what is in force right now.
        </p>

        <p className="lbp-foot">
          {user ? (
            <Link to="/leaderboard">See what people are earning with them</Link>
          ) : (
            <Link to="/signup">Create an account and start earning</Link>
          )}
        </p>
      </main>
    </div>
  );
}

export default EarnPage;
