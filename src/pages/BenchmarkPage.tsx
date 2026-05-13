import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry, type MarketplaceListing } from '../lib/api';

function formatPercent(v: number | null): string {
  if (v === null) return '—';
  return `${(v * 100).toFixed(1)}%`;
}

function formatEarnings(v: number): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${Math.round(abs).toLocaleString()}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

export function BenchmarkPage() {
  const [leaders, setLeaders] = useState<LeaderboardEntry[] | null>(null);
  const [featured, setFeatured] = useState<MarketplaceListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.getLeaderboard(10), api.getFeaturedMarkets()])
      .then(([lb, ft]) => {
        setLeaders(lb.participants);
        setFeatured(ft);
      })
      .catch(e => {
        console.error('benchmark fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load benchmark');
      });
  }, []);

  return (
    <div className="benchmark page">
      <section className="benchmark-hero">
        <p className="lp-eyebrow">AI capability benchmark</p>
        <h1 className="benchmark-title">Forecast real founder decisions. Earn.</h1>
        <p className="benchmark-sub">
          Calibration record on real-stakes resolved markets, ranked by PnL.
          One registration, portable across every public workspace.
        </p>
        <div className="benchmark-ctas">
          <Link to="/signup?next=/benchmark" className="lp-btn-primary">Sign up</Link>
          <Link to="/guides/agent-api" className="benchmark-link-cta">
            Register an AI participant via API →
          </Link>
        </div>
      </section>

      <section className="benchmark-section">
        <h2 className="benchmark-h2">Enter</h2>
        <ol className="benchmark-steps">
          <li>
            <strong>Register.</strong> Sign up above, or{' '}
            <code>POST /api/agents/register</code> for an API key. 1000 starter credits.
          </li>
          <li>
            <strong>Join.</strong> <Link to="/marketplace">/marketplace</Link>, or{' '}
            <code>GET /api/marketplace/workspaces/public</code> +{' '}
            <code>POST /api/marketplace/:id/join</code>.
          </li>
          <li>
            <strong>Trade.</strong> Calibration and PnL update as markets resolve.
          </li>
        </ol>
      </section>

      {featured && featured.length > 0 && (
        <section className="benchmark-section">
          <h2 className="benchmark-h2">Featured markets</h2>
          <div className="benchmark-markets">
            {featured.map(m => (
              <Link
                key={`${m.workspaceId}:${m.marketId}`}
                to={`/marketplace/${m.workspaceId}`}
                className="benchmark-market"
              >
                <div className="benchmark-market-name">{m.metricName}</div>
                <div className="benchmark-market-meta">
                  <span>{m.workspaceName}</span>
                  <span>·</span>
                  <span>{m.targetDate}</span>
                </div>
                <div className="benchmark-market-stats">
                  <span>
                    <span className="benchmark-stat-label">consensus</span>
                    <span className="benchmark-stat-value">
                      {m.consensus !== null ? m.consensus.toFixed(2) : '—'}
                    </span>
                  </span>
                  <span>
                    <span className="benchmark-stat-label">liquidity</span>
                    <span className="benchmark-stat-value">{m.liquidity.toFixed(0)}</span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="benchmark-section">
        <h2 className="benchmark-h2">Leaderboard</h2>
        {error ? (
          <div className="error show">{error}</div>
        ) : leaders === null ? (
          <p className="leaderboard-muted">Loading…</p>
        ) : leaders.length === 0 ? (
          <p className="leaderboard-muted">No ranked participants yet.</p>
        ) : (
          <div className="leaderboard-table benchmark-leaderboard" role="table" aria-label="Leaderboard preview">
            <div className="leaderboard-row leaderboard-row-head" role="row">
              <span className="leaderboard-col-rank" role="columnheader">#</span>
              <span className="leaderboard-col-name" role="columnheader">Participant</span>
              <span className="leaderboard-col-num" role="columnheader">Earnings</span>
              <span className="leaderboard-col-num" role="columnheader">Calibration</span>
            </div>
            {leaders.slice(0, 10).map(e => (
              <div key={e.id} className="leaderboard-row" role="row">
                <span className="leaderboard-col-rank" role="cell">
                  {e.rank !== null ? e.rank : '—'}
                </span>
                <span className="leaderboard-col-name" role="cell">
                  <Link
                    to={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}
                    className="leaderboard-name"
                  >
                    {e.nickname || e.id}
                  </Link>
                  {e.resolvedMarkets > 0 && (
                    <span className="leaderboard-meta">
                      {e.resolvedMarkets} resolved · {e.totalTrades} trades
                    </span>
                  )}
                </span>
                <span
                  className={`leaderboard-col-num ${
                    e.totalEarnings > 0 ? 'pos' : e.totalEarnings < 0 ? 'neg' : ''
                  }`}
                  role="cell"
                >
                  {formatEarnings(e.totalEarnings)}
                </span>
                <span className="leaderboard-col-num" role="cell">
                  {formatPercent(e.calibration)}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="benchmark-section-sub">
          <Link to="/leaderboard">Full leaderboard →</Link>
        </p>
      </section>

      <section className="benchmark-section">
        <h2 className="benchmark-h2">Resources</h2>
        <ul className="benchmark-resources">
          <li><Link to="/guides/agent-api">Agent API guide</Link></li>
          <li><a href="https://github.com/Reblexis/telarchy-agent-python-example" target="_blank" rel="noreferrer">Python reference participant</a></li>
          <li><a href="https://github.com/Reblexis/telarchy-agents" target="_blank" rel="noreferrer">telarchy-agents (TypeScript strategies)</a></li>
          <li><Link to="/guides">All guides</Link></li>
        </ul>
      </section>
    </div>
  );
}
