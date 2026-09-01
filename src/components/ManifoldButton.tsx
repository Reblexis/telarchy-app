import { type ReactNode, useState } from 'react';
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

/** What a provider needs the dialog to know (docs/record-links.md). The
 *  server owns the rules; this is only what a reader is shown. */
export interface LinkProvider {
  key: string;
  label: string;
  /** Where the code goes, in the provider's own word for it. */
  proofField: string;
  /** The provider's mark, when there is one to draw. */
  logo?: (size: number) => ReactNode;
  /** Where the account's profile lives, for the link in the code step. */
  profileUrl?: (handle: string) => string;
  placeholder: string;
}

export const MANIFOLD: LinkProvider = {
  key: 'manifold',
  label: 'Manifold',
  proofField: 'bio',
  logo: size => <ManifoldLogo size={size} color="currentColor" />,
  profileUrl: h => `https://manifold.markets/${h}`,
  placeholder: 'e.g. Tumbles',
};

export const POLYMARKET: LinkProvider = {
  key: 'polymarket',
  label: 'Polymarket',
  proofField: 'bio',
  profileUrl: h => `https://polymarket.com/@${h}`,
  placeholder: 'e.g. crypto-basenji',
};

export function ManifoldButton({
  signedIn,
  onRequireSignup,
  variant = 'door',
  provider = MANIFOLD,
}: {
  signedIn: boolean;
  onRequireSignup: () => void;
  variant?: 'door' | 'row';
  provider?: LinkProvider;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'ask' | { code: string; username: string }>('ask');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.startRecordLink(provider.key, username);
      setStep({ code: d.code, username: d.handle });
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
      const d = await api.claimRecordLink(provider.key);
      // A link that earned nothing is still a link. The badge is the
      // point; the grant is the bonus (docs/record-links.md).
      setDone(
        d.granted > 0
          ? `Linked @${d.handle}: +${d.granted.toLocaleString('en-US')} cr`
          : `Linked @${d.handle}. It earns nothing: ${d.why ?? 'this record does not qualify for the grant.'}`,
      );
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
    setCopied(false);
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
          {provider.logo?.(14)}
          Import
        </button>
      ) : (
        <button
          className="pubws-manifold"
          aria-label={`Bring your ${provider.label} record`}
          onClick={() => (signedIn ? setOpen(true) : onRequireSignup())}
        >
          <span className="pubws-manifold-icon">
            <ManifoldLogo size={18} color="currentColor" />
          </span>
          <span className="pubws-manifold-label">Bring your {provider.label} record</span>
        </button>
      )}

      {open && (
        <FloorModal onClose={close} label={`Bring your ${provider.label} record`}>
          <div className="mfimport">
            <div className="ticket-head mfimport-head">
              <h3 className="mfimport-title">
                {provider.logo?.(22)} Bring your {provider.label} record
              </h3>
              <button className="ticket-close" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>

            {done ? (
              <>
                <p className="mfimport-done">{done}</p>
                {/* The one place this is said. It is only true once the
                    link exists, and saying it earlier (or on the earn
                    page) is noise the reader cannot act on yet. */}
                <p className="mfimport-note">
                  You can take the code out of your {provider.label} {provider.proofField} now.
                </p>
                <button className="ticket-go is-placed" onClick={close}>
                  Done
                </button>
              </>
            ) : step === 'ask' ? (
              <>
                {/* Any account can be linked; the conditions are what the
                    GRANT needs (owner ask 2026-09-01). Saying them as
                    entry requirements turned people away from a badge
                    they were entitled to. */}
                <p className="mfimport-lead">
                  Link any account you can prove is yours. To also earn credits it has to be 90 days old, not a bot, and
                  either traded in the last 60 days or have markets other people traded.{' '}
                  <Link to="/earn">What it pays</Link>.
                </p>
                <label className="jobform-field">
                  <span className="ticket-label">Your {provider.label} username</span>
                  <input
                    className="jobform-line"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder={provider.placeholder}
                    aria-label={`${provider.label} username`}
                  />
                </label>
                <button className="ticket-go" disabled={busy || !username.trim()} onClick={() => void start()}>
                  {busy ? 'Checking…' : 'Next'}
                </button>
              </>
            ) : (
              <>
                {/* One action, and the code is the subject of the screen
                    rather than a word inside a sentence (owner ask
                    2026-08-31). Copy, paste, verify. */}
                <p className="mfimport-lead">
                  Put this anywhere in @{step.username}&rsquo;s {provider.proofField} on{' '}
                  <a href={provider.profileUrl?.(step.username) ?? '#'} target="_blank" rel="noopener noreferrer">
                    {provider.label}
                  </a>
                  , then verify.
                </p>
                <div className="mfimport-code">
                  <code>{step.code}</code>
                  <button
                    type="button"
                    className="mfimport-copy"
                    onClick={() => {
                      // Clipboard is best-effort: it is blocked without a
                      // secure context, and the code is selectable anyway.
                      navigator.clipboard?.writeText(step.code).then(
                        () => setCopied(true),
                        e => console.error('clipboard write failed:', e),
                      );
                    }}
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
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
