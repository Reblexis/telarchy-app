import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry, PublicContractor } from '../lib/api';
import { api, type PrizeSeason } from '../lib/api';
import { formatImpact } from '../lib/formatImpact';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { ManifoldLogo } from './ManifoldLogo';

/**
 * The standings under the verbs (docs/ui-conventions.md, "The rails, and
 * the standings under the verbs"): two compact three-row footers under the
 * facts row, "Top traders" and "Top contractors", with one "Show full
 * leaderboard" link under the pair. Footers, not rails: the first screen is
 * the question, the number and the bet verbs, and nothing about other
 * people above the fold. With a proposal selected the traders footer
 * becomes "Traders on this proposal". The season advert (below) lives in
 * the left column, under the market's definition.
 */

/** A row in the traders footer while a proposal is selected: an account
 *  holding a position on either branch of the pair, scored by that
 *  position's marked profit. Same shape as a leaderboard row so the two
 *  states render through the same row component, plus the one line that
 *  says what the position is. */
export interface ProposalTraderRow extends LeaderboardEntry {
  positionLine?: string;
}

/** The current prize season, fetched once per page: the season advert
 *  prints it and an entrant's row carries its prize chip, so one fetch
 *  keeps the two from disagreeing. */
export function useCurrentSeason(): PrizeSeason | null {
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  useEffect(() => {
    api
      .getSeasons()
      .then(r => setSeason(pickCurrentSeason(r.seasons)))
      .catch(e => console.error('seasons fetch failed:', e));
  }, []);
  return season;
}

/** The row's second line: how many proposals are behind the score and what
 *  the owner has actually paid for them. Dollars stopped being the ranking
 *  key on 2026-08-14, so they live here instead of in the score slot. */
function contractorSubline(c: PublicContractor): string {
  const parts = [`${c.jobs} ${c.jobs === 1 ? 'proposal' : 'proposals'}`];
  if (c.pendingJobs > 0) parts.push(`${c.pendingJobs} live`);
  if (c.earnedUsd > 0) parts.push(`$${Math.round(c.earnedUsd).toLocaleString('en-US')} earned`);
  return parts.join(' · ');
}

/** Rows shown per footer. The rail showed five, then ten; a footer under
 *  the verbs is compact by design. */
const ROWS = 3;

function initialOf(name: string): string {
  return name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
}

/** An entrant's prize chip, same states as /leaderboard: the ladder's top
 *  rung while the season is a draft, the projected payout from the GLOBAL
 *  season standing once it runs (the chip is a season fact, not a workspace
 *  one), "in" for a running entrant outside the rungs. */
function PrizeChip({ e, season }: { e: LeaderboardEntry; season: PrizeSeason | null }) {
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
      <span
        className="pubws-lb-prize"
        title="Prizes claimed: real prize money this season pays at the current standing"
      >
        ${e.seasonPrizeUsd.toLocaleString()}
      </span>
    );
  }
  return (
    <span className="pubws-lb-prize pubws-lb-prize--in" title="In the season, currently outside the prizes">
      in
    </span>
  );
}

/** Round BEFORE signing: a loss of a hundredth of a credit printed "-0 cr",
 *  which reads as a bug rather than as a rounding. Colour follows the
 *  printed number, not the raw one. */
function Credits({ value }: { value: number }) {
  const cr = Math.round(value);
  return (
    <span className={`pubws-lb-score${cr > 0 ? ' is-up' : cr < 0 ? ' is-down' : ''}`}>
      {cr > 0 ? '+' : ''}
      {cr === 0 ? 0 : cr.toLocaleString('en-US')} cr
    </span>
  );
}

function TraderRow({
  e,
  rank,
  meId,
  season,
  pinned = false,
}: {
  e: ProposalTraderRow;
  rank: number | string;
  meId: string | null;
  season: PrizeSeason | null;
  pinned?: boolean;
}) {
  const name = e.nickname || (pinned ? 'you' : 'anonymous');
  return (
    <li className={`pubws-lb-row${e.id === meId ? ' is-me' : ''}${pinned ? ' is-pinned' : ''}`}>
      <span className="pubws-lb-rank">{rank}</span>
      <Link className="pubws-lb-who pubws-name-link" to={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}>
        <span className="pubws-lb-avatar">
          {e.image ? <img src={e.image} alt="" /> : <span>{initialOf(e.nickname || 'anonymous')}</span>}
        </span>
        {e.positionLine ? (
          <span className="pubws-lb-stack">
            <span className="pubws-lb-name">{name}</span>
            <span className="pubws-lb-sub">{e.positionLine}</span>
          </span>
        ) : (
          <span className="pubws-lb-name">{name}</span>
        )}
        {e.manifoldUsername && (
          <span className="pubws-lb-manifold" title={`Linked forecasting record on Manifold: @${e.manifoldUsername}`}>
            <ManifoldLogo size={13} strokeWidth={1.6} />
          </span>
        )}
      </Link>
      <PrizeChip e={e} season={season} />
      <Credits value={e.totalEarnings} />
    </li>
  );
}

