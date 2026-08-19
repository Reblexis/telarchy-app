import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type LeaderboardEntry, type PrizeSeason, type PublicContractor } from '../lib/api';
import { useSeasonClock } from '../lib/useSeasonClock';
import { pickCurrentSeason } from '../lib/season-clock';
import { useAuth } from '../hooks/useAuth';
import { useMyParticipantId } from '../hooks/useMyParticipantId';
import { TopBar } from './TradePage';
import { ManifoldLogo } from '../components/ManifoldLogo';

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
  const clock = useSeasonClock(season);
  const meId = useMyParticipantId(!!user);

  useEffect(() => {
    let cancelled = false;
    api.getSeasons()
      .then(r => { if (!cancelled) setSeason(pickCurrentSeason(r.seasons)); })
      .catch(e => console.error('seasons fetch failed:', e));
    api.getLeaderboard(200)
      .then(r => { if (!cancelled) setTraders((r.participants ?? []).filter(e => e.totalTrades > 0)); })
      .catch(e => { console.error('leaderboard fetch failed:', e); if (!cancelled) setTraders([]); });
    // Contractors are a per-market list; the public markets are few, so the
    // page unions them and ranks by priced impact. A workspace that exposes
    // no board simply contributes nobody.
    api.getPublicWorkspaces()
      .then(async list => {
        const rows = await Promise.all((list ?? []).map(w =>
          api.getMarketplaceWorkspace(w.slug || w.workspaceId)
            .then(ws => (ws.topContractors ?? []))
            .catch(() => [])));
        if (cancelled) return;
        const merged = new Map<string, PublicContractor>();
        for (const c of rows.flat()) {
          const prev = merged.get(c.id);
          // Someone posting on two markets counts once, with their work summed.
          if (!prev) { merged.set(c.id, { ...c }); continue; }
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
      .catch(e => { console.error('contractors fetch failed:', e); if (!cancelled) setContractors([]); });
    return () => { cancelled = true; };
  }, []);

  const pinned = meId && traders && !traders.some(e => e.id === meId)
    ? traders.find(e => e.id === meId) ?? null
    : null;

  /**
   * One row, used by the list and by the pinned "you" row underneath it, so
   * the two cannot drift into showing different things about the same person.
   */
  function row(e: LeaderboardEntry, rank: number, isPinned = false) {
    const name = e.nickname || 'anonymous';
    const acc = accuracyLabel(e);
    const mine = e.id === meId;
    return (
      <li key={`${isPinned ? 'pin-' : ''}${e.id}`} className={`lbp-row${mine ? ' is-me' : ''}${isPinned ? ' is-pinned' : ''}`}>
        <span className="lbp-rank">{rank || '—'}</span>
        <a className="lbp-who" href={`/participants/${encodeURIComponent(e.nickname ?? e.id)}`}>
          <span className="lbp-avatar">
            {e.image ? <img src={e.image} alt="" /> : <span>{initialOf(name)}</span>}
          </span>
          <span className="lbp-stack">
            <span className="lbp-name">
              {name}
              {mine && <span className="lbp-you">you</span>}
              {e.manifoldUsername && (
                <span className="lbp-manifold" title={`Imported from Manifold: @${e.manifoldUsername}`}>
                  <ManifoldLogo size={12} strokeWidth={1.6} />
                </span>
              )}
            </span>
            <span className="lbp-sub">
              {e.totalTrades.toLocaleString('en-US')} {e.totalTrades === 1 ? 'trade' : 'trades'}
              {e.resolvedMarkets > 0 && ` · ${e.resolvedMarkets} settled`}
              {acc && ` · ${acc}`}
            </span>
          </span>
        </a>
        {/* What the season would pay this person if it settled now. Only for
            entrants, and only once the season is running: before it starts
            there are no baselines, so there is nothing to project and a "$0"
            would read as "wins nothing" rather than "not decided yet". */}
        {e.seasonEntered && (
          e.seasonPrizeUsd === null || e.seasonPrizeUsd === undefined ? (
            <span className="lbp-prize lbp-prize--in" title="Entered the season">entered</span>
          ) : e.seasonPrizeUsd > 0 ? (
            <span className="lbp-prize" title="What this season would pay at the current standing">
              ${e.seasonPrizeUsd.toLocaleString()}
            </span>
          ) : (
            <span className="lbp-prize lbp-prize--in" title="Entered the season, currently outside the prizes">entered</span>
          )
        )}
        <span className={`lbp-score${Math.round(e.totalEarnings) > 0 ? ' is-up' : Math.round(e.totalEarnings) < 0 ? ' is-down' : ''}`}>
          {signed(e.totalEarnings)} cr
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
          Everyone trading the public markets, ranked by profit in credits:
          settled bets plus what open positions are worth right now.
        </p>

        {/* One line and a link. The pool, the ladder, the scoring rules and
            the entry flow live on /season (owner direction 2026-08-19); this
            page is the all-time board, and the competition was crowding it. */}
        {season && clock && (
          <p className="lbp-season-line-only">
            <strong>{season.name}</strong>: ${season.poolUsd.toLocaleString()} in prizes,{' '}
            {clock.phase === 'settled' ? 'final standings' : clock.headline.toLowerCase()}.{' '}
            <Link to="/season">{clock.entryOpen ? 'Enter the season' : 'See the season'}</Link>
          </p>
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
            What the market says each poster's live contracts are worth: the
            gap between approving and declining, summed.
          </p>
          {contractors === null ? null : contractors.length === 0 ? (
            <p className="lbp-empty">No contracts on the board yet. Offer one and the market prices what it is worth.</p>
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
                    <a className="lbp-who" href={`/participants/${encodeURIComponent(c.id)}`}>
                      <span className="lbp-avatar"><span>{initialOf(name)}</span></span>
                      <span className="lbp-stack">
                        <span className="lbp-name">{name}</span>
                        <span className="lbp-sub">{parts.join(' · ') || 'no contracts priced yet'}</span>
                      </span>
                    </a>
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
