import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { builderPrompt, defaults } from '../lib/agent-builder';
import { api, type MyAgent } from '../lib/api';
import { withBase } from '../lib/base-path';
import { AgentConnectionSetup, type CreatedConnection } from './AgentConnectionSetup';
import { AgentKeys } from './AgentKeys';
import { AgentManualSetup } from './AgentManualSetup';
import { AgentMark } from './AgentMark';

const money = (n: number): string =>
  `${n < 0 ? '-' : ''}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

/** The last trade's day, or nothing when the date is missing or unreadable. */
function lastDay(a: MyAgent): string | null {
  const when = a.lastTradeAt ? new Date(a.lastTradeAt) : null;
  return when && !Number.isNaN(when.getTime()) ? when.toISOString().slice(0, 10) : null;
}

const NewButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="agent-new" onClick={onClick}>
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
    {label}
  </button>
);

/** The signed-in owner's bots and personal keys, on /agents: a ticket card per
 * bot with the prompt one press away, personal keys in the second column. */
export function MyAgents({
  revision = 0,
  created,
  onCreate,
  builder,
}: {
  revision?: number;
  created?: CreatedConnection;
  /** Asks the page to show the new-bot form (rendered back in as `builder`). */
  onCreate?: (identity: 'bot') => void;
  builder?: ReactNode;
}) {
  const [rows, setRows] = useState<MyAgent[] | null>(null);
  const [err, setErr] = useState('');
  const [funding, setFunding] = useState<string | null>(null);
  const [amount, setAmount] = useState('25');
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [keysOpen, setKeysOpen] = useState<string | null>(null);
  const [manual, setManual] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyFailed, setCopyFailed] = useState<string | null>(null);
  const [keyCreate, setKeyCreate] = useState(0);
  const [botKeyCreate, setBotKeyCreate] = useState(0);
  const live = useRef(true);
  const lock = useRef(false);
  const generation = useRef(0);
  const createdBot = created?.options.identity === 'bot' ? created.connection.agentId : undefined;
  const load = async () => {
    const current = ++generation.current;
    const data = await api.getMyAgents();
    if (live.current && current === generation.current) setRows(data);
  };
  useEffect(() => {
    live.current = true;
    void load().catch(e => {
      if (live.current) setErr(e.message);
    });
    return () => {
      live.current = false;
      generation.current++;
    };
  }, [revision]);
  const refresh = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setErr('');
    try {
      await load();
      if (live.current) {
        setUncertain(false);
        setSaid('Balances refreshed. Review them before sending again.');
      }
    } catch (e) {
      if (live.current) setErr((e as Error).message);
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  };
  const send = async (to: string, shownAs: string) => {
    if (lock.current || uncertain) return;
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) {
      setErr('Amount must be a number of credits above zero.');
      return;
    }
    lock.current = true;
    setBusy(true);
    setErr('');
    try {
      await api.transferCredits(to, n, `funding ${to}`);
      if (!live.current) return;
      setSaid(`Sent ${money(n)} cr to ${shownAs}`);
      setFunding(null);
      await load();
    } catch (e) {
      if (live.current) {
        setErr((e as Error).message);
        setUncertain(true);
      }
    } finally {
      lock.current = false;
      if (live.current) setBusy(false);
    }
  };
  /** The prompt names the bot and its full access; it carries no credential. */
  const copyPrompt = async (id: string) => {
    const text = builderPrompt(
      `${window.location.origin}${withBase('')}`,
      { ...defaults, identity: 'bot', access: 'full', workspace: 'telarchy' },
      id,
    );
    setCopied(null);
    setCopyFailed(null);
    try {
      await navigator.clipboard.writeText(text);
      if (live.current) setCopied(id);
    } catch {
      if (live.current) setCopyFailed(id);
    }
  };
  const all = rows ?? [];
  const bots = [...all.filter(a => a.authUserId === null)].sort((a, b) =>
    a.id === createdBot ? -1 : b.id === createdBot ? 1 : 0,
  );
  const me = rows?.find(a => a.authUserId !== null);
  return (
    <div className="agent-owned agent-columns">
      <section className="agent-section agent-bots" aria-labelledby="agent-bots-heading">
        <div className="agent-section-head">
          <h2 id="agent-bots-heading">
            Bots <span>{rows ? bots.length : '…'}</span>
          </h2>
          {onCreate && !builder && <NewButton label="New bot" onClick={() => onCreate('bot')} />}
        </div>
        {builder}
        {created && !(created.options.identity === 'me' ? me : bots.some(a => a.id === created.connection.agentId)) && (
          <AgentConnectionSetup
            agentId={created.connection.agentId!}
            options={created.options}
            apiKey={created.connection.key?.apiKey}
          />
        )}
        {!rows ? (
          <p>Loading your agents…</p>
        ) : bots.length === 0 ? (
          <div className="agent-empty">
            <AgentMark compact />
            <h3>No bots yet</h3>
            <p>Give an agent its own balance and trading record.</p>
            {onCreate && !builder && (
              <button type="button" className="agent-empty-setup" onClick={() => onCreate('bot')}>
                Create your first bot <span aria-hidden="true">↗</span>
              </button>
            )}
          </div>
        ) : (
          <ul className="agent-cards">
            {bots.map(a => {
              const name = a.nickname || a.id;
              const createdHere = createdBot === a.id;
              const apiKey = createdHere ? created?.connection.key?.apiKey : undefined;
              const day = lastDay(a);
              return (
                <li key={a.id} className="agent-card">
                  <div className="agent-card-head">
                    <AgentMark compact />
                    <Link className="agent-profile-link" to={`/participants/${encodeURIComponent(a.id)}`}>
                      {name}
                    </Link>
                  </div>
                  <div className="agent-card-facts">
                    <div title="Credits left">
                      <span className="agent-card-cap">Credits</span>
                      <span className="agent-card-num">{money(a.balance)}</span>
                    </div>
                    <div title="Credits earned, the number the leaderboard ranks on">
                      <span className="agent-card-cap">Earned</span>
                      {a.totalTrades === 0 ? (
                        <span className="agent-card-note">no trades yet</span>
                      ) : (
                        <span className={`agent-card-num${a.earned > 0 ? ' is-up' : a.earned < 0 ? ' is-down' : ''}`}>
                          {a.earned >= 0 ? '+' : ''}
                          {money(a.earned)}
                        </span>
                      )}
                    </div>
                    <div title="Trades">
                      <span className="agent-card-cap">Trades</span>
                      <span className="agent-card-num">{a.totalTrades.toLocaleString('en-US')}</span>
                      {day && <span className="agent-card-note">last {day}</span>}
                    </div>
                  </div>
                  {apiKey && (
                    <div className="builder-secret">
                      <span className="builder-secret-label">YOUR API KEY</span>
                      <code className="builder-key">{apiKey}</code>
                      <button
                        type="button"
                        className="doors-pill"
                        onClick={() =>
                          void navigator.clipboard.writeText(apiKey).then(
                            () => live.current && setSaid('Key copied'),
                            () => live.current && setErr('Copy failed. Select the key and copy it manually.'),
                          )
                        }
                      >
                        Copy key
                      </button>
                      <small>Save it now. It’s only shown this session.</small>
                    </div>
                  )}
                  <div className="agent-card-actions">
                    <button type="button" className="agent-primary" onClick={() => void copyPrompt(a.id)}>
                      {copied === a.id ? 'Prompt copied' : 'Copy setup prompt'}
                    </button>
                    <button
                      type="button"
                      aria-expanded={manual === a.id}
                      onClick={() => setManual(manual === a.id ? null : a.id)}
                    >
                      {manual === a.id ? 'Hide manual setup' : 'Set up manually'}
                    </button>
                    <button type="button" onClick={() => setFunding(funding === a.id ? null : a.id)}>
                      {funding === a.id ? 'Cancel transfer' : 'Send credits'}
                    </button>
                    <button
                      type="button"
                      className="agent-card-keys-toggle"
                      aria-label={`Keys for ${name}`}
                      aria-expanded={keysOpen === a.id}
                      onClick={() => setKeysOpen(keysOpen === a.id ? null : a.id)}
                    >
                      Keys
                    </button>
                  </div>
                  {copied === a.id && (
                    <p role="status" className="agent-card-status">
                      Paste it into your coding assistant, such as Claude Code or Codex. Nothing is running yet.
                    </p>
                  )}
                  {copyFailed === a.id && (
                    <p role="alert" className="agent-card-status">
                      Copy failed. Open Set up manually and copy the commands instead.
                    </p>
                  )}
                  {funding === a.id && (
                    <div className="myagents-send">
                      <p className="agent-manage-hint">
                        From your balance: {me ? `${money(me.balance)} cr` : 'not loaded'}
                      </p>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={amount}
                        disabled={busy}
                        onChange={e => setAmount(e.target.value)}
                        aria-label={`Credits to send to ${name}`}
                      />
                      <button type="button" disabled={busy || uncertain} onClick={() => void send(a.id, name)}>
                        {busy ? 'Sending…' : 'Send'}
                      </button>
                      <details className="agent-transfer-details">
                        <summary>Returning credits</summary>
                        <p>To return credits, send them from the bot using a key with wallet access.</p>
                      </details>
                    </div>
                  )}
                  {manual === a.id && (
                    <AgentManualSetup
                      workspace="telarchy"
                      identity="bot"
                      access="full"
                      connected
                      connectionForm={
                        apiKey ? (
                          <button type="button" onClick={() => void navigator.clipboard.writeText(apiKey)}>
                            Copy key
                          </button>
                        ) : (
                          <p>Use this bot’s saved key, or create one under Keys.</p>
                        )
                      }
                    />
                  )}
                  {keysOpen === a.id && (
                    <div className="agent-card-keys">
                      <span className="agent-group-cap">
                        Keys
                        <NewButton label="New key" onClick={() => setBotKeyCreate(n => n + 1)} />
                      </span>
                      <AgentKeys
                        key={`keys-${a.id}`}
                        agentId={a.id}
                        identity="bot"
                        showCreate={false}
                        createRequested={botKeyCreate}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {me && (
        <section id="personal-agent-keys" className="agent-section agent-self" aria-labelledby="agent-keys-heading">
          <div className="agent-section-head">
            <h2 id="agent-keys-heading">Your API keys</h2>
            <NewButton label="New key" onClick={() => setKeyCreate(n => n + 1)} />
          </div>
          <p className="agent-section-note">Keys that act as you.</p>
          {created?.options.identity === 'me' && (
            <AgentConnectionSetup
              agentId={created.connection.agentId!}
              key={created.connection.key?.keyId}
              options={created.options}
              apiKey={created.connection.key?.apiKey}
            />
          )}
          <AgentKeys key={me.id} agentId={me.id} identity="me" showCreate={false} createRequested={keyCreate} />
        </section>
      )}
      <div className="agent-owned-status">
        {said && <p role="status">{said}</p>}
        {err && <p role="alert">{err}</p>}
        {(uncertain || (err && !rows)) && (
          <button type="button" disabled={busy} onClick={() => void refresh()}>
            {uncertain ? 'Check transfer status' : 'Try again'}
          </button>
        )}
        {uncertain && (
          <p role="alert">The transfer result is uncertain. Check the transfer status before sending again.</p>
        )}
      </div>
    </div>
  );
}
