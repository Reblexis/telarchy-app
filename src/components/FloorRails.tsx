import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry, PublicContractor } from '../lib/api';
import { api, type PrizeSeason } from '../lib/api';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
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

function _timeAgo(t: number): string {
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
  const parts = [`${c.jobs} ${c.jobs === 1 ? 'proposal' : 'proposals'}`];
  if (c.pendingJobs > 0) parts.push(`${c.pendingJobs} live`);
  if (c.earnedUsd > 0) parts.push(`$${Math.round(c.earnedUsd).toLocaleString('en-US')} earned`);
  return parts.join(' · ');
}

export function LeaderboardRail({
  entries: all,
  contractors,
  unit = '',
  signedIn = false,
  meId = null,
}: {
  /** THIS workspace's own board (owner decision 2026-08-22: the rail is local
   *  by default; the season and global boards live on /leaderboard, behind
   *  "Show full leaderboard"). */
  entries: LeaderboardEntry[];
  contractors?: PublicContractor[];
  /** The hero metric's currency prefix ('$' or ''), so a contractor's priced
   *  impact reads in the same unit as the market above it. */
  unit?: string;
  /** Whether the visitor has an identity, so the season strip can say whether
   *  they are already in rather than asking them to enter again. */
  signedIn?: boolean;
  /** This visitor's participant id, so their own row can be marked and, when
   *  they are outside the ten shown, pinned underneath. */
  meId?: string | null;
}) {
  // A row for someone who has never traded is a name and a zero: noise.
  // Ten, not five (owner direction 2026-08-17): five made the board look
  // like a podium rather than a field worth joining.
  const traded = all.filter(e => e.totalTrades > 0);
  const entries = traded.slice(0, 10);
  // Pinned underneath when the visitor is outside the ten. A board that shows
  // the top ten and nothing else answers "who is winning" but not "where am
  // I", which is the question the person reading it actually has.
  const mine = meId ? (traded.find(e => e.id === meId) ?? null) : null;
  const minePinned = mine && !entries.some(e => e.id === meId) ? mine : null;
  const hasTraders = entries.length > 0;

  // The prize season, fetched once for the whole rail: the strip at the
  // bottom renders it, and an entrant's row carries a prize chip (owner ask
  // 2026-08-21: "it should be on this leaderboard too", then "just say $500
  // thats it.. and make it a little more prominent"), same states as
  // /leaderboard: the ladder's top rung while the season is a draft, the
  // projected payout from the GLOBAL season standing once it runs (the chip
  // is a season fact, not a workspace one, so a scoped rail and /leaderboard
  // name the same dollars), "in" for a running entrant outside the rungs.
  // One fetch, so the chip and the strip cannot disagree.
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  useEffect(() => {
    api
      .getSeasons()
      .then(r => setSeason(pickCurrentSeason(r.seasons)))
      .catch(e => console.error('seasons fetch failed:', e));
  }, []);
  // An entrant outside the paying places reads "in": the chip marks an
  // entrant among non-entrants on this local board.
  const prizeChip = (e: LeaderboardEntry) => {
    if (!e.seasonEntered) return null;
    if (e.seasonPrizeUsd === null || e.seasonPrizeUsd === undefined) {
      return (
        <span
          className="pubws-lb-prize pubws-lb-prize--in"
          title={`Entered ${season?.name ?? 'the season'}; prizes are set once it starts`}
        >
          entered
        </span>
      );
    }
    if (e.seasonPrizeUsd > 0) {
      return (
        <span className="pubws-lb-prize" title="What this season would pay at the current standing">
          ${e.seasonPrizeUsd.toLocaleString()}
        </span>
      );
    }
    return (
      <span className="pubws-lb-prize pubws-lb-prize--in" title="Entered the season, currently outside the prizes">
        in
      </span>
    );
  };

  const renderRow = (e: LeaderboardEntry, i: number) => {
    const name = e.nickname || 'anonymous';
    const initial = name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
    // Round BEFORE signing: a loss of a hundredth of a credit printed "-0 cr",
    // which reads as a bug rather than as a rounding. Colour follows the
    // printed number, not the raw one.
    const cr = Math.round(e.totalEarnings);
    return (
      <li key={e.id} className={`pubws-lb-row${e.id === meId ? ' is-me' : ''}`}>
        <span className="pubws-lb-rank">{e.rank ?? i + 1}</span>
        <Link className="pubws-lb-who pubws-name-link" to={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}>
          <span className="pubws-lb-avatar">{e.image ? <img src={e.image} alt="" /> : <span>{initial}</span>}</span>
          <span className="pubws-lb-name">{name}</span>
          {e.manifoldUsername && (
            <span className="pubws-lb-manifold" title={`Imported from Manifold: @${e.manifoldUsername}`}>
              <ManifoldLogo size={13} strokeWidth={1.6} />
            </span>
          )}
        </Link>
        {prizeChip(e)}
        <span className={`pubws-lb-score${cr > 0 ? ' is-up' : cr < 0 ? ' is-down' : ''}`}>
          {cr > 0 ? '+' : ''}
          {cr === 0 ? 0 : cr.toLocaleString('en-US')} cr
        </span>
      </li>
    );
  };
  // The contractors block shows whenever the workspace exposes it (Open
  // floor), even with nobody paid yet, so the two-sided economy is visible.
  const showContractors = contractors !== undefined;
  if (!hasTraders && !showContractors) return null;
  return (
    <aside className="pubws-rail pubws-rail--left" aria-label="Leaders">
      {hasTraders && (
        <section className="pubws-lb-block">
          {/* The workspace's own board: this floor's traders, ranked on their
              profit here (owner decision 2026-08-22). The season and global
              boards are on /leaderboard, linked below. */}
          <div className="pubws-lb-head">
            <h2 className="pubws-h2">Top traders</h2>
            <span className="pubws-lb-meta">this market</span>
          </div>
          <ol className="pubws-lb">
            {entries.map((e, i) => renderRow(e, i))}
            {minePinned && (
              <li className="pubws-lb-row is-me is-pinned">
                <span className="pubws-lb-rank">{minePinned.rank ?? '—'}</span>
                <Link
                  className="pubws-lb-who pubws-name-link"
                  to={`/participants/${encodeURIComponent(minePinned.nickname ?? minePinned.id)}`}
                >
                  <span className="pubws-lb-avatar">
                    {minePinned.image ? (
                      <img src={minePinned.image} alt="" />
                    ) : (
                      <span>{(minePinned.nickname || 'anonymous').replace(/^@/, '')[0]?.toUpperCase() ?? '?'}</span>
                    )}
                  </span>
                  <span className="pubws-lb-name">{minePinned.nickname || 'you'}</span>
                </Link>
                {prizeChip(minePinned)}
                {(() => {
                  const cr = Math.round(minePinned.totalEarnings);
                  return (
                    <span className={`pubws-lb-score${cr > 0 ? ' is-up' : cr < 0 ? ' is-down' : ''}`}>
                      {cr > 0 ? '+' : ''}
                      {cr === 0 ? 0 : cr.toLocaleString('en-US')} cr
                    </span>
                  );
                })()}
              </li>
            )}
          </ol>
        </section>
      )}
      {showContractors && (
        <section className="pubws-lb-block">
          <div className="pubws-lb-head">
            <h2 className="pubws-h2">Top contractors</h2>
            <span className="pubws-lb-meta">impact</span>
          </div>
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
                    <Link className="pubws-lb-who pubws-name-link" to={`/participants/${encodeURIComponent(c.id)}`}>
                      <span className="pubws-lb-avatar">
                        <span>{initial}</span>
                      </span>
                      <span className="pubws-lb-stack">
                        <span className="pubws-lb-name">{name}</span>
                        <span className="pubws-lb-sub">{contractorSubline(c)}</span>
                      </span>
                    </Link>
                    {scored ? (
                      <span
                        className={`pubws-lb-score${c.impact! > 0 ? ' is-up' : c.impact! < 0 ? ' is-down' : ''}`}
                        /* No arrow at exactly zero: the market has priced
                           these jobs and called them a wash, which an up
                           arrow would misreport as a gain. */
                        title="What the market says this contractor's proposals are worth: approved minus declined, summed over the live ones."
                      >
                        {c.impact! > 0 ? '▲ ' : c.impact! < 0 ? '▼ ' : ''}
                        {formatImpact(c.impact!, unit)}
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
            <p className="pubws-lb-empty">
              No proposals on the board yet. Post one and the market prices what it is worth.
            </p>
          )}
        </section>
      )}
      {/* The way out of a workspace's own top ten is a page, not an expander
          (owner direction 2026-08-24: "show full leaderboard should lead to
          a new page"). It sits under the boards it extends; the season strip
          is its own block below. */}
      <Link className="pubws-lb-more" to="/leaderboard">
        Show full leaderboard
      </Link>
      <SeasonStrip signedIn={signedIn} season={season} />
    </aside>
  );
}

