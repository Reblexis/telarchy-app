import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type PrizeSeason, type SeasonStanding } from '../lib/api';
import { useSeasonClock } from '../lib/useSeasonClock';
import { pickCurrentSeason } from '../lib/season-clock';
import { SeasonEntryButton } from '../components/SeasonEntryButton';
import { ReportButton } from '../components/ReportButton';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { TopBar } from './TradePage';

/**
 * telarchy.com/season: the prize competition, on its own page.
 *
 * It lived as a block on the market page's rail and another on the
 * leaderboard, and between the countdown, the pool, the ladder, the rules and
 * the entry flow it was crowding surfaces whose job is something else (owner
 * direction 2026-08-19). Those two now carry one line and a link; everything
 * the competition has to say is here.
 *
 * Written in the market pages' language (`.pubws`, `.lbp`), not the deleted
 * console's: every public route lands on that design and a visitor should not
 * be able to tell which page was built when.
 */

function initialOf(name: string): string {
  return name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
}

function formatScore(v: number): string {
  const sign = v < 0 ? '-' : v > 0 ? '+' : '';
  const abs = Math.abs(v);
  if (abs >= 1000) return `${sign}${Math.round(abs).toLocaleString('en-US')}`;
  if (abs >= 10) return `${sign}${abs.toFixed(1)}`;
  return `${sign}${abs.toFixed(2)}`;
}

