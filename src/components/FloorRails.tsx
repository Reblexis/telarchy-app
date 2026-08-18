import type { LeaderboardEntry, PublicContractor } from '../lib/api';
import { useEffect, useState } from 'react';
import { api, type PrizeSeason } from '../lib/api';
import { useSeasonClock } from '../lib/useSeasonClock';
import { pickCurrentSeason } from '../lib/season-clock';
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

/** The contractor score, in the hero metric's own unit. Same shape as the
 *  job impact chip on the poster, so the rail and the job agree. */
function formatImpact(value: number, unit: string): string {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 0 : abs >= 1 ? 1 : 2;
  const num = abs.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return `${value > 0 ? '+' : value < 0 ? '-' : ''}${unit}${num}`;
}

/** The row's second line: how many jobs are behind the score and what the
 *  owner has actually paid for them. Dollars stopped being the ranking key
 *  on 2026-08-14, so they live here instead of in the score slot. */
function contractorSubline(c: PublicContractor): string {
  const parts = [`${c.jobs} ${c.jobs === 1 ? 'contract' : 'contracts'}`];
  if (c.pendingJobs > 0) parts.push(`${c.pendingJobs} live`);
  if (c.earnedUsd > 0) parts.push(`$${Math.round(c.earnedUsd).toLocaleString('en-US')} earned`);
  return parts.join(' · ');
}

export function LeaderboardRail({ entries: all, contractors, unit = '' }: {
  entries: LeaderboardEntry[];
  contractors?: PublicContractor[];
  /** The hero metric's currency prefix ('$' or ''), so a contractor's priced
   *  impact reads in the same unit as the market above it. */
  unit?: string;
}) {
  // A row for someone who has never traded is a name and a zero: noise.
  // Ten, not five (owner direction 2026-08-17): five made the board look
  // like a podium rather than a field worth joining.
  const entries = all.filter(e => e.totalTrades > 0).slice(0, 10);
  const hasTraders = entries.length > 0;
  // The contractors block shows whenever the workspace exposes it (Open
  // floor), even with nobody paid yet, so the two-sided economy is visible.
  const showContractors = contractors !== undefined;
  if (!hasTraders && !showContractors) return null;
  return (
    <aside className="pubws-rail pubws-rail--left" aria-label="Leaders">
      {hasTraders && (
        <section className="pubws-lb-block">
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
                  {/* Round BEFORE signing: a loss of a hundredth of a
                      credit printed "-0 cr", which reads as a bug rather
                      than as a rounding. Colour follows the printed
                      number, not the raw one. */}
                  {(() => {
                    const cr = Math.round(e.totalEarnings);
                    return (
                      <span className={`pubws-lb-score${cr > 0 ? ' is-up' : cr < 0 ? ' is-down' : ''}`}>
                        {cr > 0 ? '+' : ''}{cr === 0 ? 0 : cr.toLocaleString('en-US')} cr
                      </span>
                    );
                  })()}
                </li>
              );
            })}
          </ol>
        </section>
      )}
      {showContractors && (
        <section className="pubws-lb-block">
          <h2 className="pubws-h2">Top contractors</h2>
          {contractors!.length > 0 ? (
            <ol className="pubws-lb">
              {contractors!.map((c, i) => {
                const name = c.name || 'anonymous';
                const initial = name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
                // The score is what the market currently says this poster's
                // jobs are worth. Unpriced jobs say so rather than printing a
                // confident zero; a workspace with no hero market to price
                // against falls back to dollars.
                const scored = c.impact !== null && c.pricedJobs > 0;
                return (
                  <li key={c.id} className="pubws-lb-row">
                    <span className="pubws-lb-rank">{i + 1}</span>
                    <a className="pubws-lb-who pubws-name-link" href={`/participants/${encodeURIComponent(c.id)}`}>
                      <span className="pubws-lb-avatar"><span>{initial}</span></span>
                      <span className="pubws-lb-stack">
                        <span className="pubws-lb-name">{name}</span>
                        <span className="pubws-lb-sub">{contractorSubline(c)}</span>
                      </span>
                    </a>
                    {scored ? (
                      <span
                        className={`pubws-lb-score${c.impact! > 0 ? ' is-up' : c.impact! < 0 ? ' is-down' : ''}`}
                        /* No arrow at exactly zero: the market has priced
                           these jobs and called them a wash, which an up
                           arrow would misreport as a gain. */
                        title="What the market says this contractor's contracts are worth: approved minus declined, summed over the live ones."
                      >
                        {c.impact! > 0 ? '▲ ' : c.impact! < 0 ? '▼ ' : ''}{formatImpact(c.impact!, unit)}
                      </span>
                    ) : c.impact === null ? (
                      <span className="pubws-lb-score is-up">${Math.round(c.earnedUsd).toLocaleString('en-US')}</span>
                    ) : (
                      <span className="pubws-lb-score pubws-lb-score--muted">not priced yet</span>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="pubws-lb-empty">No contracts on the board yet. Post one and the market prices what it is worth.</p>
          )}
        </section>
      )}
      <SeasonStrip />
      {/* The way out of a top-ten list: the whole field, on its own page
          (owner direction 2026-08-17). */}
      <a className="pubws-lb-more" href="/leaderboard">Show full leaderboard</a>
    </aside>
  );
}


/**
 * The prize season, on the floor itself.
 *
 * This is where a first-time visitor learns the money exists: they arrive from
 * a link, read the number, and the entry path is one click from there.
 *
 * Shows a season that has not started yet as well as a running one (owner
 * direction 2026-08-18). A season is at its most visible in the days before it
 * opens, and a strip that appears only once it is running throws that window
 * away. Renders nothing when there is no season at all, so the floor is
 * unchanged the rest of the time.
 */
function SeasonStrip() {
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  useEffect(() => {
    api.getSeasons()
      .then(r => setSeason(pickCurrentSeason(r.seasons)))
      .catch(e => console.error('seasons fetch failed:', e));
  }, []);
  const clock = useSeasonClock(season);
  if (!season || !clock) return null;

  return (
    <section className="pubws-lb-section">
      <h2 className="pubws-h2">{season.name}</h2>
      <p className="pubws-season-clock">{clock.headline}</p>
      <p className="pubws-lb-empty">
        ${season.poolUsd.toLocaleString()} in prizes.
        {clock.phase === 'before'
          ? ' Entry is open now, so you are in before it starts.'
          : ' Free to enter, no purchase and no stake.'}
      </p>
      {clock.entryOpen && (
        <a className="pubws-lb-more" href="/account">Enter the season</a>
      )}
      <a className="pubws-lb-more" href={`/leaderboard?season=${encodeURIComponent(season.id)}`}>
        {clock.phase === 'before' ? 'See the board' : 'See the standings'}
      </a>
    </section>
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
