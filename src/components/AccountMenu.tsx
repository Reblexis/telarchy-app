import { hasAlphaAccess } from '../lib/alpha';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { AccountDialog } from './AccountDialog';

/**
 * The signed-in corner of the trading floor: an avatar that opens a small
 * menu. Management no longer happens inside the popover (owner direction
 * 2026-08-10: it got too cramped); "Account settings" spawns the full
 * AccountDialog, the same dialog pattern as proposing a job. The popover
 * keeps only what a glance needs: who you are, your credits, the way in
 * to settings, and the way out.
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
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const image = user?.image ?? null;

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

  const label = participant?.nickname || user?.name || user?.email || 'Account';
  const earned = participant?.earnedBetting ?? null;

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

          {/* Management lives in the dialog: picture, username, payment
              details, Manifold import. */}
          <button className="acctmenu-item" onClick={() => { setDialogOpen(true); setOpen(false); }}>
            Account settings
          </button>

          {/* The console is behind the alpha wall; a public trader's whole
              account IS the settings dialog until it opens. */}
          {hasAlphaAccess() && <a className="acctmenu-item" href="/account">Console</a>}
          <button className="acctmenu-item acctmenu-item--out" onClick={() => void logout()}>Log out</button>
        </div>
      )}

      {dialogOpen && <AccountDialog onClose={() => { setDialogOpen(false); load(); }} />}
    </div>
  );
}
