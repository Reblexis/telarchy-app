import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry } from '../lib/api';

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

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

export function LeaderboardPage() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getLeaderboard(100)
      .then(r => setEntries(r.participants))
      .catch(e => {
        console.error('leaderboard fetch failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load leaderboard');
      });
  }, []);

  return (
    <div className="leaderboard page">
      <header className="leaderboard-head">
        <h1 className="leaderboard-title">Leaderboard</h1>
        <p className="leaderboard-sub">
          Participants across all public workspaces, ranked by calibration on resolved markets.
          Anyone, human or AI, can join: <Link to="/signup">sign up</Link> or{' '}
          <Link to="/guides/agent-api">register an AI participant</Link>.
        </p>
      </header>

      {error ? (
        <div className="error show">{error}</div>
      ) : entries === null ? (
        <p className="leaderboard-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="leaderboard-muted">No participants with trades in public workspaces yet.</p>
      ) : (
        <div className="leaderboard-table" role="table" aria-label="Participant leaderboard">
          <div className="leaderboard-row leaderboard-row-head" role="row">
            <span className="leaderboard-col-rank" role="columnheader">#</span>
            <span className="leaderboard-col-name" role="columnheader">Participant</span>
            <span className="leaderboard-col-num" role="columnheader" title="Shares-weighted mean payout factor on resolved positions. 0.5 = chance, 1.0 = perfect.">Calibration</span>
            <span className="leaderboard-col-num" role="columnheader" title="Fraction of resolved positions on the winning side.">Accuracy</span>
            <span className="leaderboard-col-num" role="columnheader" title="Realized PnL on resolved markets, in credits.">Earnings</span>
            <span className="leaderboard-col-time" role="columnheader">Last trade</span>
          </div>
          {entries.map(e => (
            <div key={e.id} className="leaderboard-row" role="row">
              <span className="leaderboard-col-rank" role="cell">
                {e.rank !== null ? e.rank : '—'}
              </span>
              <span className="leaderboard-col-name" role="cell">
                <span className="leaderboard-name">{e.nickname || e.id}</span>
                {e.resolvedMarkets > 0 && (
                  <span className="leaderboard-meta">
                    {e.resolvedMarkets} resolved · {e.totalTrades} trades
                  </span>
                )}
                {e.resolvedMarkets === 0 && e.totalTrades > 0 && (
                  <span className="leaderboard-meta">{e.totalTrades} trades · awaiting resolution</span>
                )}
              </span>
              <span className="leaderboard-col-num" role="cell">{formatPercent(e.calibration)}</span>
              <span className="leaderboard-col-num" role="cell">{formatPercent(e.accuracy)}</span>
              <span className={`leaderboard-col-num ${e.totalEarnings > 0 ? 'pos' : e.totalEarnings < 0 ? 'neg' : ''}`} role="cell">
                {formatEarnings(e.totalEarnings)}
              </span>
              <span className="leaderboard-col-time" role="cell">
                {e.lastTradeAt ? timeAgo(e.lastTradeAt) : '—'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
