import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MySeasonEntry } from '../lib/api';
import { useSeasonClock } from '../lib/useSeasonClock';

/**
 * The prize season as it appears inside the account dialog: what the season
 * is, whether you are in it, and the claim button once it has settled
 * (owner decision 2026-08-19: the console page this used to sit on is gone,
 * so it speaks the dialog's ticket language like everything else there).
 *
 * Renders nothing at all when there is no season, rather than an empty box
 * explaining that there is no season.
 *
 * Entering happens elsewhere (SeasonEntryButton on the floor rail and the
 * public leaderboard, owner direction 2026-08-19), so this panel only
 * reports where you stand and pays out. A season that has not started yet
 * still shows, counting down to its start instant, because entry is already
 * open by then.
 */
export function SeasonEntryPanel() {
  const [entry, setEntry] = useState<MySeasonEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ prizeUsd: number; claimBy: string } | null>(null);

  const load = useCallback(() => {
    api
      .getMySeason()
      .then(setEntry)
      .catch(e => {
        // Not user-actionable: a failed read here means the panel stays hidden,
        // which is the same as having no season. Log it, do not shout about it.
        console.error('season entry fetch failed:', e);
      });
  }, []);

  useEffect(load, [load]);

  const claim = async (seasonId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.claimSeasonPrize(seasonId);
      setClaimed({ prizeUsd: res.prizeUsd, claimBy: res.claimBy });
    } catch (e) {
      // These ARE user-actionable: "add payment details", "the window closed".
      setError(e instanceof Error ? e.message : 'Could not claim your prize');
    } finally {
      setBusy(false);
    }
  };

  // The hook runs before the early return, because hooks must: bailing out
  // above it would change the hook order between renders.
  const season = entry?.season ?? null;
  const clock = useSeasonClock(season);
  if (!entry || !season || !clock) return null;

  const top = season.ladder.find(r => r.place === 1);

  return (
    <div className="jobform-field">
      <span className="ticket-label">{season.name}</span>

      <p className="acctdlg-hint">
        ${season.poolUsd.toLocaleString()} in prizes across {season.ladder.length} places
        {top ? `, $${top.prizeUsd.toLocaleString()} for first` : ''}. {clock.headline}. Ranked on how much your marked
        profit grows while the season runs. <Link to={season.rulesUrl}>Rules</Link>.
      </p>

      {/* No entry toggle here. Entering moved to SeasonEntryButton on the
          public surfaces (owner direction 2026-08-19): the floor rail and the
          public leaderboard, where the season is actually announced. This
          panel is the claim path, which only a winner walks and which needs
          the account context it already sits in. */}
      {clock.entryOpen && !entry.optedIn && (
        <p className="acctdlg-hint">
          You have not entered. The entry button is on the <Link to="/leaderboard">leaderboard</Link>.
        </p>
      )}
      {entry.optedIn && <p className="acctdlg-hint">You are entered.</p>}

      {season.status === 'settled' && !claimed && (
        <button type="button" className="acctdlg-ghost" disabled={busy} onClick={() => claim(season.id)}>
          Claim my prize
        </button>
      )}

      {claimed && (
        <p className="acctdlg-ok">
          Claimed ${claimed.prizeUsd.toLocaleString()}. Payment is sent directly to the details on your account.
        </p>
      )}

      {error && <p className="ticket-err">{error}</p>}
    </div>
  );
}