/**
 * The prize season, on a market page: one line and a link.
 *
 * This used to carry the pool, the pitch, the entry checkbox and the button.
 * All of that lives on /season now (owner direction 2026-08-19); a market page
 * is about the market, and the season was crowding it. What stays is the part
 * a visitor needs in order to know the competition exists and that a clock is
 * running.
 *
 * Renders nothing when there is no season, so the page is unchanged the rest
 * of the time.
 */
function SeasonStrip({ signedIn, season }: { signedIn: boolean; season: PrizeSeason | null }) {
  // Whether THIS visitor is already in. Without it the strip kept saying
  // "Enter the season" to someone who had entered a minute earlier, which
  // reads as the entry not having worked (owner report 2026-08-19).
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    if (!signedIn) {
      setEntered(false);
      return;
    }
    api
      .getMySeason()
      .then(e => setEntered(e.optedIn === true))
      .catch(e => console.error('season entry fetch failed:', e));
  }, [signedIn]);
  const clock = useSeasonClock(season);
  if (!season || !clock) return null;

  return (
    <section className="pubws-lb-section">
      {/* The countdown is the header's meta (owner decision 2026-08-24): the
          one meta in primary colour, because it says whether to act today. */}
      <div className="pubws-lb-head pubws-lb-head--bare">
        <h2 className="pubws-h2">{season.name}</h2>
        <span className="pubws-lb-meta pubws-lb-meta--clock">{clock.headline}</span>
      </div>
      <p className="pubws-lb-empty">
        {entered
          ? `You are in. $${season.poolUsd.toLocaleString()} in prizes.`
          : `$${season.poolUsd.toLocaleString()} in prizes, free to enter.`}
      </p>
      <Link className="pubws-lb-more" to="/season">
        {entered ? 'See the season' : clock.entryOpen ? 'Enter the season' : 'See the season'}
      </Link>
    </section>
  );
}
