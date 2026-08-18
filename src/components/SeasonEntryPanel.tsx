import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MySeasonEntry } from '../lib/api';
import { useSeasonClock } from '../lib/useSeasonClock';

/**
 * Entering the prize season, and claiming a prize from a settled one.
 *
 * Entry costs exactly one click. It deliberately does NOT ask for payment
 * details: a visitor arriving cold from Manifold should be able to enter before
 * they have placed a single trade, and this funnel has already lost signups to
 * a step that could have been deferred. Winners are asked for payment details
 * at claim time, when there is money waiting for them and the ask is easy.
 *
 * Renders nothing at all when there is no season, rather than an empty box
 * explaining that there is no season.
 *
 * A season that has not started yet is enterable (owner direction 2026-08-18):
 * the panel counts down to the start instant and takes the entry there and
 * then, so nobody has to be told to come back on the day.
 */
export function SeasonEntryPanel() {
  const [entry, setEntry] = useState<MySeasonEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ prizeUsd: number; claimBy: string } | null>(null);

  const load = useCallback(() => {
    api.getMySeason()
      .then(setEntry)
      .catch(e => {
        // Not user-actionable: a failed read here means the panel stays hidden,
        // which is the same as having no season. Log it, do not shout about it.
        console.error('season entry fetch failed:', e);
      });
  }, []);

  useEffect(load, [load]);

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.setMySeasonEntry(next);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your entry');
    } finally {
      setBusy(false);
    }
  };

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
    <div className="section" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{season.name}</h2>

      <p style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: '0.75rem' }}>
        ${season.poolUsd.toLocaleString()} in prizes across {season.ladder.length} places
        {top ? `, $${top.prizeUsd.toLocaleString()} for first` : ''}.
        {' '}{clock.headline}.
        {' '}Ranked on how much your marked profit grows while the season runs.{' '}
        <Link to={season.rulesUrl}>Rules</Link>.
      </p>

      {clock.entryOpen && (
        <>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={entry.optedIn}
              disabled={busy || !entry.canEnter}
              onChange={e => toggle(e.target.checked)}
            />
            Enter this season
          </label>
          <p style={{ fontSize: '0.8rem', opacity: 0.6, marginTop: '0.4rem' }}>
            Free to enter. No purchase, no stake, and your credits are never
            spent or exchanged. If you win, we will ask for payment details then.
          </p>
          {/* Said plainly, because entering early looks like it might buy an
              advantage and it does not: everyone's starting score is read at
              the same instant however early they signed up. */}
          {clock.phase === 'before' && entry.optedIn && (
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>
              You are in. Your starting score is taken when the season begins,
              the same as everyone else's, so entering early costs and gains
              nothing but the reminder.
            </p>
          )}
          {!entry.canEnter && (
            <p style={{ fontSize: '0.8rem', opacity: 0.6 }}>Entries have closed for this season.</p>
          )}
        </>
      )}

      {season.status === 'settled' && !claimed && (
        <button type="button" disabled={busy} onClick={() => claim(season.id)}>
          Claim my prize
        </button>
      )}

      {claimed && (
        <p style={{ fontSize: '0.85rem' }}>
          Claimed ${claimed.prizeUsd.toLocaleString()}. Payment is sent directly
          to the details on your account.
        </p>
      )}

      {error && <p className="error" style={{ fontSize: '0.85rem', marginTop: '0.5rem' }}>{error}</p>}
    </div>
  );
}
