import { useCallback, useEffect, useState } from 'react';
import { api, type MySeasonEntry, type PrizeSeason } from '../lib/api';
import { AccountDialog } from './AccountDialog';

/**
 * Entering a prize season, on a public page.
 *
 * Entry used to live only on `/account`, which is the console: a visitor who
 * read about the season on the floor was sent into an interior surface they
 * have no reason to be in, and the admin's own UI at that. Owner direction
 * 2026-08-19: it is a button, where the season is announced.
 *
 * Three things stand between a visitor and being entered, and this shows
 * exactly the one that is missing rather than failing and then explaining:
 *
 *   not signed in  ──►  sign up            (the season needs an identity to score)
 *   no payment     ──►  AccountDialog      (owner direction: details up front)
 *   not agreed     ──►  the rules checkbox (recorded, not just ticked)
 *
 * The server enforces all three independently; this is the courtesy version.
 * An API participant hitting PUT /api/seasons/me gets the same refusals with a
 * machine-readable `reason`.
 */
export function SeasonEntryButton({ season, signedIn }: { season: PrizeSeason; signedIn: boolean }) {
  const [entry, setEntry] = useState<MySeasonEntry | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payoutOpen, setPayoutOpen] = useState(false);

  const load = useCallback(() => {
    if (!signedIn) return;
    api.getMySeason()
      .then(e => {
        setEntry(e);
        // Someone who agreed in an earlier session is not asked twice.
        if (e.rulesAcceptedAt) setAgreed(true);
      })
      .catch(e => console.error('season entry fetch failed:', e));
  }, [signedIn]);

  useEffect(load, [load]);

  const enter = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.setMySeasonEntry(next, { acceptedRules: agreed });
      load();
    } catch (e) {
      const reason = (e as Error & { reason?: string }).reason;
      // A missing payout method is not an error to read, it is a step to take.
      if (reason === 'payout') { setPayoutOpen(true); setBusy(false); return; }
      setError(e instanceof Error ? e.message : 'Could not update your entry');
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <a className="lbp-season-cta" href="/signup">Sign up to enter</a>
    );
  }

  if (!entry) return null;

  if (entry.optedIn) {
    return (
      <div className="season-entry">
        <p className="season-entry-in">You are in.</p>
        <p className="season-entry-note">
          Your starting score is taken when the season begins, the same as
          everyone else&rsquo;s, so entering early costs and gains nothing.
        </p>
        <button className="season-entry-leave" disabled={busy} onClick={() => void enter(false)}>
          Leave the season
        </button>
        {error && <p className="ticket-err">{error}</p>}
      </div>
    );
  }

  return (
    <div className="season-entry">
      <label className="season-entry-agree">
        <input
          type="checkbox"
          checked={agreed}
          disabled={busy}
          onChange={e => setAgreed(e.target.checked)}
        />
        <span>
          I have read and agree to the{' '}
          <a href={season.rulesUrl} target="_blank" rel="noreferrer">{season.name} rules</a>.
        </span>
      </label>
      <button
        className="lbp-season-cta"
        disabled={busy || !agreed || !entry.canEnter}
        onClick={() => void enter(true)}
      >
        {busy ? 'Entering…' : 'Enter the season'}
      </button>
      <p className="season-entry-note">
        Free to enter: no purchase, no stake, and your credits are never spent
        or exchanged. Payment details are needed up front so a prize can reach
        you.
      </p>
      {!entry.canEnter && <p className="season-entry-note">Entries have closed for this season.</p>}
      {error && <p className="ticket-err">{error}</p>}
      {/* Opened when the server says payment details are missing, so the fix
          happens here instead of sending someone to a settings page and
          hoping they come back. */}
      {payoutOpen && <AccountDialog onClose={() => { setPayoutOpen(false); load(); }} />}
    </div>
  );
}
