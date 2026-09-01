import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useEarnAvailable } from '../hooks/useEarnAvailable';
import type { FloorRef } from '../lib/agent-prompt';
import { api } from '../lib/api';
import { AccountDialog } from './AccountDialog';

/**
 * The signed-in corner of the trading floor: an avatar that opens a small
 * menu. There is no console link under it any more (owner decision
 * 2026-08-19: the old GUI is gone), so the dialog IS the account. Management no longer happens inside the popover (owner direction
 * 2026-08-10: it got too cramped); "Account settings" spawns the full
 * AccountDialog, the same dialog pattern as proposing a job. The popover
 * keeps only what a glance needs: who you are, your credits, the way in
 * to settings, and the way out.
 */

interface Participant {
  nickname: string | null;
  balance: number | null;
  /** The walled liquidity wallet: bought credits that can only ever go into
   *  market pools (docs/liquidity-purchases.md). It appeared nowhere until
   *  2026-09-01, so money someone had paid for was invisible until they were
   *  already spending it. */
  liquidityBalance: number | null;
  earnedBetting: number | null;
}

function initials(name: string | null, email: string | null): string {
  const source = (name ?? email ?? '?').trim();
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map(p => p[0])
    .join('');
  return (letters || source[0] || '?').toUpperCase();
}

function fmtCr(v: number): string {
  return v >= 10_000 ? `${Math.round(v / 1000).toLocaleString('en-US')}k` : Math.round(v).toLocaleString('en-US');
}

export function AccountMenu({
  floor = null,
  canFund = false,
}: {
  floor?: FloorRef | null;
  /** True when the viewer can put liquidity behind THIS market, which is what
   *  makes the plus worth offering to someone whose wallet is still empty. */
  canFund?: boolean;
}) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTab, setDialogTab] = useState<'profile' | 'emails'>('profile');
  const [participant, setParticipant] = useState<Participant | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const image = user?.image ?? null;

  const load = () => {
    api
      .getParticipant()
      .then(p => setParticipant(p as Participant))
      .catch(e => console.error('participant fetch failed:', e));
  };
  useEffect(load, []);
  // The balance sits beside the avatar (owner ask 2026-08-11), so it must
  // not go stale after a bet: refresh on every open, plus a slow poll.
  useEffect(() => {
    if (open) load();
  }, [open]);
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // #account opens settings directly, and #emails opens them ON the email
  // switches. Every notification email closes with "turn it off in account
  // settings"; landing the reader on the floor, or even in the dialog's
  // first section, and leaving them to hunt is the same as not linking.
  // Router-driven, for the same reason as the floor's #contract link: an
  // in-app navigation to #emails moves the hash by pushState, which fires no
  // hashchange event.
  useEffect(() => {
    if (location.hash === '#account') {
      setDialogTab('profile');
      setDialogOpen(true);
    }
    if (location.hash === '#emails') {
      setDialogTab('emails');
      setDialogOpen(true);
    }
  }, [location.hash]);

  const closeDialog = () => {
    setDialogOpen(false);
    // Drop the hash, or reopening from the avatar after closing is a no-op
    // click (the URL still says #account and nothing changed).
    if (window.location.hash === '#account' || window.location.hash === '#emails') {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    load();
  };

  // Click-away and Escape: a corner menu that traps the page is worse than
  // no menu at all.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const label = participant?.nickname || user?.name || user?.email || 'Account';
  const earned = participant?.earnedBetting ?? null;
  const earnAvailable = useEarnAvailable(!!user);
  const wallet = participant?.liquidityBalance ?? 0;
  // A funding page belongs to a market. Standing on one, that is the market;
  // anywhere else the operator door is where a floor of your own starts.
  const fundingHref = floor ? `/${floor.idOrSlug}/funding` : '/manage';

  return (
    <div className="acctmenu" ref={rootRef}>
      {participant?.balance != null && (
        // The balance is the door to the earn page (owner ask 2026-08-30):
        // one affordance, wherever the number already is, instead of a
        // banner people learn to skip. The amber figure is what this
        // account has not claimed yet and vanishes when nothing is left,
        // so it can never become permanent decoration.
        <Link className="acctmenu-credits" to="/earn" title="Your credits, and what you can still earn">
          {fmtCr(participant.balance)} cr
          {earnAvailable !== null && <span className="acctmenu-earn">+{fmtCr(earnAvailable)}</span>}
        </Link>
      )}
      {/* The wallet beside the balance, marked with the drop the market's own
        pool rows wear, because the two are not the same money: one trades,
        one can only ever go behind a market (owner ask 2026-09-01). Shown to
        anyone who holds some, and to anyone who could put some behind the
        market they are standing on, for whom the plus is the whole point. */}
      {(wallet > 0 || canFund) && (
        <Link
          className="acctmenu-wallet"
          to={fundingHref}
          aria-label={wallet > 0 ? 'Liquidity wallet, and where to buy more' : 'Buy liquidity credits'}
          title={
            wallet > 0
              ? `${Math.round(wallet).toLocaleString('en-US')} credits for market liquidity, and where to buy more`
              : 'Buy credits to put behind a market'
          }
        >
          <span className="acctmenu-drop" aria-hidden="true">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z" />
            </svg>
          </span>
          {wallet > 0 && fmtCr(wallet)}
          <span className="acctmenu-plus" aria-hidden="true">
            +
          </span>
        </Link>
      )}
      <button
        className="acctmenu-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen(o => !o)}
      >
        {image ? <img src={image} alt="" /> : <span>{initials(user?.name ?? null, user?.email ?? null)}</span>}
      </button>

      {open && (
        <div className="acctmenu-panel" role="menu">
          <div className="acctmenu-who">
            <span className="acctmenu-name">{label}</span>
            {user?.email ? (
              <span className="acctmenu-email">
                {user.email}
                {user.emailVerified === false && <span className="acctmenu-tag">unverified</span>}
              </span>
            ) : (
              <span className="acctmenu-email">no email connected</span>
            )}
          </div>

          <div className="acctmenu-stats">
            <span>
              <span className="acctmenu-stat">{participant?.balance != null ? fmtCr(participant.balance) : '–'}</span>{' '}
              cr to trade
            </span>
            <span>
              <span className={`acctmenu-stat${earned && earned > 0 ? ' is-up' : ''}`}>
                {earned != null ? `${earned > 0 ? '+' : ''}${fmtCr(earned)}` : '–'}
              </span>{' '}
              cr earned
            </span>
            {wallet > 0 && (
              <span>
                <span className="acctmenu-stat">{fmtCr(wallet)}</span> cr for liquidity
              </span>
            )}
          </div>

          {/* Management lives in the dialog: picture, username, payment
              details, Manifold import. */}
          <button
            className="acctmenu-item"
            onClick={() => {
              setDialogOpen(true);
              setOpen(false);
            }}
          >
            Account settings
          </button>

          <button className="acctmenu-item acctmenu-item--out" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      )}

      {dialogOpen && <AccountDialog onClose={closeDialog} initialTab={dialogTab} floor={floor} />}
    </div>
  );
}