export function FloorStandings({
  entries: all,
  contractors,
  unit = '',
  meId = null,
  season = null,
  proposalTraders,
}: {
  /** THIS workspace's own board (owner decision 2026-08-22: local by
   *  default; the season and global boards live on /leaderboard, behind
   *  "Show full leaderboard"). */
  entries: LeaderboardEntry[];
  contractors?: PublicContractor[];
  /** The hero metric's currency prefix ('$' or ''), so a contractor's priced
   *  impact reads in the same unit as the market above it. */
  unit?: string;
  /** This visitor's participant id, so their own row can be marked and, when
   *  they are outside the rows shown, pinned underneath. */
  meId?: string | null;
  /** The current season, for the prize chip on an entrant's row. */
  season?: PrizeSeason | null;
  /** With a proposal selected: the accounts holding a position on either
   *  branch of its pair, ranked by marked profit (an empty list means nobody
   *  yet; null means still loading). Undefined when no proposal is
   *  selected, which is the workspace board. */
  proposalTraders?: ProposalTraderRow[] | null;
}) {
  const onProposal = proposalTraders !== undefined;
  // A row for someone who has never traded is a name and a zero: noise.
  const traded = all.filter(e => e.totalTrades > 0);
  const entries = traded.slice(0, ROWS);
  // Pinned underneath when the visitor is outside the rows shown. A board
  // that shows the top and nothing else answers "who is winning" but not
  // "where am I", which is the question the person reading it has. Not on
  // a proposal: there the list is everyone who holds one, complete.
  const mine = meId && !onProposal ? (traded.find(e => e.id === meId) ?? null) : null;
  const minePinned = mine && !entries.some(e => e.id === meId) ? mine : null;
  const hasTraders = onProposal || entries.length > 0;
  // The contractors block shows whenever the workspace exposes it (Open
  // floor), even with nobody paid yet, so the two-sided economy is visible.
  const showContractors = contractors !== undefined;
  if (!hasTraders && !showContractors) return null;
  return (
    <div className="pubws-standings" aria-label="Standings">
      <div className="pubws-standings-pair">
        {hasTraders && (
          <section className="pubws-lb-block">
            <div className="pubws-lb-head">
              <h2 className="pubws-h2">{onProposal ? 'Traders on this proposal' : 'Top traders'}</h2>
              <span className="pubws-lb-meta">{onProposal ? 'this proposal' : 'this market'}</span>
            </div>
            <ol className="pubws-lb">
              {onProposal ? (
                proposalTraders === null ? null : proposalTraders.length === 0 ? (
                  /* Said, not hidden: an empty footer under a proposal would
                     read as the block having broken. */
                  <li className="pubws-lb-row pubws-lb-row--empty">nobody yet</li>
                ) : (
                  /* Ranked by the position's marked profit, best first: the
                     rule lives where the rows are drawn, whatever order the
                     reads arrived in. */
                  [...proposalTraders]
                    .sort((a, b) => b.totalEarnings - a.totalEarnings)
                    .slice(0, ROWS)
                    .map((e, i) => <TraderRow key={e.id} e={e} rank={i + 1} meId={meId} season={season} />)
                )
              ) : (
                <>
                  {entries.map((e, i) => (
                    <TraderRow key={e.id} e={e} rank={e.rank ?? i + 1} meId={meId} season={season} />
                  ))}
                  {minePinned && (
                    <TraderRow e={minePinned} rank={minePinned.rank ?? '-'} meId={meId} season={season} pinned />
                  )}
                </>
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
                {contractors!.slice(0, ROWS).map((c, i) => {
                  const name = c.name || 'anonymous';
                  // The score is what the market currently says this poster's
                  // proposals are worth. Unpriced ones say so rather than
                  // printing a confident zero; a workspace with no hero
                  // market to price against falls back to dollars.
                  const scored = c.impact !== null && c.pricedJobs > 0;
                  return (
                    <li key={c.id} className="pubws-lb-row">
                      <span className="pubws-lb-rank">{i + 1}</span>
                      <Link className="pubws-lb-who pubws-name-link" to={`/participants/${encodeURIComponent(c.id)}`}>
                        <span className="pubws-lb-avatar">
                          <span>{initialOf(name)}</span>
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
                             these proposals and called them a wash, which an
                             up arrow would misreport as a gain. */
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
      </div>
      {/* The footnote (critics' round 2): the two marks that carry money,
          spelled once under the pair. Every mark also has a hover title. */}
      <p className="pubws-standings-key">IN = in the season · $ = prizes claimed</p>
      {/* The way out is a page, not an expander (owner direction 2026-08-24:
          "show full leaderboard should lead to a new page"). One link under
          the pair it extends; the season's control is in the season advert
          in the left column. */}
      <Link className="pubws-lb-more" to="/leaderboard">
        Show full leaderboard
      </Link>
    </div>
  );
}

/**
 * The season advert (docs/ui-conventions.md, "The rails, and the standings
 * under the verbs": "the season is ADVERTISED, not narrated"). Three lines
 * in the left column, under the definition: the money as the hero, in the
 * mono numeral style of the market's own numbers; one short line of the
 * terms; then the "Enter the season" / "See the season" control. No trader
 * or volume count in it, no "and", no running sentence: the facts row is
 * the only place the counts appear.
 */
export function SeasonAdvert({
  season,
  signedIn,
  canManage = false,
  line = false,
}: {
  season: PrizeSeason | null;
  signedIn: boolean;
  /** A manager reads one more line, who pays: an owner reads "free to
   *  enter" as their own bill (critics' round 2026-09-08). */
  canManage?: boolean;
  /** The one-line form under the facts row, for the widths below 1500px
   *  (critics' round 2): "$1,000 in prizes · Season 0 ends in 23 days ·
   *  Enter the season". The stylesheet shows this or the block, never both. */
  line?: boolean;
}) {
  // Whether THIS visitor is already in. Without it the block kept saying
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

  // The terms, one line: the clock's whole days while there are any, its
  // own two-unit phrase under a day (never "0 days"), and the phase's
  // sentence once the countdown is over.
  const span = clock.days >= 1 ? `${clock.days} ${clock.days === 1 ? 'day' : 'days'}` : clock.remaining;
  const standing = entered ? 'You are in.' : clock.entryOpen ? 'Free to enter.' : '';
  const terms =
    clock.phase === 'during'
      ? `${season.name} ends in ${span}. ${standing}`
      : clock.phase === 'before'
        ? `${season.name} starts in ${span}. ${standing}`
        : clock.phase === 'ended'
          ? `${season.name} has ended. Standings are being settled.`
          : `${season.name} is over. Final standings.`;

  const control = entered ? 'See the season' : clock.entryOpen ? 'Enter the season' : 'See the season';
  if (line) {
    // The countdown alone, no standing and no full stop: the dots do the
    // joining.
    const when =
      clock.phase === 'during'
        ? `${season.name} ends in ${span}`
        : clock.phase === 'before'
          ? `${season.name} starts in ${span}`
          : clock.phase === 'ended'
            ? `${season.name} has ended`
            : `${season.name} is over`;
    return (
      <p className="pubws-season pubws-season--line" aria-label="Season">
        <span className="pubws-season-prize">${season.poolUsd.toLocaleString('en-US')}</span> in prizes · {when} ·{' '}
        <Link className="pubws-season-go" to="/season">
          {control}
        </Link>
      </p>
    );
  }

  return (
    <section className="pubws-season" aria-label="Season">
      <p className="pubws-season-hero">
        <span className="pubws-season-prize">${season.poolUsd.toLocaleString('en-US')}</span> in prizes
      </p>
      <p className="pubws-season-terms">{terms.trim()}</p>
      {canManage && <p className="pubws-season-who">Prizes paid by Telarchy. Your floor costs you nothing.</p>}
      <Link className="pubws-season-go" to="/season">
        {control}
      </Link>
    </section>
  );
}
