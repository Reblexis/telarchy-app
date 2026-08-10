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
  payoutHandle: string | null;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);
  // Username (nickname) editing, in place: the account is managed through
  // this dialog for public traders (owner direction 2026-08-10).
  const [nickEditing, setNickEditing] = useState(false);
  const [nickValue, setNickValue] = useState('');
  // The Manifold import: a two-step inline flow (name the account, put the
  // code in its bio, verify). null = closed; 'ask' = username field;
  // otherwise the pending code to verify against.
  const [manifold, setManifold] = useState<null | 'ask' | { code: string; username: string }>(null);
  const [manifoldName, setManifoldName] = useState('');
  const [manifoldMsg, setManifoldMsg] = useState('');
  // Payment details (owner decision 2026-08-10): where job money goes
  // lives on the account, and this menu is where a public trader edits it.
  const [payoutEditing, setPayoutEditing] = useState(false);
  const [payoutValue, setPayoutValue] = useState('');
  const rootRef = useRef<HTMLDivElement | null>(null);

  const image = savedImage ?? user?.image ?? null;

  const load = () => {
    api.getParticipant()
      .then(p => setParticipant(p as Participant))
      .catch(e => console.error('participant fetch failed:', e));
  };
  useEffect(load, []);

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

  // The picture is a file pick, not a URL paste (owner direction
  // 2026-08-10): the chosen image is resized to a 256px square on a canvas
  // client-side and stored as a small data URL, since the stack has no
  // blob store. Picking IS saving; no second step.
  const pickPicture = async (file: File) => {
    setError('');
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            const SIZE = 256;
            const canvas = document.createElement('canvas');
            canvas.width = SIZE; canvas.height = SIZE;
            const ctx = canvas.getContext('2d');
            if (!ctx) { reject(new Error('Your browser blocked image processing')); return; }
            // Cover-crop the shorter side so faces stay centered.
            const side = Math.min(img.width, img.height);
            ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
          } finally { URL.revokeObjectURL(url); }
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file does not look like an image')); };
        img.src = url;
      });
      await api.upsertProfile({ image: dataUrl });
      setSavedImage(dataUrl);
    } catch (e) {
      setError((e as Error).message || 'Could not save that picture');
    } finally {
      setBusy(false);
    }
  };

  const saveNickname = async () => {
    setError('');
    setBusy(true);
    try {
      await api.upsertProfile({ nickname: nickValue.trim() });
      setParticipant(p => (p ? { ...p, nickname: nickValue.trim() } : p));
      setNickEditing(false);
    } catch (e) {
      setError((e as Error).message || 'Could not change the username');
    } finally {
      setBusy(false);
    }
  };

  const label = participant?.nickname || user?.name || user?.email || 'Account';
  const earned = participant?.earnedBetting ?? null;

  const savePayout = async () => {
    setError('');
    setBusy(true);
    try {
      const next = payoutValue.trim();
      await api.upsertProfile({ payoutHandle: next || null });
      setParticipant(p => (p ? { ...p, payoutHandle: next || null } : p));
      setPayoutEditing(false);
    } catch (e) {
      setError((e as Error).message || 'Could not save payment details');
    } finally {
      setBusy(false);
    }
  };

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

          {/* Picking a file IS setting the picture: the OS picker opens,
              the image is resized client-side, and the avatar updates.
              No URL pasting, no second step (owner direction 2026-08-10). */}
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) void pickPicture(f);
              e.target.value = '';
            }}
          />
          <button className="acctmenu-item" disabled={busy} onClick={() => fileRef.current?.click()}>
            {busy ? 'Saving…' : image ? 'Change picture' : 'Set a picture'}
          </button>
          {/* A failed pick has no editor panel of its own to report into. */}
          {error && !nickEditing && !payoutEditing && manifold === null && (
            <p className="acctmenu-err">{error}</p>
          )}

          {nickEditing ? (
            <div className="acctmenu-edit">
              <input
                value={nickValue}
                onChange={e => setNickValue(e.target.value)}
                placeholder="your-username"
                maxLength={30}
                aria-label="Username"
              />
              <div className="acctmenu-edit-row">
                <button className="acctmenu-save" disabled={busy || !nickValue.trim()} onClick={() => void saveNickname()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button className="acctmenu-item" onClick={() => { setNickEditing(false); setError(''); }}>
                  Cancel
                </button>
              </div>
              {error && <p className="acctmenu-err">{error}</p>}
            </div>
          ) : (
            <button
              className="acctmenu-item"
              onClick={() => { setNickValue(participant?.nickname ?? ''); setNickEditing(true); setError(''); }}
            >
              {participant?.nickname ? 'Change username' : 'Set a username'}
            </button>
          )}

          {/* Where job money goes: a paid job needs this set before it can
              go on the ballot; the job dialog prefills from here. */}
          {payoutEditing ? (
            <div className="acctmenu-edit">
              <input
                value={payoutValue}
                onChange={e => setPayoutValue(e.target.value)}
                placeholder="PayPal email, IBAN, or crypto address"
                maxLength={200}
                aria-label="Payment details"
              />
              <div className="acctmenu-edit-row">
                <button className="acctmenu-save" disabled={busy} onClick={() => void savePayout()}>
                  {busy ? 'Saving…' : 'Save'}
                </button>
                <button className="acctmenu-item" onClick={() => { setPayoutEditing(false); setError(''); }}>
                  Cancel
                </button>
              </div>
              {error && <p className="acctmenu-err">{error}</p>}
            </div>
          ) : (
            <button
              className="acctmenu-item"
              onClick={() => { setPayoutValue(participant?.payoutHandle ?? ''); setPayoutEditing(true); setError(''); }}
            >
              {participant?.payoutHandle ? 'Payment details' : 'Set payment details'}
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
              {/* Every step answers where it failed, right where it failed:
                  an unknown handle, a Manifold outage, an already-claimed
                  account each say so here, and the input stays for a fix. */}
              {error && <p className="acctmenu-err">{error}</p>}
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
              {/* The bio-not-yet message names the exact code to add and
                  says the edit can lag a minute; verify again stays live. */}
              {error && <p className="acctmenu-err">{error}</p>}
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
