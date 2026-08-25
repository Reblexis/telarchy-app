import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ManifoldLogo } from '../components/ManifoldLogo';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { api, type LeaderboardEntry, type PrizeSeason, type PublicContractor, seasonStandingToEntry } from '../lib/api';
import { pickCurrentSeason } from '../lib/season-clock';
import { useSeasonClock } from '../lib/useSeasonClock';
import { TopBar } from './TradePage';

/**
 * telarchy.com/leaderboard: the whole field, in the market pages' own
 * language (owner direction 2026-08-17). Written from scratch rather than
 * adapted from the console's leaderboard, because nothing public-facing
 * renders the console UI and that page belongs to a different design.
 *
 * The rail on a market page shows ten and links here; this page shows
 * everyone, and gives each row the numbers a visitor would otherwise have
 * to open a profile to read.
 */

function initialOf(name: string): string {
  return name.replace(/^@/, '')[0]?.toUpperCase() ?? '?';
}

function signed(n: number): string {
  // Round FIRST: a loss of a hundredth of a credit printed "-0 cr", which
  // reads as a bug rather than as a rounding.
  const r = Math.round(n);
  return `${r > 0 ? '+' : ''}${r === 0 ? 0 : r.toLocaleString('en-US')}`;
}

/** Accuracy is only meaningful once a few markets have actually settled. */
function accuracyLabel(e: LeaderboardEntry): string | null {
  if (e.accuracy === null || e.accuracy === undefined) return null;
  if (e.resolvedMarkets < 3) return null;
  return `${Math.round(e.accuracy * 100)}% accurate`;
}

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
  const [seasonBoard, setSeasonBoard] = useState<LeaderboardEntry[] | null>(null);
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
                if (!cancelled) setSeasonBoard((b.participants ?? []).map(seasonStandingToEntry));
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

  /**
   * One row, used by the list and by the pinned "you" row underneath it, so
   * the two cannot drift into showing different things about the same person.
   */
  function row(e: LeaderboardEntry, rank: number, isPinned = false, seasonRow = false) {
    const name = e.nickname || 'anonymous';
    const acc = accuracyLabel(e);
    const mine = e.id === meId;
    return (
      <li
        key={`${isPinned ? 'pin-' : ''}${e.id}`}
        className={`lbp-row${mine ? ' is-me' : ''}${isPinned ? ' is-pinned' : ''}`}
      >
        <span className="lbp-rank">{rank || '—'}</span>
        <Link className="lbp-who" to={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}>
          <span className="lbp-avatar">{e.image ? <img src={e.image} alt="" /> : <span>{initialOf(name)}</span>}</span>
          <span className="lbp-stack">
            <span className="lbp-name">
              {name}
              {e.manifoldUsername && (
                <span className="lbp-manifold" title={`Imported from Manifold: @${e.manifoldUsername}`}>
                  <ManifoldLogo size={12} strokeWidth={1.6} />
                </span>
              )}
            </span>
            {/* Lifetime trade count and accuracy are a property of the all-time
                board, not of a season standing (the season rows carry no such
                counts), so the sub-line is hidden on a season row. */}
            {!seasonRow && (
              <span className="lbp-sub">
                {e.totalTrades.toLocaleString('en-US')} {e.totalTrades === 1 ? 'trade' : 'trades'}
                {e.resolvedMarkets > 0 && ` · ${e.resolvedMarkets} settled`}
                {acc && ` · ${acc}`}
              </span>
            )}
          </span>
        </Link>
        {/* What the season would pay this person if it settled now. Only for
            entrants. Before the season starts there are no baselines and no
            rank, so there is nothing to project; painting the ladder's top
            rung ($500) on every entrant read as "this person wins $500" when
            two people were entered (owner report 2026-08-21). A neutral
            "entered" marker until the season runs; the rank-based dollar
            appears the moment a score exists to rank on. */}
        {e.seasonEntered &&
          (e.seasonPrizeUsd === null || e.seasonPrizeUsd === undefined ? (
            <span
              className="lbp-prize lbp-prize--in"
              title={`Entered ${season?.name ?? 'the season'}; prizes are set once it starts`}
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
          ))}
        <span className="lbp-scorestack">
          <span
            className={`lbp-score${Math.round(e.totalEarnings) > 0 ? ' is-up' : Math.round(e.totalEarnings) < 0 ? ' is-down' : ''}`}
          >
            {signed(e.totalEarnings)} cr
          </span>
          {/* What of that is final and what is still a mark (owner direction
              2026-08-24, docs/seasons.md "The score"). Season rows carry no
              split: a season score is a difference of two marks. */}
          {!seasonRow && e.settledEarnings !== undefined && e.openEarnings !== undefined && (
            <span
              className="lbp-split"
              title="Settled: resolutions and refunds, final. Open: what open positions are worth right now."
            >
              {signed(e.settledEarnings)} settled · {signed(e.openEarnings)} open
            </span>
          )}
        </span>
      </li>
    );
  }

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lbp">
        <h1 className="lbp-head">Leaderboard</h1>
        <p className="lbp-lead">
          Everyone trading the public markets, ranked by profit in credits: settled bets plus what open positions are
          worth right now.
        </p>

        {/* One line and a link. The pool, the ladder, the scoring rules and
            the entry flow live on /season (owner direction 2026-08-19); this
            page is the all-time board, and the competition was crowding it. */}
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
            2026-08-22): entrants only, scored on growth since the season
            started, with what the season would pay at each standing. Kept
            SEPARATE from the all-time board below rather than replacing it,
            which is what the reverted season-mode tried. */}
        {season && season.status !== 'draft' && seasonBoard && seasonBoard.length > 0 && (
          <section className="lbp-section" aria-label="Season standings">
            <h2 className="pubws-h2">{season.name} standings</h2>
            <p className="lbp-note">
              Entrants only, scored on profit growth since the season started. The dollar figure is what the season
              would pay at the current standing{clock?.phase === 'settled' ? ', now final' : ''}.
            </p>
            <ol className="lbp-list">{seasonBoard.map((e, i) => row(e, e.rank ?? i + 1, false, true))}</ol>
          </section>
        )}

        <section className="lbp-section" aria-label="Traders">
          <h2 className="pubws-h2">Traders</h2>
          {traders === null ? null : traders.length === 0 ? (
            <p className="lbp-empty">Nobody has traded yet.</p>
          ) : (
            <ol className="lbp-list">
              {traders.map((e, i) => row(e, e.rank ?? i + 1))}
              {/* Pinned underneath when the visitor is not in the list above.
                  A board that shows the leaders and nothing else answers "who
                  is winning" but not "where am I", which is the question the
                  person reading it actually has. */}
              {pinned && row(pinned, pinned.rank ?? 0, true)}
            </ol>
          )}
        </section>

        <section className="lbp-section" aria-label="Contractors">
          <h2 className="pubws-h2">Contractors</h2>
          <p className="lbp-note">
            What the market says each poster's live contracts are worth: the gap between approving and declining,
            summed.
          </p>
          {contractors === null ? null : contractors.length === 0 ? (
            <p className="lbp-empty">
              No contracts on the board yet. Offer one and the market prices what it is worth.
            </p>
          ) : (
            <ol className="lbp-list">
              {contractors.map((c, i) => {
                const name = c.name || 'anonymous';
                const scored = c.impact !== null && c.pricedJobs > 0;
                const parts: string[] = [];
                const approved = Math.max(0, c.jobs - c.pendingJobs);
                if (approved > 0) parts.push(`${approved} approved`);
                if (c.pendingJobs > 0) parts.push(`${c.pendingJobs} live`);
                if (c.earnedUsd > 0) parts.push(`$${Math.round(c.earnedUsd).toLocaleString('en-US')} earned`);
                return (
                  <li key={c.id} className="lbp-row">
                    <span className="lbp-rank">{i + 1}</span>
                    <Link className="lbp-who" to={`/participants/${encodeURIComponent(c.id)}`}>
                      <span className="lbp-avatar">
                        <span>{initialOf(name)}</span>
                      </span>
                      <span className="lbp-stack">
                        <span className="lbp-name">{name}</span>
                        <span className="lbp-sub">{parts.join(' · ') || 'no contracts priced yet'}</span>
                      </span>
                    </Link>
                    {scored ? (
                      <span className={`lbp-score${c.impact! > 0 ? ' is-up' : c.impact! < 0 ? ' is-down' : ''}`}>
                        {c.impact! > 0 ? '▲ ' : c.impact! < 0 ? '▼ ' : ''}
                        {Math.abs(Math.round(c.impact!)).toLocaleString('en-US')}
                      </span>
                    ) : (
                      <span className="lbp-score lbp-score--muted">not priced yet</span>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <p className="lbp-foot">
          <Link to="/marketplace">Pick a market to trade</Link>
        </p>
      </main>
    </div>
  );
}
