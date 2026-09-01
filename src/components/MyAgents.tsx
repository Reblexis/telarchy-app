/**
 * The agents you own: what each has earned, and a way to fund them.
 *
 * There was no interface for any of this. `POST /api/agents` has taken
 * `initialCredits` since 2026-09-01 and nothing in the app called it, so every
 * bot on the platform was made with curl; `GET /api/agents/mine` was written to
 * list them ("Both surface here so the API page can split primary vs owned
 * bots") and no component read it.
 *
 * What it shows, in that order, is what an owner actually asks:
 *
 *  1. Has it done anything? Most have not. 94 owned bots had registered and not
 *     one had ever traded when this was built, so "no trades yet" is the common
 *     row and it says so plainly rather than showing a confident 0.00 profit.
 *  2. What has it earned? The leaderboard's own number, so this view and the
 *     public board cannot disagree.
 *  3. What has it got left, and can I top it up?
 *
 * Creating one is here too, because until now there was no way to do it except
 * curl, and the API key comes back exactly once: the server keeps only a hash,
 * so a key not copied off this screen is a key that is gone.
 *
 * Taking credits BACK is deliberately absent. Transfers are self-initiated by
 * design, so an owner cannot pull from a bot, and the default bot key lacks
 * `account:wallet` so the bot cannot send either. That is an open rules
 * question (notes/owned-agents-wallet-2026-09-01.md), and a button that
 * silently failed would be worse than no button.
 */
import { useEffect, useState } from 'react';
import { api, type MyAgent } from '../lib/api';

const money = (n: number): string =>
  `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** "never" reads as a verdict; "no trades yet" reads as a state. */
function activity(a: MyAgent): string {
  if (a.totalTrades === 0) return 'no trades yet';
  const when = a.lastTradeAt ? new Date(a.lastTradeAt) : null;
  const day = when && !Number.isNaN(when.getTime()) ? when.toISOString().slice(0, 10) : null;
  return `${a.totalTrades.toLocaleString('en-US')} trade${a.totalTrades === 1 ? '' : 's'}${day ? `, last ${day}` : ''}`;
}

export function MyAgents() {
  const [rows, setRows] = useState<MyAgent[] | null>(null);
  const [err, setErr] = useState('');
  const [funding, setFunding] = useState<string | null>(null);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [creating, setCreating] = useState(false);
  const [newId, setNewId] = useState('');
  const [newCredits, setNewCredits] = useState('25');
  const [madeKey, setMadeKey] = useState<{ agentId: string; apiKey: string } | null>(null);

  const load = () => {
    api
      .getMyAgents()
      .then(setRows)
      .catch((e: Error) => setErr(e.message));
  };
  useEffect(load, []);

  const send = async (to: string, shownAs: string) => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Amount must be a number of credits above zero.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api.transferCredits(to, n, `funding ${to}`);
      setSaid(`Sent ${money(n)} cr to ${shownAs}`);
      setFunding(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    const agentId = newId.trim();
    if (!agentId) {
      setErr('A bot needs an id: lowercase letters, numbers and hyphens.');
      return;
    }
    const credits = Number(newCredits === '' ? 0 : newCredits);
    if (!Number.isFinite(credits) || credits < 0) {
      setErr('Starting credits must be zero or more.');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      const made = await api.createAgent({ agentId, initialCredits: credits });
      setMadeKey({ agentId: made.agentId, apiKey: made.apiKey });
      setCreating(false);
      setNewId('');
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (err && !rows) return <p className="acctdlg-hint">{err}</p>;
  if (!rows) return <p className="acctdlg-hint">Loading your agents…</p>;

  // The human's own participant is not a bot they own; it is them.
  const bots = rows.filter(a => a.authUserId === null);
  const me = rows.find(a => a.authUserId !== null) ?? null;

  return (
    <div className="jobform-field">
      <span className="ticket-label">Agents you own</span>
      {bots.length === 0 ? (
        <p className="acctdlg-hint">
          You have none yet. A bot is its own participant with its own balance and its own leaderboard rank, created
          with <code>POST /api/agents</code>; give it <code>initialCredits</code> and the credits move out of your
          balance in the same call, so it can trade the moment it exists.{' '}
          <a href="https://github.com/Reblexis/telarchy-reference-agent" target="_blank" rel="noreferrer">
            The reference agent
          </a>{' '}
          is one file and shows what one does.
        </p>
      ) : (
        <>
          <ul className="myagents">
            {bots.map(a => (
              <li key={a.id} className="myagents-row">
                <span className="myagents-name">{a.nickname || a.id}</span>
                <span className="myagents-earned" title="Trading profit, the same number the leaderboard ranks on">
                  {a.totalTrades === 0 ? '—' : `${a.earned >= 0 ? '+' : ''}${money(a.earned)} cr earned`}
                </span>
                <span className="myagents-act">{activity(a)}</span>
                <span className="myagents-bal">{money(a.balance)} cr left</span>
                <button
                  type="button"
                  className="acctdlg-ghost"
                  onClick={() => setFunding(funding === a.id ? null : a.id)}
                >
                  {funding === a.id ? 'Cancel' : 'Send credits'}
                </button>
                {funding === a.id && (
                  <span className="myagents-send">
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                      aria-label={`Credits to send to ${a.nickname || a.id}`}
                    />
                    <button
                      type="button"
                      className="acctdlg-ok"
                      disabled={busy}
                      onClick={() => void send(a.id, a.nickname || a.id)}
                    >
                      {busy ? 'Sending…' : 'Send'}
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
          <p className="acctdlg-hint">
            Credits move out of your own balance{me ? `, which is ${money(me.balance)} cr` : ''}. Getting them back
            needs the bot to send them itself, from a key with wallet scope.
          </p>
        </>
      )}
      <div className="myagents-make">
        <button type="button" className="acctdlg-ghost" onClick={() => setCreating(c => !c)}>
          {creating ? 'Cancel' : 'Create an agent'}
        </button>
        {creating && (
          <span className="myagents-makeform">
            <label>
              Agent id
              <input type="text" value={newId} placeholder="my-trader" onChange={e => setNewId(e.target.value)} />
            </label>
            <label>
              Starting credits
              <input type="number" min="0" step="1" value={newCredits} onChange={e => setNewCredits(e.target.value)} />
            </label>
            <button type="button" className="acctdlg-ok" disabled={busy} onClick={() => void create()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
            <span className="acctdlg-hint">
              The credits come out of your balance in the same call. If you cannot afford them, no bot is created.
            </span>
          </span>
        )}
      </div>
      {madeKey && (
        <div className="myagents-key">
          <p className="acctdlg-hint">
            <strong>{madeKey.agentId}</strong> is live. Its key is shown once and cannot be fetched again; the server
            keeps only a hash. Copy it now, or you will have to issue a new one.
          </p>
          <code className="myagents-keyval">{madeKey.apiKey}</code>
          <button
            type="button"
            className="acctdlg-ghost"
            onClick={() => {
              navigator.clipboard.writeText(madeKey.apiKey).catch(e => console.error('copy failed:', e));
            }}
          >
            Copy key
          </button>
          <button type="button" className="acctdlg-ghost" onClick={() => setMadeKey(null)}>
            Done
          </button>
        </div>
      )}
      {said && <p className="acctdlg-ok-note">{said}</p>}
      {err && rows && <p className="ticket-err">{err}</p>}
    </div>
  );
}
