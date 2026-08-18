import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeasonClock } from '../lib/useSeasonClock';
import { pickCurrentSeason } from '../lib/season-clock';
import { api, type PrizeSeason, type SeasonStanding } from '../lib/api';

function formatScore(v: number): string {
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${Math.round(abs).toLocaleString()}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

/**
 * A prize season's standings.
 *
 * The column is SCORE, not profit, and the distinction is the whole feature: a
 * participant who arrived already up 400 credits and ended up 410 earned 10
 * this season. Labelling it "profit" would put a veteran at the top of a board
 * they did nothing to win.
 *
 * A running season is live. A settled one shows the frozen finals and the
 * prizes, and does not move again no matter what prices do afterwards.
 */
export function SeasonStandings({ seasonId }: { seasonId: string }) {
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  const [rows, setRows] = useState<SeasonStanding[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.getSeasonStandings(seasonId)
        .then(r => { if (!cancelled) { setSeason(r.season); setRows(r.participants); } })
        .catch(e => {
          console.error('season standings fetch failed:', e);
          if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load standings');
        });
    };
    load();
    // Same cadence as the board it is derived from. A settled season never
    // changes, so stop polling once it has.
    const interval = setInterval(() => { if (!document.hidden) load(); }, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [seasonId]);

  const clock = useSeasonClock(season);
  if (error) return <div className="error show">{error}</div>;
  if (!season || rows === null || !clock) return <p className="leaderboard-muted">Loading…</p>;

  const settled = season.status === 'settled';

  return (
    <div className="leaderboard page">
      <header className="leaderboard-head">
        <h1 className="leaderboard-title">{season.name}</h1>
        <p className="leaderboard-sub">
          ${season.poolUsd.toLocaleString()} across {season.ladder.length} places
          {season.ladder[0] ? `, $${season.ladder[0].prizeUsd.toLocaleString()} for first` : ''}.
          {` ${clock.headline}.`}
          {' '}Ranked on how much each entrant's marked profit grew since the
          season started, not on lifetime profit. Free to enter, no purchase and
          no stake. <Link to={season.rulesUrl}>Rules</Link> ·{' '}
          <Link to="/leaderboard">All-time board</Link>
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="leaderboard-muted">
          {clock.phase === 'before'
            ? 'Nobody has entered yet. Entry is already open on your account page, and everyone\u2019s starting score is taken when the season begins.'
            : 'Nobody has entered yet. Enter from your account page.'}
        </p>
      ) : (
        <div className="leaderboard-table" role="table" aria-label={`${season.name} standings`}>
          <div className="leaderboard-row leaderboard-row-head" role="row">
            <span className="leaderboard-col-rank" role="columnheader">#</span>
            <span className="leaderboard-col-name" role="columnheader">Entrant</span>
            <span className="leaderboard-col-num" role="columnheader" title="Growth in trading profit since this season started. Not lifetime profit.">Season score</span>
            {settled && <span className="leaderboard-col-num" role="columnheader">Prize</span>}
          </div>
          {rows.map(r => (
            <div key={r.id} className="leaderboard-row" role="row">
              <span className="leaderboard-col-rank" role="cell">{r.rank}</span>
              <span className="leaderboard-col-name" role="cell">
                <Link to={`/participants/${encodeURIComponent(r.nickname ?? r.id)}`} className="leaderboard-name">
                  {r.nickname || r.id}
                </Link>
              </span>
              <span className={`leaderboard-col-num ${r.score > 0 ? 'pos' : r.score < 0 ? 'neg' : ''}`} role="cell">
                {formatScore(r.score)}
              </span>
              {settled && (
                <span className="leaderboard-col-num" role="cell">
                  {r.prizeUsd && r.prizeUsd > 0 ? `$${r.prizeUsd.toLocaleString()}` : '—'}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {season.workspacesDropped ? (
        <p className="leaderboard-muted" style={{ marginTop: '0.75rem', fontSize: '0.8rem' }}>
          {season.workspacesDropped} workspace{season.workspacesDropped === 1 ? '' : 's'} in this
          season is no longer public, so its trading is not shown here.
        </p>
      ) : null}
    </div>
  );
}

/**
 * A one-line pointer to the running (or just-settled) season, shown above the
 * all-time board. Renders nothing when there is no season, rather than an empty
 * strip explaining that there is no season.
 */
export function SeasonBanner() {
  const [season, setSeason] = useState<PrizeSeason | null>(null);

  useEffect(() => {
    api.getSeasons()
      .then(r => setSeason(pickCurrentSeason(r.seasons)))
      .catch(e => console.error('seasons fetch failed:', e));
  }, []);

  const clock = useSeasonClock(season);
  if (!season || !clock) return null;

  return (
    <p className="leaderboard-sub" style={{ marginBottom: '1rem' }}>
      <strong>{season.name}</strong>: ${season.poolUsd.toLocaleString()} in prizes,{' '}
      {clock.phase === 'settled' ? 'final standings' : clock.headline.toLowerCase()}.{' '}
      {clock.entryOpen && <><Link to="/account">Enter</Link>{' · '}</>}
      <Link to={`/leaderboard?season=${encodeURIComponent(season.id)}`}>
        {clock.phase === 'settled' ? 'See who won' : 'See the standings'}
      </Link>
    </p>
  );
}
