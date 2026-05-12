import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type PublicParticipantProfile, type PublicProfilePosition, type PublicProfileTrade } from '../lib/api';
import { formatTargetDateDisplay } from '../lib/date-utils';

function timeAgo(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const diff = Math.max(0, Date.now() - d.getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatPercent(v: number | null): string {
  if (v === null) return '-';
  return `${(v * 100).toFixed(1)}%`;
}

function formatEarnings(v: number): string {
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${Math.round(abs).toLocaleString()}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

function formatShares(v: number): string {
  if (v >= 1000) return Math.round(v).toLocaleString();
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function formatConsensusOrProb(p: PublicProfilePosition): string | null {
  if (p.status === 'resolved' && p.actualValue !== null) return `resolved at ${p.actualValue}`;
  if (p.consensus !== null) return `consensus ${p.consensus}`;
  if (p.probabilityHigher !== null) return `p(higher) ${(p.probabilityHigher * 100).toFixed(0)}%`;
  return null;
}

function formatJoinedDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

const isOpaqueId = (id: string) =>
  id.length > 18 && !/\s/.test(id) && /^[a-zA-Z0-9_-]+$/.test(id);

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="section agent-stat-card">
      <div className="stat-card-label" title={hint}>{label}</div>
      <div className="stat-card-value">{value}</div>
    </div>
  );
}

function marketDeepLink(workspaceId: string, marketId: string): string {
  const qs = new URLSearchParams({ workspace: workspaceId, marketId }).toString();
  return `/markets?${qs}`;
}

function PositionRow({ p }: { p: PublicProfilePosition }) {
  const subtitle = formatConsensusOrProb(p);
  const date = p.targetDate ? formatTargetDateDisplay(p.targetDate) : null;
  const showWorkspace = true;
  return (
    <li>
      <Link to={marketDeepLink(p.workspaceId, p.marketId)} className="activity-row-link">
        <div className="activity-row">
          <div className="activity-text">
            <div>
              <strong>{p.metricName ?? p.marketId}</strong>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.4rem' }}>
                · {p.direction}
              </span>
            </div>
            <div className="activity-tags">
              <span className="activity-tag">{formatShares(p.shares)} shares</span>
              <span className="activity-tag">cost {formatEarnings(p.totalCost)}</span>
              {subtitle && <span className="activity-tag">{subtitle}</span>}
              {p.status === 'resolved' && <span className="activity-tag">resolved</span>}
              {showWorkspace && <span className="activity-tag">{p.workspaceName}</span>}
            </div>
          </div>
          <span className="activity-time">{date ?? ''}</span>
        </div>
      </Link>
    </li>
  );
}

function TradeRow({ t }: { t: PublicProfileTrade }) {
  const time = timeAgo(t.createdAt);
  return (
    <li>
      <Link to={marketDeepLink(t.workspaceId, t.marketId)} className="activity-row-link">
        <div className="activity-row">
          <div className="activity-text">
            <div>
              <strong>{t.kind === 'buy' ? 'Bought' : 'Sold'} {formatShares(t.shares)} {t.direction}</strong>
              <span style={{ color: 'var(--text-tertiary)', marginLeft: '0.4rem' }}>
                on {t.metricName ?? t.marketId}
              </span>
            </div>
            <div className="activity-tags">
              <span className="activity-tag">{t.kind === 'sell' ? 'proceeds' : 'cost'} {formatEarnings(Math.abs(t.cost))}</span>
              <span className="activity-tag">{t.workspaceName}</span>
            </div>
          </div>
          <span className="activity-time">{time}</span>
        </div>
      </Link>
    </li>
  );
}

export function ParticipantProfilePage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicParticipantProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    api.getPublicProfile(id)
      .then(p => { setProfile(p); setLoading(false); })
      .catch(e => { setError(e instanceof Error ? e.message : String(e)); setLoading(false); });
  }, [id]);

  if (loading) return <div className="container"><p style={{ color: 'var(--text-secondary)' }}>Loading…</p></div>;
  if (error) return <div className="container"><div className="message error show">{error}</div></div>;
  if (!profile) return null;

  const display = profile.nickname ?? profile.id;
  const showId = profile.nickname !== null;
  const intent = profile.intent === 'agent' ? 'AI participant'
    : profile.intent === 'creator' ? 'Workspace creator'
    : null;

  return (
    <div className="container">
      <div className="section-header">
        <h2>{display}</h2>
        <p className="section-subtitle">
          {intent && <><strong>{intent}</strong> · </>}
          Joined {formatJoinedDate(profile.joinedAt)}
          {profile.stats.rank !== null && <> · Rank #{profile.stats.rank} on the public leaderboard</>}
        </p>
        {showId && (
          <p style={{ fontSize: '0.78rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
            <span className={isOpaqueId(profile.id) ? 'agent-id agent-id-opaque' : 'agent-id'}>{profile.id}</span>
          </p>
        )}
      </div>

      <div className="agent-stats">
        <Stat
          label="Calibration"
          value={formatPercent(profile.stats.calibration)}
          hint="Shares-weighted mean payout factor on resolved positions in public workspaces. 0.5 = chance, 1.0 = perfect."
        />
        <Stat
          label="Accuracy"
          value={formatPercent(profile.stats.accuracy)}
          hint="Fraction of resolved positions on the winning side."
        />
        <Stat
          label="Earnings"
          value={formatEarnings(profile.stats.totalEarnings)}
          hint="Realized PnL on resolved markets in public workspaces, in credits."
        />
        <Stat
          label="Resolved markets"
          value={profile.stats.resolvedMarkets.toLocaleString()}
          hint="Number of markets in public workspaces where this participant held a position at resolution."
        />
        <Stat
          label="Total trades"
          value={profile.stats.totalTrades.toLocaleString()}
          hint="Trade count across all public workspaces."
        />
        <Stat
          label="Last trade"
          value={timeAgo(profile.stats.lastTradeAt)}
          hint="Most recent trade in any public workspace."
        />
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Open positions</h2>
          <p className="section-subtitle">
            Live positions visible to you. Activity in workspaces you can't read is hidden.
          </p>
        </div>
        {profile.openPositions.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No open positions you can see.</p>
        ) : (
          <ul className="activity-list">
            {profile.openPositions.map(p => (
              <PositionRow key={`${p.workspaceId}:${p.marketId}:${p.direction}`} p={p} />
            ))}
          </ul>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Recent trades</h2>
          <p className="section-subtitle">
            Newest first. Trades on markets you can't read are hidden.
          </p>
        </div>
        {profile.recentTrades.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No recent trades you can see.</p>
        ) : (
          <ul className="activity-list">
            {profile.recentTrades.map(t => <TradeRow key={t.id} t={t} />)}
          </ul>
        )}
      </div>

      <div className="section">
        <div className="section-header">
          <h2>Active in public workspaces</h2>
          <p className="section-subtitle">
            Public-visibility workspaces this participant has traded in.
          </p>
        </div>
        {profile.activeWorkspaces.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No public-workspace activity yet.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column' }}>
            {profile.activeWorkspaces.map(ws => (
              <li key={ws.id} style={{ borderTop: '1px solid var(--border-color)', padding: '0.6rem 0' }}>
                <Link to={`/marketplace?workspace=${encodeURIComponent(ws.id)}`}>{ws.name}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
