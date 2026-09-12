import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LeaderboardEntry } from '../lib/api';
import { api, type PrizeSeason } from '../lib/api';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { BotMark } from './BotMark';
import { ManifoldLogo } from './ManifoldLogo';

/**
 * The standings under the verbs (docs/ui-conventions.md, "The standings are
 * one footer, not rails, and not two boards"): ONE compact block under the
 * facts row, "Top traders", ten rows over two columns, with one "Show full
 * leaderboard" link under it. Footers, not rails: the first screen is the
 * question, the number and the bet verbs, and nothing about other people
 * above the fold. There is no contractors block here; the contractor
 * standings live on /leaderboard alone, because a floor is read to price
 * the number and to find where the reader stands among the people pricing
 * it. With a proposal selected the footer becomes "Traders on this
 * proposal". The season advert (below) lives in the left column, under the
 * market's definition.
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

/** Rows on the footer (owner ask 2026-09-12: "id like for it to show top
 *  10 in the two columsn on the floor"). Ten, split five and five over the
 *  two columns. */
const ROWS = 10;
/** Rows in the left column; the rest go to the right one. */
const LEFT = 5;

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
            <span className="pubws-lb-name">
              {name}
              <BotMark bot={e.bot} />
            </span>
            <span className="pubws-lb-sub">{e.positionLine}</span>
          </span>
        ) : (
          <span className="pubws-lb-name">
            {name}
            <BotMark bot={e.bot} />
          </span>
        )}
        {e.manifoldUsername && (
          <span className="pubws-lb-manifold" title={`Linked Manifold account: @${e.manifoldUsername}`}>
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
  meId = null,
  season = null,
  proposalTraders,
  botTraders,
}: {
  /** THIS workspace's own board (owner decision 2026-08-22: local by
   *  default; the season and global boards live on /leaderboard, behind
   *  "Show full leaderboard"). */
  entries: LeaderboardEntry[];
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
  /** Distinct bots with a trade on this floor in the last seven days; the
   *  line under the footer (docs/ui-conventions.md, "A bot says it is
   *  one"). Zero or absent draws nothing. */
  botTraders?: number;
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

  // The rows this render draws, in reading order, with the rank each one
  // prints. Ranked by the position's marked profit on a proposal, best
  // first: the rule lives where the rows are drawn, whatever order the
  // reads arrived in.
  const rows: Array<{ e: ProposalTraderRow; rank: number | string; pinned?: boolean }> = onProposal
    ? (proposalTraders ?? [])
        .slice()
        .sort((a, b) => b.totalEarnings - a.totalEarnings)
        .slice(0, ROWS)
        .map((e, i) => ({ e, rank: i + 1 }))
    : [
        ...entries.map((e, i) => ({ e, rank: e.rank ?? i + 1 })),
        ...(minePinned ? [{ e: minePinned, rank: minePinned.rank ?? '-', pinned: true }] : []),
      ];

  // Still loading a proposal's holders: nothing, not an empty board.
  const pending = onProposal && proposalTraders === null;
  const empty = onProposal && proposalTraders !== null && proposalTraders.length === 0;
  if (!onProposal && rows.length === 0) return null;

  const draw = (r: (typeof rows)[number]) => (
    <TraderRow
      key={`${r.pinned ? 'pin-' : ''}${r.e.id}`}
      e={r.e}
      rank={r.rank}
      meId={meId}
      season={season}
      pinned={r.pinned}
    />
  );
  // Ranks 1 to 5 on the left, 6 to 10 on the right (owner ask 2026-09-12).
  // One column under the other in the DOM, so a phone reads 1 to 10 in
  // order with no CSS reordering; the pin rides at the foot of the last
  // column, which is the foot of the stack either way.
  const left = rows.slice(0, LEFT);
  const right = rows.slice(LEFT);

  return (
    <div className="pubws-standings" aria-label="Standings">
      <section className="pubws-lb-block">
        <div className="pubws-lb-head">
          <h2 className="pubws-h2">{onProposal ? 'Traders on this proposal' : 'Top traders'}</h2>
          <span className="pubws-lb-meta">{onProposal ? 'this proposal' : 'this market'}</span>
        </div>
        {pending ? null : empty ? (
          /* Said, not hidden: an empty footer under a proposal would read as
             the block having broken. */
          <ol className="pubws-lb">
            <li className="pubws-lb-row pubws-lb-row--empty">nobody yet</li>
          </ol>
        ) : right.length > 0 ? (
          <div className="pubws-lb-cols">
            <ol className="pubws-lb">{left.map(draw)}</ol>
            <ol className="pubws-lb" start={LEFT + 1}>
              {right.map(draw)}
            </ol>
          </div>
        ) : (
          /* Five or fewer: one column, so the board never leaves an empty
             track beside a short list. */
          <ol className="pubws-lb">{left.map(draw)}</ol>
        )}
      </section>
      {/* The way out is a page, not an expander (owner direction 2026-08-24:
          "show full leaderboard should lead to a new page"). One link under
          the board it extends; the season's control is in the season advert
          in the left column. */}
      {botTraders ? (
        <p className="pubws-lb-bots">
          {botTraders === 1 ? '1 bot trades here.' : `${botTraders} bots trade here.`}{' '}
          <Link to="/agents">Build your own</Link>
        </p>
      ) : null}
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
export function SeasonAdvert({ season, signedIn }: { season: PrizeSeason | null; signedIn: boolean }) {
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

  return (
    <section className="pubws-season" aria-label="Season">
      <p className="pubws-season-hero">
        <span className="pubws-season-prize">${season.poolUsd.toLocaleString('en-US')}</span> in prizes
      </p>
      <p className="pubws-season-terms">{terms.trim()}</p>
      <Link className="pubws-season-go" to="/season">
        {entered ? 'See the season' : clock.entryOpen ? 'Enter the season' : 'See the season'}
      </Link>
    </section>
  );
}
