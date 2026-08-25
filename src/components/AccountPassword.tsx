import { type FormEvent, useState } from 'react';
import { authClient } from '../lib/auth-client';

/**
 * Changing the password, in the account dialog rather than on a console page
 * (owner decision 2026-08-19: the old GUI goes). Collapsed to a single link
 * until it is wanted, because most sessions open this dialog to change a
 * picture or a payout address, and two password fields sitting open read as
 * a security prompt.
 *
 * OAuth-only accounts have no password to change; the server says so and the
 * refusal lands verbatim under the fields, which is a truer answer than a
 * guess made from the client's view of the session.
 */
export function AccountPassword() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next });
    if (error) {
      setMsg({ ok: false, text: error.message || 'Could not change the password' });
    } else {
      setMsg({ ok: true, text: 'Password changed.' });
      setCurrent('');
      setNext('');
    }
    setBusy(false);
  };

  return (
    <div className="jobform-field">
      <span className="ticket-label">Password</span>
      {!open ? (
        <button className="acctdlg-ghost" onClick={() => setOpen(true)}>
          Change password
        </button>
      ) : (
        <form className="acctdlg-inline acctdlg-inline--col" onSubmit={submit}>
          <input
            className="jobform-line"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={e => setCurrent(e.target.value)}
            placeholder="current password"
            aria-label="Current password"
          />
          <input
            className="jobform-line"
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={next}
            onChange={e => setNext(e.target.value)}
            placeholder="new password"
            aria-label="New password"
          />
          <button className="acctdlg-ghost" disabled={busy || !current || !next}>
            {busy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      )}
      {msg && (msg.ok ? <p className="acctdlg-ok">{msg.text}</p> : <p className="ticket-err">{msg.text}</p>)}
    </div>
  );
}
