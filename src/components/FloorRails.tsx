import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry, PublicContractor } from '../lib/api';
import { api, type PrizeSeason } from '../lib/api';
import { formatImpact } from '../lib/formatImpact';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { ManifoldLogo } from './ManifoldLogo';
import { Clock, Dollar } from './MarketFacts';

/**
 * The standings (docs/ui-conventions.md, "The rails: books, season,
 * announcements, standings"): two blocks under the Otto row, "Top traders"
 * and "Top contractors", three rows each, with one foot under the pair
 * naming the two marks that carry money and the way to the full board.
 * Under the market, never above it: nothing about other people belongs on
 * the first screen. With a proposal selected the traders block becomes
 * "Traders on this proposal". The season block (below) lives in the left
 * rail.
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
      {/* One foot under the pair (docs/ui-conventions.md, "The rails"): the
          two marks that carry money, spelled once, and the way out. The way
          out is a page, not an expander (owner direction 2026-08-24: "show
          full leaderboard should lead to a new page"); the season's control
          is in the season block in the left rail. Every mark on a row also
          carries its own hover title. */}
      <p className="pubws-standings-key">
        IN = in the season · $ = prizes claimed ·{' '}
        <Link className="pubws-lb-more" to="/leaderboard">
          Full leaderboard
        </Link>
      </p>
    </div>
  );
}

/**
 * The season block (docs/ui-conventions.md, "The rails: books, season,
 * announcements, standings"). The season is ADVERTISED, not narrated
 * (Viktor, 2026-09-06): the label, one icon row in the floor's own glyph
 * set, the button, and one line of terms. The prize is the hero figure, the
 * terms are the icon row, nothing runs on.
 *
 * For the owner one more line says what the floor costs, because an owner
 * reads "free to enter" as their own bill (critics' round 2026-09-08).
 */
export function SeasonBlock({
  season,
  signedIn,
  canManage = false,
}: {
  season: PrizeSeason | null;
  signedIn: boolean;
  /** A manager reads one more line, who pays. */
  canManage?: boolean;
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

  // The clock fact: whole days while there are any, the clock's own
  // two-unit phrase under a day (never "0 days left"), and the phase's own
  // word once the countdown is over.
  const span = clock.days >= 1 ? `${clock.days} ${clock.days === 1 ? 'day' : 'days'}` : clock.remaining;
  const when =
    clock.phase === 'during'
      ? `${span} left`
      : clock.phase === 'before'
        ? `starts in ${span}`
        : clock.phase === 'ended'
          ? 'settling'
          : 'final standings';
  const control = !clock.entryOpen ? 'See the season' : entered ? 'You are in' : 'Enter the season';

  return (
    <section className="pubws-season" aria-label="Season">
      <div className="pubws-lb-head">
        <h2 className="pubws-h2">{season.name}</h2>
      </div>
      {/* Facts are an icon row, never a sentence (owner rule 2026-09-03),
          in the same glyph set as the floor head and the book's own facts. */}
      <span className="pubws-season-facts" aria-label="This season">
        <span title="The prize pool this season pays out, in real money">
          <Dollar /> ${season.poolUsd.toLocaleString('en-US')} prizes
        </span>
        <span title={clock.headline}>
          <Clock /> {when}
        </span>
      </span>
      <Link className="pubws-season-go" to="/season">
        {control}
      </Link>
      <p className="pubws-season-terms">Free to enter. Prizes paid by Telarchy.</p>
      {canManage && (
        <p className="pubws-season-who">
          This floor costs you nothing. You fund books in credits when you open them. Approved proposals cost their ask,
          in dollars.
        </p>
      )}
    </section>
  );
}
