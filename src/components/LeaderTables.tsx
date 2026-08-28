import { Link } from 'react-router-dom';
import type { LeaderboardEntry, PrizeSeason, SeasonStanding } from '../lib/api';
import { ManifoldLogo } from './ManifoldLogo';

/**
 * The leaderboard as real tables (owner ask 2026-08-28: "more like a table
 * showing the different statistics in different columns, so it's more clear
 * what the season is scoring on"). Two tables, two questions:
 *
 *  - SeasonTable: the money board. Its settled-profit column carries the
 *    accent underline because it IS the scoring key: the pool is split in
 *    proportion to positive settled score (docs/seasons.md, "The score" and
 *    Eligibility). Share-of-pool is derived from projected prize over pool,
 *    which is the true paid share (min-payout and eligibility included),
 *    not raw score over total.
 *  - AllTimeTable: everyone, ranked on total profit including open marks,
 *    with Settled / Open / Total as columns so a marks-only leader is
 *    legible at a glance instead of buried in a sub-line.
 *
 * Both are used by /leaderboard and /season, so the two surfaces cannot
 * drift into presenting the same standings differently.
 */

export function initialOf(name: string): string {
  return name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
}

/**
 * One credit formatter for every column, because the same trader's number
 * rendering differently in two tables reads as a bug (design review,
 * 2026-08-28): under 1,000 keep up to two decimals (season scores are
 * small and the cents are the contest), at or above 1,000 whole credits.
 */
export function fmtCr(n: number): string {
  const sign = n > 0 ? '+' : '';
  if (Math.abs(n) >= 1000) return `${sign}${Math.round(n).toLocaleString('en-US')}`;
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return `${sign}${s === '-0' ? '0' : s}`;
}

function numClass(n: number, key = false): string {
  const tone = n > 0.004 ? ' is-up' : n < -0.004 ? ' is-down' : ' is-zero';
  return `lbt-num${tone}${key ? ' is-key' : ''}`;
}

function TraderCell({
  id,
  nickname,
  image,
  manifoldUsername,
  sub,
}: {
  id: string;
  nickname: string | null;
  image?: string | null;
  manifoldUsername?: string | null;
  sub?: string | null;
}) {
  const name = nickname || 'anonymous';
  return (
    <Link className="lbt-who" to={`/participants/${encodeURIComponent(nickname ?? id)}`}>
      <span className="lbp-avatar">{image ? <img src={image} alt="" /> : <span>{initialOf(name)}</span>}</span>
      <span className="lbt-stack">
        <span className="lbt-name">
          {name}
          {manifoldUsername && (
            <span className="lbp-manifold" title={`Imported from Manifold: @${manifoldUsername}`}>
              <ManifoldLogo size={12} strokeWidth={1.6} />
            </span>
          )}
        </span>
        {sub && <span className="lbt-sub">{sub}</span>}
      </span>
    </Link>
  );
}

/**
 * The season standings. `mode` follows the season's lifecycle: a draft has
 * no scores (no baselines exist), so it lists entrants alone; running shows
 * the live projection; settled shows the stored finals.
 */
export function SeasonTable({
  rows,
  season,
  mode,
  meId,
  pinned,
}: {
  rows: SeasonStanding[];
  season: PrizeSeason;
  mode: 'draft' | 'running' | 'settled';
  meId?: string | null;
  pinned?: SeasonStanding | null;
}) {
  const draft = mode === 'draft';
  const row = (r: SeasonStanding, isPinned = false) => {
    const score = r.score ?? 0;
    const prize = (mode === 'settled' ? r.prizeUsd : (r.projectedPrizeUsd ?? r.prizeUsd)) ?? 0;
    const share = prize > 0 && season.poolUsd > 0 ? `${Math.round((prize / season.poolUsd) * 100)}%` : '—';
    return (
      <tr
        key={`${isPinned ? 'pin-' : ''}${r.id}`}
        className={`${r.id === meId ? 'is-me' : ''}${isPinned ? ' is-pinned' : ''}`.trim() || undefined}
      >
        <td className="lbt-rank">{r.rank}</td>
        <td className="lbt-cell is-left">
          <TraderCell
            id={r.id}
            nickname={r.nickname}
            image={r.image}
            manifoldUsername={r.manifoldUsername}
            sub={!draft && prize > 0 ? `${share} of the pool` : null}
          />
        </td>
        {!draft && (
          <>
            <td className={numClass(score, true)}>
              {r.score === null ? '' : `${fmtCr(score)} cr`}
              {/* The phone hides the prize column; the dollars move under
                  the score so the money never scrolls off the edge. */}
              {prize > 0 && <span className="lbt-msub is-prize">${prize.toLocaleString()}</span>}
            </td>
            <td className={`lbt-num lbt-desk${prize > 0 ? '' : ' is-zero'}`}>{share}</td>
            <td
              className={`lbt-num lbt-desk${prize > 0 ? ' is-prize' : ' is-zero'}`}
              title={mode === 'settled' ? 'Prize' : 'What this standing would pay if the season settled right now'}
            >
              {prize > 0 ? `$${prize.toLocaleString()}` : '—'}
            </td>
          </>
        )}
      </tr>
    );
  };
  return (
    <table className="lbt">
      <thead>
        <tr>
          <th className="lbt-h is-left lbt-h-rank">#</th>
          <th className="lbt-h is-left">Entrant</th>
          {!draft && (
            <>
              <th className="lbt-h is-key">Settled profit ↓</th>
              <th className="lbt-h lbt-desk">Share of pool</th>
              <th className="lbt-h lbt-desk">{mode === 'settled' ? 'Prize' : 'Projected prize'}</th>
            </>
          )}
        </tr>
      </thead>
      <tbody>
        {rows.map(r => row(r))}
        {/* Pinned when the entrant is not in the list above: "where am I" is
            the question an entrant reads standings to answer. */}
        {pinned && row(pinned, true)}
      </tbody>
    </table>
  );
}