export function SeasonPage() {
  const { user, loading: authLoading } = useAuth();
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  const [rows, setRows] = useState<SeasonStanding[] | null>(null);
  const [missing, setMissing] = useState(false);
  const clock = useSeasonClock(season);
  const meId = useMyParticipantId(!!user);

  useEffect(() => {
    let cancelled = false;
    api.getSeasons()
      .then(r => {
        if (cancelled) return;
        const s = pickCurrentSeason(r.seasons);
        setSeason(s);
        if (!s) setMissing(true);
      })
      .catch(e => { console.error('seasons fetch failed:', e); if (!cancelled) setMissing(true); });
    return () => { cancelled = true; };
  }, []);

  const loadStandings = useCallback(() => {
    if (!season) return;
    api.getSeasonStandings(season.id)
      .then(r => setRows(r.participants))
      // Standings are secondary to the pitch: a failed read leaves the section
      // out rather than replacing the page with an error.
      .catch(e => { console.error('season standings fetch failed:', e); setRows([]); });
  }, [season]);

  useEffect(() => {
    loadStandings();
    // A draft season's board cannot move, so there is nothing to poll for.
    if (!season || season.status !== 'running') return;
    const id = setInterval(() => { if (!document.hidden) loadStandings(); }, 15_000);
    return () => clearInterval(id);
  }, [season, loadStandings]);

  if (missing) {
    return (
      <div className="pubws">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="lbp">
          <h1 className="lbp-head">No season running</h1>
          <p className="lbp-lead">
            There is no prize season right now. The{' '}
            <Link to="/leaderboard">leaderboard</Link> is still live.
          </p>
        </main>
      </div>
    );
  }

  if (!season || !clock) {
    return (
      <div className="pubws">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="lbp" />
      </div>
    );
  }

  const settled = clock.phase === 'settled';
  // The standings response caps at 100; if this entrant is outside it there is
  // nothing to pin, and saying nothing beats inventing a rank.
  const myStanding = meId ? rows?.find(r => r.id === meId) ?? null : null;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">{season.name}</h1>
        <p className="seasonp-clock">{clock.headline}</p>
        <p className="lbp-lead">
          ${season.poolUsd.toLocaleString()} in real money, paid to the participants
          whose trading profit grows the most while the season runs. Free to enter:
          no purchase, no stake, and your credits are never spent or exchanged.
        </p>

        {/* Said before the entry button, not buried under it: someone deciding
            whether to spend eight weeks on this deserves to know the platform
            is still being launched before they decide, not after. */}
        <p className="seasonp-experimental">
          This is the first season, and Telarchy is still being launched. Expect
          rough edges, and apologies in advance for any bug or inconvenience. If
          something looks wrong, tell us: reports are genuinely appreciated, and
          where a bug affects standings we publish the correction rather than
          making it quietly.
        </p>
        {/* The real channel, inline, rather than a sentence pointing at an icon
            in the top bar. Anonymous reports are accepted, so a visitor who hit
            a bug before signing up can still send one. */}
        <p className="seasonp-report"><ReportButton /></p>

        {clock.entryOpen && (
          <section className="seasonp-enter" aria-label="Enter">
            <SeasonEntryButton season={season} signedIn={!!user} />
          </section>
        )}

        <section className="seasonp-block" aria-label="Prizes">
          <h2 className="lbp-season-name">Prizes</h2>
          <ol className="seasonp-ladder">
            {season.ladder.map(rung => (
              <li key={rung.place} className="seasonp-rung">
                <span className="seasonp-place">{rung.place}</span>
                <span className="seasonp-prize">${rung.prizeUsd.toLocaleString()}</span>
              </li>
            ))}
          </ol>
          <p className="seasonp-note">
            A prize needs a season score above zero. Rungs nobody qualifies for roll
            into the next season. Telarchy holds no money: the owner pays winners
            directly, on the same rail paid jobs already use.
          </p>
        </section>

        <section className="seasonp-block" aria-label="How it is scored">
          <h2 className="lbp-season-name">How it is scored</h2>
          <p className="seasonp-note">
            Your score is how much your trading profit GREW during the season, not
            your all-time profit. Everyone&rsquo;s starting point is read at the same
            instant, when the season begins, whether they entered weeks early or on
            the day, so entering early buys nothing and entering late costs nothing.
            An account that did not exist yet starts at zero and keeps everything it
            earns inside the window.
          </p>
          <p className="seasonp-note">
            Profit counts open positions at what the market says they are worth right
            now, so the board moves with every trade rather than waiting for markets
            to resolve. Full terms: <Link to={season.rulesUrl}>{season.name} rules</Link>.
          </p>
        </section>

        <section className="seasonp-block" aria-label="Standings">
          <h2 className="lbp-season-name">{settled ? 'Final standings' : 'Standings'}</h2>
          {rows === null ? null : rows.length === 0 ? (
            <p className="lbp-empty">
              {clock.phase === 'before'
                ? 'Nobody has entered yet. Entry is open now, and the board starts moving when the season does.'
                : 'Nobody has entered yet.'}
            </p>
          ) : (
            <ol className="lbp-list">
              {rows.map(r => {
                const name = r.nickname || 'anonymous';
                return (
                  <li key={r.id} className={`lbp-row${r.id === meId ? ' is-me' : ''}`}>
                    <span className="lbp-rank">{r.rank}</span>
                    <a className="lbp-who" href={`/participants/${encodeURIComponent(r.nickname ?? r.id)}`}>
                      <span className="lbp-avatar">
                        {r.image ? <img src={r.image} alt="" /> : <span>{initialOf(name)}</span>}
                      </span>
                      <span className="lbp-stack">
                        <span className="lbp-name">
                          {name}
                          {r.id === meId && <span className="lbp-you">you</span>}
                        </span>
                      </span>
                    </a>
                    <span className={`lbp-score${r.score > 0 ? ' is-up' : r.score < 0 ? ' is-down' : ''}`}>
                      {formatScore(r.score)}
                    </span>
                    {/* Settled shows what was actually assigned. Running shows
                        what this standing would pay if it settled now, from the
                        same function settlement uses, so the two can never
                        promise different amounts. */}
                    <span className="seasonp-won" title={settled ? 'Prize' : 'What this standing would pay if the season settled now'}>
                      {settled
                        ? (r.prizeUsd && r.prizeUsd > 0 ? `$${r.prizeUsd.toLocaleString()}` : '—')
                        : (r.projectedPrizeUsd && r.projectedPrizeUsd > 0 ? `$${r.projectedPrizeUsd.toLocaleString()}` : '—')}
                    </span>
                  </li>
                );
              })}
              {/* Pinned when the entrant is not in the list above: "where am
                  I" is the question an entrant reads standings to answer. */}
              {meId && !rows.some(r => r.id === meId) && myStanding && (
                <li className="lbp-row is-me is-pinned">
                  <span className="lbp-rank">{myStanding.rank}</span>
                  <a className="lbp-who" href={`/participants/${encodeURIComponent(myStanding.nickname ?? myStanding.id)}`}>
                    <span className="lbp-avatar">
                      <span>{initialOf(myStanding.nickname || 'you')}</span>
                    </span>
                    <span className="lbp-stack">
                      <span className="lbp-name">
                        {myStanding.nickname || 'you'}
                        <span className="lbp-you">you</span>
                      </span>
                    </span>
                  </a>
                  <span className={`lbp-score${myStanding.score > 0 ? ' is-up' : myStanding.score < 0 ? ' is-down' : ''}`}>
                    {formatScore(myStanding.score)}
                  </span>
                  <span className="seasonp-won">
                    {myStanding.projectedPrizeUsd && myStanding.projectedPrizeUsd > 0
                      ? `$${myStanding.projectedPrizeUsd.toLocaleString()}` : '—'}
                  </span>
                </li>
              )}
            </ol>
          )}
          <p className="seasonp-note">
            Season score, not lifetime profit. The{' '}
            <Link to="/leaderboard">all-time board</Link> ranks everyone on everything
            they have ever made.
          </p>
        </section>
      </main>
    </div>
  );
}
