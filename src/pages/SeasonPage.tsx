import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SeasonTable } from '../components/LeaderTables';
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
            {season.payoutMode === 'proportional'
              ? 'in real money, split by settled trading profit. Free to enter, nothing of yours at stake.'
              : 'in real money, paid by place on settled trading profit. Free to enter, nothing of yours at stake.'}
          </p>
        </section>

        {/* Said before the entry button, not buried under it: someone deciding
            whether to spend eight weeks on this deserves to know the platform
            is still being launched before they decide, not after. */}
        <p className="seasonp-experimental">
          Season 0 is the first one and the platform is still launching. Expect rough edges, and tell us if something
          looks wrong: where a bug affects standings we publish the correction.
        </p>
        {/* The rules require every mid-season change to be announced HERE
            before it takes effect. Remove when Season 0 settles. Collapsed by
            default (owner ask 2026-08-28: "the rule changes are way too
            many"), with the NEWEST change as the always-visible summary line,
            because an announcement a visitor has to open is not announced. */}
        <details className="seasonp-rulechanges">
          <summary className="seasonp-experimental seasonp-rulechanges-summary">
            {season.payoutMode === 'proportional'
              ? 'Rule change, 2026-08-28, effective now: the pool is split in proportion to positive settled profit, replacing the fixed prizes by place. Every entrant in the green is paid a share.'
              : "Rule change, 2026-08-28, effective now: only markets that resolve during the season score. Open positions score nothing until they do, and trades in a market's final 6 hours do not count."}
            <span className="seasonp-rulechanges-toggle" aria-hidden="true">
              earlier changes
            </span>
          </summary>
          {season.payoutMode === 'proportional' && (
            <p className="seasonp-experimental">
              Rule change, 2026-08-28: only markets that resolve during the season score. Open positions score nothing
              until they do, and trades in a market's final 6 hours do not count.
            </p>
          )}
          <p className="seasonp-experimental">
            Rule change, 2026-08-25: workspace owners and admins are eligible, and their trades count like any other.
            It widens who may enter and reduces nobody's standing.
          </p>
          <p className="seasonp-experimental">
            Rule change, 2026-08-22: a prize no longer requires a positive score; place alone decides it. The change
            only increases what is paid.
          </p>
        </details>
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
          {season.payoutMode === 'proportional' ? (
            /* No rungs to draw: the payout curve IS the standings. The one
               number worth stating beside the pool is the dust floor, so
               nobody wonders why a $0.40 share was not paid. */
            <p className="seasonp-note">
              Split in proportion to positive settled profit: twice the profit, twice the share. Losses pay nothing
              {season.minPayoutUsd > 0
                ? `, and a share under $${season.minPayoutUsd.toLocaleString()} rolls into the next season's pool`
                : ''}
              . Your projected share is in the standings below.
            </p>
          ) : (
            /* Each rung's bar length IS the prize, scaled to first place, so
              the halving ladder (500, 250, 125...) is visible as a shape
              rather than a column of numbers to compare. Monochrome bars,
              accent only on the rung being fought over. */
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
          )}
        </section>

        <section className="seasonp-block" aria-label="How it is scored">
          <h2 className="lbp-season-name">How it is scored</h2>
          <p className="seasonp-formula">season score = what resolved markets paid you - what you paid on them</p>
          {/* The one caveat the formula needs (rules amended 2026-08-28);
              everything else lives in the rules doc, per the 2026-08-19
              direction that this section is the formula and the link. */}
          <p className="seasonp-note">
            open positions are marked on the board but score nothing until their market resolves
          </p>
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
            <SeasonTable
              rows={rows}
              season={season}
              mode={draft ? 'draft' : settled ? 'settled' : 'running'}
              meId={meId}
              pinned={meId && !rows.some(r => r.id === meId) ? myStanding : null}
            />
          )}
        </section>
      </main>
    </div>
  );
}
