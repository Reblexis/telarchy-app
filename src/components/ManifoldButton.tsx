import { useState } from 'react';
import { FloorModal } from './FloorModal';

/**
 * Import your Manifold balance (owner ask 2026-08-11: make it a
 * first-class action, not buried in the account dialog). A Manifold glyph
 * beside the Discord button opens the two-step import: name your Manifold
 * account, drop the one-time code in your bio, verify. Proven calibration
 * converts to starting credits (1 mana = 1 cr, capped). Anonymous
 * visitors are routed to sign up first (the grant needs an account).
 */

function ManifoldMark({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor" />
      <path d="M6 15l3-6 3 4 2-3 4 5" stroke="var(--bg-primary)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ManifoldButton({ signedIn, onRequireSignup }: { signedIn: boolean; onRequireSignup: () => void }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'ask' | { code: string; username: string }>('ask');
  const [username, setUsername] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/import/manifold/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start');
      setStep({ code: d.code, username: d.username });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const claim = async () => {
    setBusy(true); setError('');
    try {
      const r = await fetch('/api/import/manifold/claim', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not verify');
      setDone(`Imported @${d.username}: +${d.granted.toLocaleString('en-US')} cr`);
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const close = () => { setOpen(false); setStep('ask'); setError(''); setDone(null); setUsername(''); };

  return (
    <>
      <button
        className="pubws-manifold"
        aria-label="Import your Manifold balance"
        onClick={() => (signedIn ? setOpen(true) : onRequireSignup())}
      >
        <span className="pubws-manifold-icon"><ManifoldMark /></span>
        <span className="pubws-manifold-label">Import Manifold</span>
      </button>

      {open && (
        <FloorModal onClose={close} label="Import Manifold balance">
          <div className="mfimport">
            <div className="ticket-head mfimport-head">
              <h3 className="mfimport-title"><ManifoldMark size={22} /> Import your Manifold balance</h3>
              <button className="ticket-close" aria-label="Close" onClick={close}>×</button>
            </div>

            {done ? (
              <>
                <p className="mfimport-done">{done}</p>
                <button className="ticket-go is-placed" onClick={close}>Done</button>
              </>
            ) : step === 'ask' ? (
              <>
                <p className="mfimport-lead">
                  A proven Manifold record starts you with real weight here: your net worth
                  converts one mana to one credit, up to 100,000, once.
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
                  Add <code>{step.code}</code> anywhere in @{step.username}&rsquo;s bio on
                  manifold.markets, then verify. You can remove it right after.
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