/** Accuracy is only meaningful once a few markets have actually settled. */
function accuracySub(e: LeaderboardEntry): string | null {
  if (e.accuracy === null || e.accuracy === undefined) return null;
  if (e.resolvedMarkets < 3) return null;
  return `${Math.round(e.accuracy * 100)}% accurate over ${e.resolvedMarkets} settled`;
}

/**
 * The all-time board. The Season column keeps the chip states the season
 * always had on this board (owner reports 2026-08-21): a neutral "entered"
 * before scores exist or outside the money, dollars once a standing pays,
 * nothing for a bystander. It renders only while a season exists to talk
 * about.
 */
export function AllTimeTable({
  rows,
  pinned,
  meId,
  season,
}: {
  rows: LeaderboardEntry[];
  pinned?: LeaderboardEntry | null;
  meId?: string | null;
  season?: PrizeSeason | null;
}) {
  const hasSplit = rows.some(e => e.settledEarnings !== undefined && e.openEarnings !== undefined);
  const row = (e: LeaderboardEntry, rank: number, isPinned = false) => {
    const split = e.settledEarnings !== undefined && e.openEarnings !== undefined;
    return (
      <tr
        key={`${isPinned ? 'pin-' : ''}${e.id}`}
        className={`${e.id === meId ? 'is-me' : ''}${isPinned ? ' is-pinned' : ''}`.trim() || undefined}
      >
        <td className="lbt-rank">{rank || '—'}</td>
        <td className="lbt-cell is-left">
          <TraderCell
            id={e.id}
            nickname={e.nickname}
            image={e.image}
            manifoldUsername={e.manifoldUsername}
            sub={accuracySub(e)}
          />
          {/* The split, restated under the name on a phone, where the two
              middle columns are hidden rather than squeezed. */}
          {split && (
            <span className="lbt-msub">
              {fmtCr(e.settledEarnings as number)} settled · {fmtCr(e.openEarnings as number)} open
            </span>
          )}
        </td>
        <td className="lbt-num lbt-desk is-plain">{e.totalTrades.toLocaleString('en-US')}</td>
        <td className={`lbt-desk ${split ? numClass(e.settledEarnings as number) : 'lbt-num is-zero'}`}>
          {split ? fmtCr(e.settledEarnings as number) : '—'}
        </td>
        <td className={`lbt-desk ${split ? numClass(e.openEarnings as number) : 'lbt-num is-zero'}`}>
          {split ? fmtCr(e.openEarnings as number) : '—'}
        </td>
        <td className={numClass(e.totalEarnings)}>{fmtCr(e.totalEarnings)} cr</td>
        {season && (
          <td className="lbt-num lbt-desk lbt-season-cell">
            {e.seasonEntered ? (
              e.seasonPrizeUsd === null || e.seasonPrizeUsd === undefined ? (
                <span
                  className="lbp-prize lbp-prize--in"
                  title={`Entered ${season.name}; prizes are set once it starts`}
                >
                  entered
                </span>
              ) : e.seasonPrizeUsd > 0 ? (
                <span className="lbp-prize" title="What this season would pay at the current standing">
                  ${e.seasonPrizeUsd.toLocaleString()}
                </span>
              ) : (
                <span className="lbp-prize lbp-prize--in" title="Entered the season, currently outside the prizes">
                  entered
                </span>
              )
            ) : (
              <span className="is-zero">—</span>
            )}
          </td>
        )}
      </tr>
    );
  };
  return (
    <table className="lbt">
      <thead>
        <tr>
          <th className="lbt-h is-left lbt-h-rank">#</th>
          <th className="lbt-h is-left">Trader</th>
          <th className="lbt-h lbt-desk">Trades</th>
          <th className="lbt-h lbt-desk" title={hasSplit ? 'Resolutions and refunds: final' : undefined}>
            Settled
          </th>
          <th className="lbt-h lbt-desk" title={hasSplit ? 'What open positions are worth right now' : undefined}>
            Open
          </th>
          <th className="lbt-h">Total ↓</th>
          {season && <th className="lbt-h lbt-desk">Season</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((e, i) => row(e, e.rank ?? i + 1))}
        {pinned && row(pinned, pinned.rank ?? 0, true)}
      </tbody>
    </table>
  );
}
