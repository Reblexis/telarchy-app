import type { LeaderboardEntry } from '../lib/api';

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

export function LeaderboardRail({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <aside className="pubws-rail pubws-rail--left" aria-label="Top traders">
      <h2 className="pubws-h2">Top traders</h2>
      <ol className="pubws-lb">
        {entries.map((e, i) => (
          <li key={e.id} className="pubws-lb-row">
            <span className="pubws-lb-rank">{e.rank ?? i + 1}</span>
            {/* Same fallback as the leaderboard page: nickname, else id. */}
            <span className="pubws-lb-name">{e.nickname || e.id}</span>
            <span className="pubws-lb-score">
              {e.totalEarnings >= 1
                ? `+${Math.round(e.totalEarnings)} cr`
                : `${e.totalTrades} trade${e.totalTrades === 1 ? '' : 's'}`}
            </span>
          </li>
        ))}
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
