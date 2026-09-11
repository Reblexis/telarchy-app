import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  type BuilderOptions,
  builderPrompt,
  type Connection,
  connectBuilder,
  defaults,
  readOptions,
  tradingScopes,
} from '../lib/agent-builder';
import { api, type MyAgent } from '../lib/api';
import { withBase } from '../lib/base-path';
import type { CreatedConnection } from './AgentConnectionSetup';
import { AgentManualSetup } from './AgentManualSetup';

const STORAGE = 'telarchy-agent-builder';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Human setup first; machine instructions and account access are separate.
 * No credential is persisted or added to the copied setup instructions. */
export function AgentBuilder({
  onConnected,
  creationOnly = false,
  freshSetup = false,
}: {
  onConnected?: (result: CreatedConnection) => void;
  creationOnly?: boolean;
  freshSetup?: boolean;
}) {
  const { user, loading } = useAuth();
  const [options, setOptions] = useState<BuilderOptions>(() => {
    let saved = defaults;
    try {
      saved = readOptions(JSON.parse(sessionStorage.getItem(STORAGE) || 'null'));
    } catch {
      /* Storage is optional. */
    }
    if (freshSetup) saved = { ...saved, botName: '', credits: '100' };
    // The form creates bots only; personal keys are minted in the keys section.
    return { ...saved, identity: 'bot', workspace: '' };
  });
  const [workspaces, setWorkspaces] = useState<Awaited<ReturnType<typeof api.getPublicWorkspaces>>>([]);
  const [listError, setListError] = useState('');
  const [listLoading, setListLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [agents, setAgents] = useState<MyAgent[] | null>(null);
  const [balanceError, setBalanceError] = useState('');
  const access = options.identity === 'bot' ? 'full' : options.access;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [manual, setManual] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const [connection, setConnection] = useState<(Connection & { userId: string }) | null>(null);
  const progress = useRef<Connection | null>(null);
  const lock = useRef(false);
  const account = useRef(user?.id);
  account.current = user?.id;
  const mounted = useRef(true);
  const [more, setMore] = useState('0');
  const [uncertain, setUncertain] = useState(false);
  const [transferNote, setTransferNote] = useState('');
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE, JSON.stringify(readOptions(options)));
    } catch {
      /* A private browser may disable storage. */
    }
    setCopied('');
  }, [options.identity, options.access, options.botName, options.credits]);
  useEffect(() => {
    let current = true;
    setListLoading(true);
    setListError('');
    api
      .getPublicWorkspaces()
      .then(rows => {
        if (current) {
          setWorkspaces(rows);
          const home = rows.find(w => w.slug === 'telarchy');
          if (!home) setListError('Setup is temporarily unavailable. Try again.');
          else setOptions(o => ({ ...o, workspace: home.workspaceId }));
        }
      })
      .catch(e => {
        if (current) setListError(message(e));
      })
      .finally(() => {
        if (current) setListLoading(false);
      });
    return () => {
      current = false;
    };
  }, [retry]);
  useEffect(() => {
    let current = true;
    setConnection(null);
    progress.current = null;
    setAgents(null);
    setError('');
    setUncertain(false);
    setTransferNote('');
    setBalanceError('');
    if (user)
      api
        .getMyAgents()
        .then(rows => {
          if (current) setAgents(rows);
        })
        .catch(e => {
          if (current) setBalanceError(message(e));
        });
    return () => {
      current = false;
    };
  }, [user?.id]);
  const done = connection?.userId === user?.id ? connection : null;
  const fixed = busy || !!progress.current?.attempted || !!progress.current?.key || !!done;
  const selected = workspaces.find(w => w.workspaceId === options.workspace);
  const own = agents?.find(a => a.authUserId === user?.id);
  const amount = Number(options.credits);
  const fundsValid =
    options.credits.trim() !== '' && Number.isFinite(amount) && amount >= 0 && !!own && amount <= own.balance;
  const nameValid = options.botName.trim().length <= 64;
  const prompt = builderPrompt(`${window.location.origin}${withBase('')}`, {
    ...options,
    access,
    workspace: options.workspace || 'telarchy',
  });
  const change = (key: keyof BuilderOptions, value: string) => setOptions(o => ({ ...o, [key]: value }));
  const copy = async (value: string, kind: string) => {
    setCopied('');
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
    } catch {
      setCopyError(true);
    }
  };
  const run = async (action: (current: () => boolean) => Promise<void>) => {
    if (lock.current || !user) return;
    const id = user.id;
    const current = () => mounted.current && account.current === id;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await action(current);
    } catch (e) {
      if (current()) setError(message(e));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const connect = () =>
    run(async current => {
      const c = progress.current ?? { label: `Agent builder ${crypto.randomUUID()}` };
      progress.current = c;
      await connectBuilder({ ...options }, access, c, current);
      if (current()) {
        setConnection({ ...c, userId: user!.id });
        onConnected?.({
          options: { ...options, access: c.access || options.access },
          connection: { ...c },
          userId: user!.id,
        });
      }
      const rows = await api.getMyAgents();
      if (current()) setAgents(rows);
    });
  const refreshBalances = () =>
    run(async current => {
      const rows = await api.getMyAgents();
      if (current()) {
        setAgents(rows);
        setBalanceError('');
        setUncertain(false);
        setTransferNote('Balances refreshed. Review the bot balance before sending another transfer.');
      }
    });
  const topup = () =>
    run(async current => {
      if (!done?.agentId || uncertain) return;
      try {
        await api.transferCredits(done.agentId, Number(more), 'Agent builder funding');
        if (current()) {
          setTransferNote('Credits sent.');
          setMore('0');
        }
      } catch {
        if (current()) {
          setUncertain(true);
          setTransferNote('Transfer result is uncertain. Check balances before sending again.');
        }
        return;
      }
      const rows = await api.getMyAgents();
      if (current()) setAgents(rows);
    });
  const connectionForm = (
    <section id="create-agent-key" className="builder-connect" aria-label="Get your API key">
      {done && <h2>Your connection is ready</h2>}
      {listError && (
        <p role="alert">
          {listError}{' '}
          <button type="button" onClick={() => setRetry(n => n + 1)}>
            Try again
          </button>
        </p>
      )}

      {
        <>
          {balanceError && (
            <p role="alert">
              {balanceError}{' '}
              <button type="button" disabled={busy} onClick={() => void refreshBalances()}>
                Retry balance
              </button>
            </p>
          )}
          {!done ? (
            <>
              <fieldset disabled={fixed} className="builder-choices">
                <label>
                  <span>
                    {options.identity === 'bot' ? 'Name' : 'Label'} <small>optional</small>
                  </span>
                  <input
                    aria-label={options.identity === 'bot' ? 'Bot name' : 'Key label'}
                    value={options.botName}
                    onChange={e => change('botName', e.target.value)}
                    placeholder="We’ll name it for you"
                    maxLength={64}
                    autoComplete="off"
                  />
                </label>
                {options.identity === 'bot' && (
                  <label>
                    Starting credits
                    <input
                      aria-label="Starting credits"
                      type="number"
                      min="0"
                      step="any"
                      value={options.credits}
                      onChange={e => change('credits', e.target.value)}
                    />
                    {own && (
                      <small>
                        Your balance: {own.balance.toLocaleString('en-US', { maximumFractionDigits: 2 })} cr
                      </small>
                    )}
                  </label>
                )}
              </fieldset>
              {options.identity === 'bot' && own && amount > own.balance && (
                <p>
                  Not enough credits. <Link to="/earn">Earn credits</Link> or start with zero.
                </p>
              )}
              {options.identity === 'bot' && (
                <p className="builder-transfer-summary">
                  {amount > 0
                    ? `Transfers ${options.credits} cr from your balance.`
                    : 'Starts with 0 credits. You can fund it later.'}
                </p>
              )}
              {!user ? (
                <Link className="doors-pill" to={`/login?next=${encodeURIComponent(withBase('/agents#agent-setup'))}`}>
                  Log in to connect
                </Link>
              ) : (
                <button
                  type="button"
                  className="doors-pill"
                  disabled={
                    busy ||
                    loading ||
                    listLoading ||
                    !selected ||
                    !!listError ||
                    (!progress.current?.attempted && options.identity === 'bot' && (!fundsValid || !nameValid))
                  }
                  onClick={() => void connect()}
                >
                  {busy
                    ? 'Connecting…'
                    : progress.current?.attempted || progress.current?.key
                      ? 'Finish connection'
                      : options.identity === 'bot'
                        ? `Create bot & get key`
                        : 'Create my API key'}
                </button>
              )}
              {error && (
                <p role="alert">
                  {error}
                  {progress.current?.attempted &&
                    ' Creation may already have completed. Finish connection checks the existing bot without sending starting credits again.'}
                </p>
              )}
            </>
          ) : (
            <>
              <p role="status">Connection ready. Your agent is not running yet.</p>
              <p>
                {done.access === 'trade' ? 'Trading allowed' : 'Research and preview only'} in {selected?.name}.{' '}
                {done.joined === 'viewer' && 'This workspace does not offer public trading access.'}
              </p>
              <div className="builder-secret">
                <span className="builder-secret-label">YOUR API KEY</span>
                <code className="builder-key">{done.key?.apiKey}</code>
              </div>
              <button type="button" className="doors-pill" onClick={() => void copy(done.key!.apiKey, 'key')}>
                {copied === 'key' ? 'Key copied' : 'Copy key'}
              </button>
              <p>Copy and save this key now. You cannot reveal it again after leaving this session.</p>
              {done.access === 'read' && done.joined === 'trader' && (
                <details className="builder-adjust">
                  <summary>Allow this key to trade</summary>
                  <p>
                    Enabling trading permits spending from {options.identity === 'bot' ? 'the bot’s' : 'your'} balance.
                    There is no server-side spending cap.
                  </p>
                  <button
                    type="button"
                    className="doors-pill"
                    disabled={busy}
                    onClick={() =>
                      void run(async current => {
                        await api.updateAgentKey(done.agentId!, done.key!.keyId, { scopes: tradingScopes });
                        if (current()) {
                          progress.current!.access = 'trade';
                          change('access', 'trade');
                          setConnection({ ...done, access: 'trade' });
                        }
                      })
                    }
                  >
                    Enable trading
                  </button>
                </details>
              )}
              {options.identity === 'bot' && (
                <details className="builder-funding">
                  <summary>Send more credits</summary>
                  <p>
                    Bot balance:{' '}
                    {agents?.find(a => a.id === done.agentId)?.balance.toLocaleString('en-US') ?? 'not loaded'} credits
                  </p>
                  <label>
                    More credits
                    <input
                      aria-label="More credits"
                      type="number"
                      min="0"
                      step="any"
                      value={more}
                      disabled={busy}
                      onChange={e => setMore(e.target.value)}
                    />
                  </label>
                  <p>Transfer from your balance to {done.agentId}.</p>
                  <button
                    type="button"
                    className="doors-pill"
                    disabled={
                      busy ||
                      uncertain ||
                      !own ||
                      !Number.isFinite(Number(more)) ||
                      Number(more) <= 0 ||
                      Number(more) > own.balance
                    }
                    onClick={() => void topup()}
                  >
                    Send {more || '0'} credits
                  </button>
                  {transferNote && <p role="status">{transferNote}</p>}
                  {uncertain && (
                    <button type="button" disabled={busy} onClick={() => void refreshBalances()}>
                      Check balances
                    </button>
                  )}
                </details>
              )}
              {error && <p role="alert">{error}</p>}
            </>
          )}
        </>
      }
    </section>
  );
  return (
    <section id="agent-setup" className="agent-builder" aria-label="Build your agent">
      <div className="builder-heading">
        <h2>New bot</h2>
      </div>
      {connectionForm}
      {!creationOnly && (
        <div id="agent-runtime" className="builder-run">
          <div className="builder-section-title">
            <span>2</span>
            <h2>Run it your way</h2>
          </div>
          <p>Paste into your coding assistant, or set up manually.</p>
          <div className="builder-action">
            <button type="button" className="pubws-cta pubws-cta--small" onClick={() => void copy(prompt, 'prompt')}>
              <BuilderIcon kind="copy" />
              {copied === 'prompt' ? 'Prompt copied' : 'Copy setup prompt'}
            </button>
            <button
              type="button"
              className="builder-manual-toggle"
              aria-expanded={manual}
              onClick={() => setManual(v => !v)}
            >
              {manual ? 'Hide manual setup' : 'Set up manually'}
            </button>
            <span className="builder-selected-summary">
              {options.identity === 'bot' ? 'Separate bot' : 'Your account'} ·{' '}
              {access === 'read' ? 'Research only' : 'Trading access'}
              <small>{done ? 'Key ready · Nothing running yet' : 'Public previews work without a key'}</small>
            </span>
          </div>
          {copied === 'prompt' && (
            <div className="builder-next" role="status">
              <strong>Ready for your coding assistant.</strong>
              <p>
                Paste the prompt into your coding assistant, such as Claude Code or Codex. It will help build your agent
                and show a dry run. Nothing is running yet.
              </p>
            </div>
          )}
          {copyError && (
            <p role="alert">
              Copy failed. Select the prompt below and copy it manually. Keys can be selected separately after
              connection.
            </p>
          )}
          <details open={copyError || undefined}>
            <summary>Read the setup prompt</summary>
            <textarea aria-label="Setup prompt" readOnly value={prompt} rows={12} />
          </details>
          {manual ? (
            <AgentManualSetup
              workspace={options.workspace}
              access={access}
              identity={options.identity}
              connected={!!done}
              connectionForm={
                done ? (
                  <button type="button" className="builder-key-jump" onClick={() => void copy(done.key!.apiKey, 'key')}>
                    Copy key
                  </button>
                ) : (
                  <button
                    type="button"
                    className="builder-key-jump"
                    onClick={() =>
                      document
                        .getElementById('create-agent-key')
                        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }
                  >
                    Create or copy your key above ↑
                  </button>
                )
              }
            />
          ) : null}
        </div>
      )}
      {!creationOnly && (
        <details id="agent-instructions">
          <summary>For developers and agents</summary>
          <p>
            <Link to="/guides/build-agent">Build guide</Link> · <a href={withBase('/api/help')}>API catalog</a> ·{' '}
            <a href={withBase('/llms.txt')}>Machine-readable instructions</a> ·{' '}
            <a href="https://github.com/Reblexis/telarchy-reference-agent">Reference source</a>
          </p>
        </details>
      )}
    </section>
  );
}

function BuilderIcon({ kind }: { kind: 'bot' | 'me' | 'read' | 'trade' | 'copy' }) {
  return (
    <svg
      className="builder-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {kind === 'bot' ? (
        <>
          <rect x="4" y="7" width="16" height="13" rx="4" />
          <path d="M12 3v4M8 16h8" />
          <circle cx="8" cy="12" r="1" />
          <circle cx="16" cy="12" r="1" />
        </>
      ) : kind === 'me' ? (
        <>
          <circle cx="12" cy="7" r="4" />
          <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
        </>
      ) : kind === 'read' ? (
        <>
          <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
        </>
      ) : kind === 'trade' ? (
        <path d="M3 17h5v-6h6V5h7M16 5h5v5M3 22h18" />
      ) : (
        <>
          <rect x="8" y="8" width="12" height="13" rx="2" />
          <path d="M15 8V3H3v13h5" />
        </>
      )}
    </svg>
  );
}
