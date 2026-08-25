import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ReportButton } from '../components/ReportButton';
import { SeasonEntryButton } from '../components/SeasonEntryButton';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { api, type PrizeSeason, type SeasonStanding } from '../lib/api';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
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
    api
      .getSeasons()
      .then(r => {
        if (cancelled) return;
        const s = pickCurrentSeason(r.seasons);
        setSeason(s);
        if (!s) setMissing(true);
      })
      .catch(e => {
        console.error('seasons fetch failed:', e);
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStandings = useCallback(() => {
    if (!season) return;
    api
      .getSeasonStandings(season.id)
      .then(r => setRows(r.participants))
      // Standings are secondary to the pitch: a failed read leaves the section
      // out rather than replacing the page with an error.
      .catch(e => {
        console.error('season standings fetch failed:', e);
        setRows([]);
      });
  }, [season]);

  useEffect(() => {
    loadStandings();
    // A draft season's board cannot move, so there is nothing to poll for.
    if (!season || season.status !== 'running') return;
    const id = setInterval(() => {
      if (!document.hidden) loadStandings();
    }, 15_000);
    return () => clearInterval(id);
  }, [season, loadStandings]);

  if (missing) {
    return (
      <div className="pubws">
        <TopBar user={!!user} ready={!authLoading} />
        <main className="lbp">
          <h1 className="lbp-head">No season running</h1>
          <p className="lbp-lead">
            There is no prize season right now. The <Link to="/leaderboard">leaderboard</Link> is still live.
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
  // Draft standings carry entrants with no score (no baseline exists yet);
  // the page lists who is in rather than claiming nobody entered.
  const draft = season?.status === 'draft';
  // The standings response caps at 100; if this entrant is outside it there is
  // nothing to pin, and saying nothing beats inventing a rank.
  const myStanding = meId ? (rows?.find(r => r.id === meId) ?? null) : null;

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp seasonp">
        {/* The poster order: what this is, when, what it pays, the caveat,
            then the one action. The pool is the page's large number, in the
            same register the floor gives its price: the money is the reason
            a visitor is here, so it is the hero rather than a clause inside
            a paragraph (owner ask 2026-08-19: the page read as a wall of
            same-weight text). */}
        <p className="seasonp-eyebrow">Prize season</p>
        <h1 className="lbp-head">{season.name}</h1>
        <p className="seasonp-clock">{clock.headline}</p>

        <section className="seasonp-hero" aria-label="Prize pool">
          <p className="seasonp-pool">${season.poolUsd.toLocaleString()}</p>
          <p className="seasonp-pool-sub">
            in real money, paid to the five whose trading profit grows the most while the season runs. Free to enter: no
            purchase, no stake, your credits are never spent or exchanged.
          </p>
        </section>

        {/* Said before the entry button, not buried under it: someone deciding
            whether to spend eight weeks on this deserves to know the platform
            is still being launched before they decide, not after. */}
        <p className="seasonp-experimental">
          Season 0 is the first one, and the platform is still being launched. Expect rough edges, apologies in advance.
          If something looks wrong, tell us: where a bug affects standings we publish the correction.
        </p>
        {/* The rules require every mid-season change to be announced HERE
            before it takes effect. Remove when Season 0 settles. */}
        <p className="seasonp-experimental">
          Rule change, 2026-08-22: a prize no longer requires a positive score; place alone decides it. The change only
          increases what is paid.
        </p>
        <p className="seasonp-experimental">
          Rule change, 2026-08-25: accounts that own or administer a workspace are explicitly eligible, and their
          trades in it count like any other. The change widens who may enter and reduces nobody's standing.
        </p>
        {/* The real channel, inline, rather than a sentence pointing at an icon
            in the top bar. Anonymous reports are accepted, so a visitor who hit
            a bug before signing up can still send one. */}
        <p className="seasonp-report">
          <ReportButton />
        </p>

        {clock.entryOpen && (
          <section className="seasonp-enter" aria-label="Enter">
            <SeasonEntryButton season={season} signedIn={!!user} />
          </section>
        )}

        <section className="seasonp-block" aria-label="Prizes">
          <h2 className="lbp-season-name">Prizes</h2>
          {/* Each rung's bar length IS the prize, scaled to first place, so
              the halving ladder (500, 250, 125...) is visible as a shape
              rather than a column of numbers to compare. Monochrome bars,
              accent only on the rung being fought over. */}
          <ol className="seasonp-ladder">
            {season.ladder.map(rung => {
              const top = Math.max(...season.ladder.map(r => r.prizeUsd));
              return (
                <li key={rung.place} className="seasonp-rung">
                  <span className="seasonp-place">{rung.place}</span>
                  <span className="seasonp-bar" aria-hidden="true">
                    <span
                      className={`seasonp-bar-fill${rung.place === 1 ? ' is-top' : ''}`}
                      style={{ width: `${Math.max(4, (rung.prizeUsd / top) * 100)}%` }}
                    />
                  </span>
                  <span className="seasonp-prize">${rung.prizeUsd.toLocaleString()}</span>
                </li>
              );
            })}
          </ol>
        </section>

        <section className="seasonp-block" aria-label="How it is scored">
          <h2 className="lbp-season-name">How it is scored</h2>
          <p className="seasonp-formula">season score = trading profit now - trading profit at season start</p>
          {/* The formula and the rules link are the whole section (owner
              direction 2026-08-19: the explanatory paragraphs are gone; the
              rules doc carries the detail). */}
          <p className="seasonp-note">
            <Link to={season.rulesUrl}>{season.name} rules</Link>
          </p>
        </section>

        <section className="seasonp-block" aria-label="Standings">
          <h2 className="lbp-season-name">{draft ? 'Entered' : settled ? 'Final standings' : 'Standings'}</h2>
          {rows === null ? null : rows.length === 0 ? (
            <p className="lbp-empty">Nobody has entered yet.</p>
          ) : (
            <>
              {/* The right column needed a name: "$500" beside a score read as
                a balance until hovered. Mirrors the row's own cell widths. */}
              <div className="seasonp-cols" aria-hidden="true">
                <span className="seasonp-cols-rank">#</span>
                <span className="seasonp-cols-who">participant</span>
                <span className="seasonp-cols-score">{draft ? '' : 'score'}</span>
                <span className="seasonp-cols-pays">{draft ? '' : settled ? 'prize' : 'pays now'}</span>
              </div>
              <ol className="lbp-list">
                {rows.map(r => {
                  const name = r.nickname || 'anonymous';
                  return (
                    <li key={r.id} className={`lbp-row${r.id === meId ? ' is-me' : ''}`}>
                      <span className="lbp-rank">{r.rank}</span>
                      <Link className="lbp-who" to={`/participants/${encodeURIComponent(r.nickname ?? r.id)}`}>
                        <span className="lbp-avatar">
                          {r.image ? <img src={r.image} alt="" /> : <span>{initialOf(name)}</span>}
                        </span>
                        <span className="lbp-stack">
                          <span className="lbp-name">{name}</span>
                        </span>
                      </Link>
                      <span
                        className={`lbp-score${(r.score ?? 0) > 0 ? ' is-up' : (r.score ?? 0) < 0 ? ' is-down' : ''}`}
                      >
                        {r.score === null ? '' : formatScore(r.score)}
                      </span>
                      {/* Settled shows what was actually assigned. Running shows
                        what this standing would pay if it settled now, from the
                        same function settlement uses, so the two can never
                        promise different amounts. */}
                      <span
                        className="seasonp-won"
                        title={
                          draft
                            ? undefined
                            : settled
                              ? 'Prize'
                              : 'What this standing would pay if the season settled now'
                        }
                      >
                        {draft
                          ? ''
                          : settled
                            ? r.prizeUsd && r.prizeUsd > 0
                              ? `$${r.prizeUsd.toLocaleString()}`
                              : '—'
                            : r.projectedPrizeUsd && r.projectedPrizeUsd > 0
                              ? `$${r.projectedPrizeUsd.toLocaleString()}`
                              : '—'}
                      </span>
                    </li>
                  );
                })}
                {/* Pinned when the entrant is not in the list above: "where am
                  I" is the question an entrant reads standings to answer. */}
                {meId && !rows.some(r => r.id === meId) && myStanding && (
                  <li className="lbp-row is-me is-pinned">
                    <span className="lbp-rank">{myStanding.rank}</span>
                    <Link
                      className="lbp-who"
                      to={`/participants/${encodeURIComponent(myStanding.nickname ?? myStanding.id)}`}
                    >
                      <span className="lbp-avatar">
                        <span>{initialOf(myStanding.nickname || 'you')}</span>
                      </span>
                      <span className="lbp-stack">
                        <span className="lbp-name">{myStanding.nickname || 'you'}</span>
                      </span>
                    </Link>
                    <span
                      className={`lbp-score${(myStanding.score ?? 0) > 0 ? ' is-up' : (myStanding.score ?? 0) < 0 ? ' is-down' : ''}`}
                    >
                      {myStanding.score === null ? '' : formatScore(myStanding.score)}
                    </span>
                    <span className="seasonp-won">
                      {myStanding.projectedPrizeUsd && myStanding.projectedPrizeUsd > 0
                        ? `$${myStanding.projectedPrizeUsd.toLocaleString()}`
                        : '—'}
                    </span>
                  </li>
                )}
              </ol>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
