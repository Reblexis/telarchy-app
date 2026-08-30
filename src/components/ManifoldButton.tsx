import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { FloorModal } from './FloorModal';
import { ManifoldLogo } from './ManifoldLogo';

/**
 * Import your Manifold balance (owner ask 2026-08-11: make it a
 * first-class action, not buried in the account dialog). A Manifold glyph
 * beside the Discord button opens the two-step import: name your Manifold
 * account, drop the one-time code in your bio, verify. Proven calibration is
 * MATCHED in starting credits (1 mana = 1 cr, capped); the Manifold balance is
 * read, never moved, and the copy says so because "convert" reads as spending
 * their mana. Anonymous visitors are routed to sign up first (the grant needs
 * an account).
 *
 * Two shapes. `door` is the top bar's: a glyph that reveals its label on
 * hover, which works there because the bar has room to grow into. `row` is
 * the earn table's, a plain labelled button like the Google and GitHub
 * ones beside it: the reveal-on-hover version widened its cell mid-hover
 * and shoved the whole credits column sideways (owner report 2026-08-30),
 * and a bare glyph in a price list says nothing about what pressing it
 * does.
 */

export function ManifoldButton({
  signedIn,
  onRequireSignup,
  variant = 'door',
}: {
  signedIn: boolean;
  onRequireSignup: () => void;
  variant?: 'door' | 'row';
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'ask' | { code: string; username: string }>('ask');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.startManifoldImport(username);
      setStep({ code: d.code, username: d.username });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const claim = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.claimManifoldImport();
      setDone(`Imported @${d.username}: +${d.granted.toLocaleString('en-US')} cr`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setOpen(false);
    setStep('ask');
    setError('');
    setDone(null);
    setUsername('');
  };

  return (
    <>
      {variant === 'row' ? (
        <button
          type="button"
          className="earn-btn earn-btn--mf"
          onClick={() => (signedIn ? setOpen(true) : onRequireSignup())}
        >
          <ManifoldLogo size={14} color="currentColor" />
          Import
        </button>
      ) : (
        <button
          className="pubws-manifold"
          aria-label="Bring your Manifold record"
          onClick={() => (signedIn ? setOpen(true) : onRequireSignup())}
        >
          <span className="pubws-manifold-icon">
            <ManifoldLogo size={18} color="currentColor" />
          </span>
          <span className="pubws-manifold-label">Bring your Manifold record</span>
        </button>
      )}

      {open && (
        <FloorModal onClose={close} label="Bring your Manifold record">
          <div className="mfimport">
            <div className="ticket-head mfimport-head">
              <h3 className="mfimport-title">
                <ManifoldLogo size={22} /> Bring your Manifold record
              </h3>
              <button className="ticket-close" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>

            {done ? (
              <>
                <p className="mfimport-done">{done}</p>
                <button className="ticket-go is-placed" onClick={close}>
                  Done
                </button>
              </>
            ) : step === 'ask' ? (
              <>
                <p className="mfimport-lead">
                  Link an established Manifold account once for a fixed grant: at least 90 days old, not a bot, and
                  either traded in the last 60 days or with markets other people traded. Today's grant is on{' '}
                  <Link to="/earn">the earn page</Link>.
                </p>
                <label className="jobform-field">
                  <span className="ticket-label">Your Manifold username</span>
                  <input
                    className="jobform-line"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="e.g. Tumbles"
                    aria-label="Manifold username"
                  />
                </label>
                <button className="ticket-go" disabled={busy || !username.trim()} onClick={() => void start()}>
                  {busy ? 'Checking…' : 'Next'}
                </button>
              </>
            ) : (
              <>
                <p className="mfimport-lead">
                  Add <code>{step.code}</code> anywhere in @{step.username}&rsquo;s bio on manifold.markets, then
                  verify. You can remove it right after.
                </p>
                <button className="ticket-go" disabled={busy} onClick={() => void claim()}>
                  {busy ? 'Verifying…' : 'Verify and import'}
                </button>
              </>
            )}
            {error && <p className="ticket-err">{error}</p>}
          </div>
        </FloorModal>
      )}
    </>
  );
}
