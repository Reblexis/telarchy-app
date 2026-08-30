import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AllTimeTable, initialOf, SeasonTable } from '../components/LeaderTables';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { api, type LeaderboardEntry, type PrizeSeason, type PublicContractor, type SeasonStanding } from '../lib/api';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { TopBar } from './TradePage';

/**
 * telarchy.com/leaderboard: the whole field, in the market pages' own
 * language (owner direction 2026-08-17). Written from scratch rather than
 * adapted from the console's leaderboard, because nothing public-facing
 * renders the console UI and that page belongs to a different design.
 *
 * Since 2026-08-28 the boards are TABLES with labeled columns
 * (components/LeaderTables.tsx, owner ask: "more like a table showing the
 * different statistics in different columns, so it's more clear what the
 * season is scoring on"): the season board leads with its settled-profit
 * column marked as the scoring key, and the all-time board splits
 * Settled / Open / Total so a marks-only leader is legible at a glance.
 */
export function LeaderPage() {
  const { user, loading: authLoading } = useAuth();
  const [traders, setTraders] = useState<LeaderboardEntry[] | null>(null);
  const [contractors, setContractors] = useState<PublicContractor[] | null>(null);
  // The prize season, on the public board. This is where the floor's "See the
  // board" link lands, so a season the floor is advertising has to be visible
  // here or the trail goes cold one click in.
  const [season, setSeason] = useState<PrizeSeason | null>(null);
  // The season's own board (owner ask 2026-08-22: /leaderboard carries a
  // separate season section, scored on the season metric), rendered above
  // the all-time board while the season runs and after it settles. Null
  // until a fetch answers; a draft season has no scores to show.
  const [seasonBoard, setSeasonBoard] = useState<SeasonStanding[] | null>(null);
  const clock = useSeasonClock(season);
  const meId = useMyParticipantId(!!user);
  const [entered, setEntered] = useState(false);

  // Public data: fetched on mount and re-fetched on the floor's own
  // fifteen-second cadence while the tab is visible, plus once on tab return.
  // Deliberately NOT keyed on the session: it used to re-run when auth
  // settled, which repainted the whole board a second after it appeared (the
  // "twitchy" of the 2026-08-21 owner report). A poll replaces rows in place
  // and a failed poll keeps the rows it has; only the very first failure
  // shows the empty state, because there is nothing older to keep.
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      // The global all-time board (owner direction: /leaderboard is the whole
      // field, ranked on lifetime profit; the season standings live on /season
      // and behind "Show full leaderboard" on a workspace floor).
      api
        .getSeasons()
        .then(r => {
          if (cancelled) return;
          const s = pickCurrentSeason(r.seasons);
          setSeason(s);
          // Scores exist once the season runs; a draft has only entries.
          if (s && s.status !== 'draft') {
            api
              .getSeasonStandings(s.id, 100)
              .then(b => {
                if (!cancelled) setSeasonBoard(b.participants ?? []);
              })
              .catch(e => console.error('season standings fetch failed:', e));
          }
        })
        .catch(e => console.error('seasons fetch failed:', e));
      api
        .getLeaderboard(200)
        .then(r => {
          if (!cancelled) setTraders((r.participants ?? []).filter(e => e.totalTrades > 0));
        })
        .catch(e => {
          console.error('leaderboard fetch failed:', e);
          if (!cancelled) setTraders(t => t ?? []);
        });
      // Contractors are a per-market list; the public markets are few, so the
      // page unions them and ranks by priced impact. A workspace that exposes
      // no board simply contributes nobody.
      api
        .getPublicWorkspaces()
        .then(async list => {
          const rows = await Promise.all(
            (list ?? []).map(w =>
              api
                .getMarketplaceWorkspace(w.slug || w.workspaceId)
                .then(ws => ws.topContractors ?? [])
                .catch(() => []),
            ),
          );
          if (cancelled) return;
          const merged = new Map<string, PublicContractor>();
          for (const c of rows.flat()) {
            const prev = merged.get(c.id);
            // Someone posting on two markets counts once, with their work summed.
            if (!prev) {
              merged.set(c.id, { ...c });
              continue;
            }
            merged.set(c.id, {
              ...prev,
              jobs: prev.jobs + c.jobs,
              pricedJobs: prev.pricedJobs + c.pricedJobs,
              pendingJobs: prev.pendingJobs + c.pendingJobs,
              earnedUsd: prev.earnedUsd + c.earnedUsd,
              impact: prev.impact === null || c.impact === null ? (prev.impact ?? c.impact) : prev.impact + c.impact,
            });
          }
          setContractors([...merged.values()].sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0)));
        })
        .catch(e => {
          console.error('contractors fetch failed:', e);
          if (!cancelled) setContractors(c => c ?? []);
        });
    };
    load();
    const tick = () => {
      if (typeof document === 'undefined' || !document.hidden) load();
    };
    const interval = setInterval(tick, 15_000);
    const onVisible = () => {
      if (!document.hidden) load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // The viewer's own entry state is the only thing on this page that belongs
  // to the session, so it is the only thing the session's arrival re-fetches.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    api
      .getMySeason()
      .then(e => {
        if (!cancelled) setEntered(e.optedIn === true);
      })
      .catch(e => console.error('season entry fetch failed:', e));
    return () => {
      cancelled = true;
    };
  }, [user]);

  const pinned =
    meId && traders && !traders.some(e => e.id === meId) ? (traders.find(e => e.id === meId) ?? null) : null;

  const seasonLive = season && season.status !== 'draft';

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">Leaderboard</h1>
        <p className="lbp-lead">
          The season board pays real money on <strong>settled profit</strong>. The all-time board ranks total profit,
          open positions included.
        </p>

        {/* One line and a link. The pool, the rules and the entry flow live on
            /season (owner direction 2026-08-19); this page is the boards, and
            the competition was crowding it. */}
        {season && clock && (
          <p className="lbp-season-line-only">
            <strong>{season.name}</strong>: ${season.poolUsd.toLocaleString()} in prizes,{' '}
            {clock.phase === 'settled' ? 'final standings' : clock.headline.toLowerCase()}.{' '}
            {/* Reads its own entry state: telling someone who entered an hour
                ago to "Enter the season" reads as the entry not having worked
                (owner report 2026-08-19). */}
            <Link to="/season">
              {entered ? 'See the season' : clock.entryOpen ? 'Enter the season' : 'See the season'}
            </Link>
          </p>
        )}

        {/* The season's own board, above the all-time field (owner ask
            2026-08-22): entrants only, on the season's scoring key. Kept
            SEPARATE from the all-time board below rather than replacing it,
            which is what the reverted season-mode tried. */}
        {seasonLive && seasonBoard && seasonBoard.length > 0 && (
          <section className="lbp-section" aria-label="Season standings">
            <h2 className="pubws-h2">{season.name} standings</h2>
            <p className="lbp-note">
              {season.payoutMode === 'proportional' ? (
                <>
                  The <strong>${season.poolUsd.toLocaleString()} pool</strong>, split in proportion to positive{' '}
                  <strong>settled profit</strong>. Open positions score nothing until they resolve.
                </>
              ) : (
                <>
                  Entrants only, ranked on <strong>settled profit</strong> inside the season window. The dollar figure
                  is what the season would pay at the current standing.
                </>
              )}
              {clock?.phase === 'settled' ? ' Now final.' : ''}
            </p>
            <SeasonTable
              rows={seasonBoard}
              season={season}
              mode={season.status === 'settled' ? 'settled' : 'running'}
              meId={meId}
            />
          </section>
        )}

        <section className="lbp-section" aria-label="Traders">
          <h2 className="pubws-h2">All-time</h2>
          <p className="lbp-note">
            Every trader, ranked on <strong>total profit</strong>: settled bets plus what open positions are worth now.
          </p>
          {traders === null ? null : traders.length === 0 ? (
            <p className="lbp-empty">Nobody has traded yet.</p>
          ) : (
            /* Pinned underneath when the visitor is not in the list above.
               A board that shows the leaders and nothing else answers "who
               is winning" but not "where am I", which is the question the
               person reading it actually has. */
            <AllTimeTable rows={traders} pinned={pinned} meId={meId} season={season} />
          )}
        </section>

        <section className="lbp-section" aria-label="Contractors">
          <h2 className="pubws-h2">Contractors</h2>
          <p className="lbp-note">What each poster's live contracts are worth: approving minus declining, summed.</p>
          {contractors === null ? null : contractors.length === 0 ? (
            <p className="lbp-empty">
              No contracts on the board yet. Offer one and the market prices what it is worth.
            </p>
          ) : (
            <table className="lbt">
              <thead>
                <tr>
                  <th className="lbt-h is-left lbt-h-rank">#</th>
                  <th className="lbt-h is-left">Contractor</th>
                  <th className="lbt-h lbt-desk">Approved</th>
                  <th className="lbt-h lbt-desk">Live</th>
                  <th className="lbt-h lbt-desk">Earned</th>
                  <th className="lbt-h">Impact ↓</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c, i) => {
                  const name = c.name || 'anonymous';
                  const scored = c.impact !== null && c.pricedJobs > 0;
                  const approved = Math.max(0, c.jobs - c.pendingJobs);
                  return (
                    <tr key={c.id}>
                      <td className="lbt-rank">{i + 1}</td>
                      <td className="lbt-cell is-left">
                        <Link className="lbt-who" to={`/participants/${encodeURIComponent(c.id)}`}>
                          <span className="lbp-avatar">
                            <span>{initialOf(name)}</span>
                          </span>
                          <span className="lbt-stack">
                            <span className="lbt-name">{name}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="lbt-num lbt-desk is-plain">{approved || '—'}</td>
                      <td className="lbt-num lbt-desk is-plain">{c.pendingJobs || '—'}</td>
                      <td className="lbt-num lbt-desk is-plain">
                        {c.earnedUsd > 0 ? `$${Math.round(c.earnedUsd).toLocaleString('en-US')}` : '—'}
                      </td>
                      {scored ? (
                        <td className={`lbt-num${c.impact! > 0 ? ' is-up' : c.impact! < 0 ? ' is-down' : ' is-zero'}`}>
                          {c.impact! > 0 ? '▲ ' : c.impact! < 0 ? '▼ ' : ''}
                          {Math.abs(Math.round(c.impact!)).toLocaleString('en-US')}
                        </td>
                      ) : (
                        <td className="lbt-num is-zero">not priced yet</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        <p className="lbp-foot">
          <Link to="/marketplace">Pick a market to trade</Link>
        </p>
      </main>
    </div>
  );
}
