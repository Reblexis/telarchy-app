import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, type MySeasonEntry, type PrizeSeason } from '../lib/api';
import { authPath } from '../lib/nextPath';

/**
 * Entering a prize season, on a public page.
 *
 * Entry used to live only on `/account`, which is the console: a visitor who
 * read about the season on the floor was sent into an interior surface they
 * have no reason to be in, and the admin's own UI at that. Owner direction
 * 2026-08-19: it is a button, where the season is announced.
 *
 * What stands between a visitor and being entered:
 *
 *   not signed in  ──►  sign up            (the season needs an identity to score)
 *   no contact     ──►  an email field     (where a winner is told they won)
 *   under 18       ──►  the age checkbox   (the rules have always required it)
 *   not agreed     ──►  the rules checkbox (recorded, not just ticked)
 *
 * The email is asked for rather than read off the account because a
 * participant registered through the API has none: only browser signups create
 * an auth user. For a browser user it is prefilled, so the common case is
 * still one glance and a click.
 *
 * NO payment details. That gate existed for part of one day (2026-08-19, owner
 * direction both ways): a visitor arriving cold should be one click in, and
 * winners are asked for details at claim time, when there is money waiting and
 * the ask is easy.
 *
 * The server enforces the rules agreement independently; this is the courtesy
 * version. An API participant hitting PUT /api/seasons/me gets the same
 * refusal with a machine-readable `reason`.
 */
export function SeasonEntryButton({ season, signedIn }: { season: PrizeSeason; signedIn: boolean }) {
  const location = useLocation();
  const [entry, setEntry] = useState<MySeasonEntry | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [over18, setOver18] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!signedIn) return;
    api
      .getMySeason()
      .then(e => {
        setEntry(e);
        // Someone who agreed in an earlier session is not asked twice.
        if (e.rulesAcceptedAt) setAgreed(true);
        if (e.confirmedOver18At) setOver18(true);
        // Prefill: their season email if they gave one, else the account's, so
        // a browser user does not retype what we already know.
        setEmail(prev => prev || e.contactEmail || e.accountEmail || '');
      })
      .catch(e => console.error('season entry fetch failed:', e));
  }, [signedIn]);

  useEffect(load, [load]);

  const enter = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await api.setMySeasonEntry(next, {
        acceptedRules: agreed,
        confirmedOver18: over18,
        contactEmail: email.trim(),
      });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update your entry');
    } finally {
      setBusy(false);
    }
  };

  if (!signedIn) {
    return (
      <Link className="lbp-season-cta" to={authPath('signup', location)}>
        Sign up to enter
      </Link>
    );
  }

  if (!entry) return null;

  if (entry.optedIn) {
    return (
      <div className="season-entry">
        <p className="season-entry-in">You are in.</p>
        <button className="season-entry-leave" disabled={busy} onClick={() => void enter(false)}>
          Leave the season
        </button>
        {error && <p className="ticket-err">{error}</p>}
      </div>
    );
  }

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  return (
    <div className="season-entry">
      <label className="season-entry-field">
        <span className="season-entry-label">Email, if you win</span>
        <input
          type="email"
          className="season-entry-input"
          value={email}
          disabled={busy}
          placeholder="you@example.com"
          autoComplete="email"
          onChange={e => setEmail(e.target.value)}
        />
      </label>
      <label className="season-entry-agree">
        <input type="checkbox" checked={over18} disabled={busy} onChange={e => setOver18(e.target.checked)} />
        <span>I am 18 or older.</span>
      </label>
      <label className="season-entry-agree">
        <input type="checkbox" checked={agreed} disabled={busy} onChange={e => setAgreed(e.target.checked)} />
        <span>
          I have read and agree to the{' '}
          <a href={season.rulesUrl} target="_blank" rel="noreferrer">
            {season.name} rules
          </a>
          .
        </span>
      </label>
      <button
        className="lbp-season-cta"
        disabled={busy || !agreed || !over18 || !emailOk || !entry.canEnter}
        onClick={() => void enter(true)}
      >
        {busy ? 'Entering…' : 'Enter the season'}
      </button>
      {!entry.canEnter && <p className="season-entry-note">Entries have closed for this season.</p>}
      {error && <p className="ticket-err">{error}</p>}
    </div>
  );
}
