import { hasAlphaAccess } from '../lib/alpha';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';

/**
 * The signed-in corner of the trading floor: an avatar that opens the small
 * set of things a trader actually needs here (owner decision 2026-08-09).
 * What you earned, who you are, a picture, and the way out. Anything
 * deeper stays on /account; this is a corner menu, not a settings page.
 *
 * The picture is a URL rather than an upload: the stack has no blob store,
 * and the account row already carries the `image` field that OAuth
 * providers populate, so self-set and provider-set pictures are one field.
 */

interface Participant {
  nickname: string | null;
  balance: number | null;
  earnedBetting: number | null;
}

function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map(p => p[0]).join('');
  return (letters || source[0] || '?').toUpperCase();
}

function fmtCr(v: number): string {
  return v >= 10_000
    ? `${Math.round(v / 1000).toLocaleString('en-US')}k`
    : Math.round(v).toLocaleString('en-US');
}

export function AccountMenu() {
  // Identity comes from the session (BetterAuth already carries name, email
  // and the avatar); the money comes from the participant row.
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [participant, setParticipant] = useState<Participant | null>(null);
  // Local override so a saved picture shows immediately, before the session
  // object catches up.
  const [savedImage, setSavedImage] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The Manifold import: a two-step inline flow (name the account, put the
  // code in its bio, verify). null = closed; 'ask' = username field;
  // otherwise the pending code to verify against.
  const [manifold, setManifold] = useState<null | 'ask' | { code: string; username: string }>(null);
  const [manifoldName, setManifoldName] = useState('');
  const [manifoldMsg, setManifoldMsg] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  const image = savedImage ?? user?.image ?? null;

  const load = () => {
    api.getParticipant()
      .then(p => setParticipant(p as Participant))
      .catch(e => console.error('participant fetch failed:', e));
  };
  useEffect(load, []);
  useEffect(() => { setImageUrl(user?.image ?? ''); }, [user?.image]);

  // Click-away and Escape: a corner menu that traps the page is worse than
  // no menu at all.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const savePicture = async () => {
    setError('');
    setBusy(true);
    try {
      const next = imageUrl.trim();
      await api.upsertProfile({ image: next });
      setSavedImage(next || null);
      setEditing(false);
    } catch (e) {
      setError((e as Error).message || 'Could not save that picture');
    } finally {
      setBusy(false);
    }
  };

  const label = participant?.nickname || user?.name || user?.email || 'Account';
  const earned = participant?.earnedBetting ?? null;

  const manifoldStart = async () => {
    if (busy) return;
    setBusy(true); setError(''); setManifoldMsg('');
    try {
      const r = await fetch('/api/import/manifold/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: manifoldName }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not start');
      setManifold({ code: d.code, username: d.username });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  const manifoldClaim = async () => {
    if (busy) return;
    setBusy(true); setError(''); setManifoldMsg('');
    try {
      const r = await fetch('/api/import/manifold/claim', { method: 'POST' });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Could not verify');
      setManifoldMsg(`Imported @${d.username}: +${d.granted.toLocaleString('en-US')} cr (net worth M${d.netWorth.toLocaleString('en-US')}, cap ${d.cap.toLocaleString('en-US')})`);
      setManifold(null);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="acctmenu" ref={rootRef}>
      <button
        className="acctmenu-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen(o => !o)}
      >
        {image
          ? <img src={image} alt="" />
          : <span>{initials(user?.name ?? null, user?.email ?? null)}</span>}
      </button>

      {open && (
        <div className="acctmenu-panel" role="menu">
          <div className="acctmenu-who">
            <span className="acctmenu-name">{label}</span>
            {user?.email
              ? (
                <span className="acctmenu-email">
                  {user.email}
                  {user.emailVerified === false && <span className="acctmenu-tag">unverified</span>}
                </span>
              )
              : hasAlphaAccess()
                ? <a className="acctmenu-email acctmenu-link" href="/account">connect an email</a>
                : <span className="acctmenu-email">no email connected</span>}
          </div>

          <div className="acctmenu-stats">
            <span>
              <span className="acctmenu-stat">{participant?.balance != null ? fmtCr(participant.balance) : '–'}</span> cr to trade
            </span>
            <span>
              <span className={`acctmenu-stat${earned && earned > 0 ? ' is-up' : ''}`}>
                {earned != null ? `${earned > 0 ? '+' : ''}${fmtCr(earned)}` : '–'}
              </span> cr earned
            </span>
          </div>

          {editing ? (
            <div className="acctmenu-edit">
              <input
                value={imageUrl}
                onChange={e => setImageUrl(e.target.value)}
                placeholder="https://… image URL"
                aria-label="Profile picture URL"
              />
              <div className="acctmenu-edit-row">
                <button className="acctmenu-save" disabled={busy} onClick={() => void savePicture()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button className="acctmenu-item" onClick={() => { setEditing(false); setError(''); setImageUrl(image ?? ''); }}>
                  Cancel
                </button>
              </div>
              {error && <p className="acctmenu-err">{error}</p>}
            </div>
          ) : (
            <button className="acctmenu-item" onClick={() => setEditing(true)}>
              {image ? 'Change picture' : 'Set a picture'}
            </button>
          )}

          {/* Bring a Manifold record: proven calibration starts with more
              than the signup grant (1 mana = 1 cr, capped). Two steps, all
              inline: name the account, put the code in its bio, verify. */}
          {manifold === null && !manifoldMsg && (
            <button className="acctmenu-item" onClick={() => { setManifold('ask'); setError(''); }}>
              Import Manifold balance
            </button>
          )}
          {manifold === 'ask' && (
            <div className="acctmenu-edit">
              <input
                value={manifoldName}
                onChange={e => setManifoldName(e.target.value)}
                placeholder="your Manifold username"
                aria-label="Manifold username"
              />
              <div className="acctmenu-edit-row">
                <button className="acctmenu-save" disabled={busy || !manifoldName.trim()} onClick={() => void manifoldStart()}>
                  {busy ? 'Checking…' : 'Next'}
                </button>
                <button className="acctmenu-item" onClick={() => { setManifold(null); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}
          {manifold !== null && manifold !== 'ask' && (
            <div className="acctmenu-edit">
              <p className="acctmenu-hint">
                Add <code>{manifold.code}</code> to @{manifold.username}&rsquo;s bio on
                manifold.markets, then verify. You can remove it right after.
              </p>
              <div className="acctmenu-edit-row">
                <button className="acctmenu-save" disabled={busy} onClick={() => void manifoldClaim()}>
                  {busy ? 'Verifying…' : 'Verify'}
                </button>
                <button className="acctmenu-item" onClick={() => { setManifold(null); setError(''); }}>Cancel</button>
              </div>
            </div>
          )}
          {manifoldMsg && <p className="acctmenu-ok">{manifoldMsg}</p>}

          {/* The console is behind the alpha wall; a public trader's whole
              account IS this menu until it opens. */}
          {hasAlphaAccess() && <a className="acctmenu-item" href="/account">Account settings</a>}
          <button className="acctmenu-item acctmenu-item--out" onClick={() => void logout()}>Log out</button>
        </div>
      )}
    </div>
  );
}
