import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type MySeasonEntry } from '../lib/api';

/**
 * Entering the running prize season, and claiming a prize from a settled one.
 *
 * Entry costs exactly one click. It deliberately does NOT ask for payment
 * details: a visitor arriving cold from Manifold should be able to enter before
 * they have placed a single trade, and this funnel has already lost signups to
 * a step that could have been deferred. Winners are asked for payment details
 * at claim time, when there is money waiting for them and the ask is easy.
 *
 * Renders nothing at all when there is no season, rather than an empty box
 * explaining that there is no season.
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

  const season = entry?.season;
  if (!season) return null;

  const ends = new Date(season.endsAt);
  const daysLeft = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 86_400_000));
  const top = season.ladder.find(r => r.place === 1);

  return (
    <div className="section" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.5rem' }}>{season.name}</h2>

      <p style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: '0.75rem' }}>
        ${season.poolUsd.toLocaleString()} in prizes across {season.ladder.length} places
        {top ? `, $${top.prizeUsd.toLocaleString()} for first` : ''}.
        {season.status === 'running'
          ? ` ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`
          : ' This season has ended.'}
        {' '}Ranked on how much your marked profit grows while the season runs.{' '}
        <Link to={season.rulesUrl}>Rules</Link>.
      </p>

      {season.status === 'running' && (
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
