import type { LeaderboardEntry } from '../lib/api';
import { ManifoldLogo } from './ManifoldLogo';

/**
 * The trading floor's side rails (owner decision 2026-08-09): top traders
 * on the left, the log of past actions on the right. Both are social
 * proof, so they render for both tiers, and both hide themselves entirely
 * when empty (an empty leaderboard or silent log is anti-proof). On
 * narrow viewports they stack below the poster instead.
 */

export interface ActivityItem {
  at: number;
  kind: 'proposal' | 'approved' | 'declined' | 'trade';
  text: string;
}

function timeAgo(t: number): string {
  const mins = Math.max(0, Math.round((Date.now() - t) / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

export function LeaderboardRail({ entries: all }: { entries: LeaderboardEntry[] }) {
  // A row for someone who has never traded is a name and a zero: noise.
  const entries = all.filter(e => e.totalTrades > 0).slice(0, 5);
  if (entries.length === 0) return null;
  return (
    <aside className="pubws-rail pubws-rail--left" aria-label="Top traders">
      <h2 className="pubws-h2">Top traders</h2>
      <ol className="pubws-lb">
        {entries.map((e, i) => {
          const name = e.nickname || 'anonymous';
          const initial = name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
          return (
            <li key={e.id} className="pubws-lb-row">
              <span className="pubws-lb-rank">{e.rank ?? i + 1}</span>
              {/* Avatar + name link to the public profile (owner ask
                  2026-08-11: show the face; a Manifold logo marks imported
                  traders). */}
              <a className="pubws-lb-who pubws-name-link" href={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}>
                <span className="pubws-lb-avatar">
                  {e.image ? <img src={e.image} alt="" /> : <span>{initial}</span>}
                </span>
                <span className="pubws-lb-name">{name}</span>
                {e.manifoldUsername && (
                  <span className="pubws-lb-manifold" title={`Imported from Manifold: @${e.manifoldUsername}`}>
                    <ManifoldLogo size={13} strokeWidth={1.6} />
                  </span>
                )}
              </a>
              {/* Profit, realized + open positions (owner 2026-08-11):
                  the board ranks on it, so the row shows it, signed. */}
              <span className={`pubws-lb-score${e.totalEarnings > 0 ? ' is-up' : e.totalEarnings < 0 ? ' is-down' : ''}`}>
                {e.totalEarnings > 0 ? '+' : ''}{Math.round(e.totalEarnings).toLocaleString('en-US')} cr
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

export function ActivityRail({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return null;
  return (
    <aside className="pubws-rail pubws-rail--right" aria-label="Activity">
      <h2 className="pubws-h2">Activity</h2>
      <ul className="pubws-log">
        {items.map((it, i) => (
          <li key={`${it.at}-${i}`} className={`pubws-log-item pubws-log-item--${it.kind}`}>
            <span className="pubws-log-time">{timeAgo(it.at)}</span>
            <span className="pubws-log-text">{it.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
