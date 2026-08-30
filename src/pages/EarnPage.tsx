import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api, type EarnRule } from '../lib/api';
import { TopBar } from './TradePage';

/**
 * telarchy.com/earn: how credits are earned, and what each way is worth
 * today (owner ask 2026-08-30, after the earn table shipped).
 *
 * Written as an exchange rather than a rewards screen. Every row says what
 * the platform is paying FOR, because the honest reason is the whole
 * argument: a signal is priced at what it brings, which is why an email
 * address earns a little and an established forecasting record earns a
 * lot. A page that just listed numbers would read as a video game and
 * invite exactly the farming the prices exist to prevent.
 *
 * Reads the live table, so it can never drift from what the code grants.
 */
export function EarnPage() {
  const { user, loading: authLoading } = useAuth();
  const [rules, setRules] = useState<EarnRule[] | null>(null);

  useEffect(() => {
    api
      .getEarnTable()
      .then(r => setRules(r.rules))
      .catch(e => {
        console.error('earn table fetch failed:', e);
        setRules([]);
      });
  }, []);

  // The signup rows lead: they are what a visitor reading this page is
  // deciding about. Everything else follows in descending price, which is
  // also descending scarcity.
  const ordered = (rules ?? []).slice().sort((a, b) => {
    const rank = (k: string) => (k.startsWith('signup') ? 0 : 1);
    return rank(a.key) - rank(b.key) || b.credits - a.credits;
  });

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">How credits are earned</h1>
        <p className="lbp-lead">
          Credits are what you trade with. They are not bought and never cashed out; you get them by bringing something
          the floor needs, and each way is priced at roughly what that thing is worth here.
        </p>

        {rules === null ? null : ordered.length === 0 ? (
          <p className="lbp-empty">The earn table is unavailable right now.</p>
        ) : (
          <table className="lbt earn-tbl">
            <thead>
              <tr>
                <th className="lbt-h is-left">What you do</th>
                <th className="lbt-h">Credits</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map(r => (
                <tr key={r.key}>
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
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="lbp-note earn-foot">
          These prices change. When something turns out to be worth more or less to the floor than we thought, we
          re-price it here rather than quietly changing what you get, and this page always shows what is in force right
          now.
        </p>

        <p className="lbp-foot">
          <Link to="/leaderboard">See what people are earning with them</Link>
        </p>
      </main>
    </div>
  );
}

export default EarnPage;
