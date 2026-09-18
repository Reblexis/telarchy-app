import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { FloorModal } from './FloorModal';
import { CreditsHero } from './OwnerDialogs';

/**
 * The send ticket (docs/ui-conventions.md, "The participant profile",
 * Sending credits): credits from the viewer's tradeable balance to the
 * participant whose profile they are on. A transfer cannot be taken back
 * and counts as a loss in a running season, so the ticket states both and
 * sends only on a second press that names the amount and the person.
 */

const QUICK = [100, 500, 1000];
const UNCERTAIN = 'The result is uncertain. Check your transfers before sending again.';

function fmt(v: number): string {
  return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

/** The typed amount as credits, or 0 for anything that is not a positive number. */
function parseAmount(raw: string): number {
  const n = Number(raw.replace(/,/g, '').trim());
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function SendCreditsTicket({
  to,
  onClose,
  onSent,
}: {
  /** The recipient: the id the transfer is addressed to, the handle shown. */
  to: { id: string; handle: string };
  onClose: () => void;
  onSent: (amount: number) => void;
}) {
  // The tradeable balance only. The liquidity wallet cannot be transferred
  // (docs/liquidity-purchases.md), so it is never read here.
  const [balance, setBalance] = useState<number | null>(null);
  // The running season's name, when the sender is in it: a send is a loss there.
  const [seasonName, setSeasonName] = useState<string | null>(null);
  const [raw, setRaw] = useState('');
  const [memo, setMemo] = useState('');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [uncertain, setUncertain] = useState(false);
  // A ref, not the busy state: two presses in one tick both see busy false.
  const lock = useRef(false);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    api
      .getParticipant()
      .then(p => {
        if (live.current) setBalance((p as { balance: number | null }).balance ?? 0);
      })
      .catch(e => {
        console.error('participant fetch failed:', e);
        if (live.current) setErr('Your balance could not be read. Close this and try again.');
      });
    api
      .getMySeason()
      .then(s => {
        if (live.current && s.season?.status === 'running' && s.optedIn) setSeasonName(s.season.name);
      })
      .catch(e => console.error('season fetch failed:', e));
    return () => {
      live.current = false;
    };
  }, []);

  const n = parseAmount(raw);
  const over = balance !== null && n > balance;
  const canSend = balance !== null && n > 0 && !over && !busy && !uncertain;

  const setAmount = (v: string) => {
    setRaw(v);
    setArmed(false);
    setErr('');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSend || lock.current) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    lock.current = true;
    setBusy(true);
    setErr('');
    try {
      await api.transferCredits(to.id, n, memo.trim() || undefined);
      if (live.current) onSent(n);
    } catch (e) {
      if (!live.current) return;
      // A 4xx is the server saying no: nothing moved. Anything else (no
      // reply, a 5xx) may have moved the credits, so it is never retried here.
      const status = (e as { status?: number }).status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        setErr((e as Error).message);
      } else {
        console.error('transfer result unknown:', e);
        setUncertain(true);
      }
      setArmed(false);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  };

  const alert = uncertain ? UNCERTAIN : over ? `You have ${fmt(balance ?? 0)} cr. Send that or less.` : err;

  return (
    <FloorModal onClose={onClose} label="Send credits">
      <form className="jobform" onSubmit={submit}>
        <CreditsHero
          label={`Send to ${to.handle}`}
          value={raw}
          onChange={setAmount}
          disabled={busy}
          ariaLabel="Amount in credits"
          onClose={onClose}
          decimals
          autoFocus
        />
        <div className="ticket-pos-head">
          {QUICK.map(q => (
            <button key={q} type="button" className="ticket-sell" onClick={() => setAmount(String(q))}>
              {fmt(q)}
            </button>
          ))}
          <button
            type="button"
            className="ticket-sell"
            disabled={balance === null}
            onClick={() => setAmount(String(balance ?? 0))}
          >
            All
          </button>
        </div>

        <label className="jobform-field">
          <span className="ticket-label">Note, shown on both profiles</span>
          <input
            id="send-credits-note"
            className="jobform-line"
            maxLength={200}
            aria-label="Note"
            disabled={busy}
            value={memo}
            onChange={e => setMemo(e.target.value)}
          />
        </label>

        <div className="ticket-facts">
          <div className="ticket-fact">
            <span className="ticket-fact-k">Your balance after</span>
            <span className="ticket-fact-v" data-testid="send-balance-after">
              {balance === null ? '…' : `${fmt(Math.max(balance - n, 0))} cr`}
            </span>
          </div>
          {seasonName && (
            <div className="ticket-fact">
              <span className="ticket-fact-k">Your {seasonName} score</span>
              <span className={`ticket-fact-v${n > 0 ? ' is-down' : ''}`} data-testid="send-season-cost">
                {n > 0 ? `-${fmt(n)}` : '0'}
              </span>
            </div>
          )}
        </div>

        {alert && (
          <p className="ticket-err" role="alert">
            {alert}
          </p>
        )}
        <button type="submit" className="ticket-go" data-testid="send-credits-submit" disabled={!canSend}>
          {busy
            ? 'Sending…'
            : armed
              ? `Confirm: ${fmt(n)} cr to ${to.handle}`
              : n > 0 && !over
                ? `Send ${fmt(n)} cr`
                : 'Send'}
          <span className="ticket-go-sub">Sent credits cannot be taken back.</span>
        </button>
      </form>
    </FloorModal>
  );
}
