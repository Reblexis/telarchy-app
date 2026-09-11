import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuilderOptions } from '../lib/agent-builder';

type Terminal = 'unix' | 'windows';
/** Quote workspace context as shell data, never interpolate it as a command. */
export function manualCommands(os: Terminal, workspace: string) {
  const selected = workspace || 'telarchy';
  const quote = os === 'windows' ? `'${selected.replace(/'/g, "''")}'` : `'${selected.replace(/'/g, "'\\''")}'`;
  const python = os === 'windows' ? '.\\.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const setWorkspace = os === 'windows' ? `$env:TELARCHY_WORKSPACE = ${quote}` : `export TELARCHY_WORKSPACE=${quote}`;
  const enterKey =
    os === 'windows'
      ? `$env:TELARCHY_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Telarchy API key' -AsSecureString)).Password`
      : `export TELARCHY_KEY="$(${python} -c 'import getpass; print(getpass.getpass("Telarchy API key: "))')"`;
  return {
    preview: [
      'git clone https://github.com/Reblexis/telarchy-reference-agent.git',
      'cd telarchy-reference-agent',
      `${os === 'windows' ? 'py -3' : 'python3'} -m venv .venv`,
      `${python} -m pip install -r requirements.txt`,
      setWorkspace,
      `${python} agent.py`,
    ].join('\n'),
    connected: [enterKey, setWorkspace, `${python} agent.py`].join('\n'),
    live: `${python} agent.py --budget-per-trade 1 --cycle-budget 5 --live`,
  };
}

function Commands({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState('');
  const [failed, setFailed] = useState(false);
  return (
    <div className="manual-commands">
      <div className="manual-command-bar">
        <span>TERMINAL</span>
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            void navigator.clipboard
              .writeText(text)
              .then(() => setCopied(text))
              .catch(() => setFailed(true));
          }}
        >
          {copied === text ? 'Commands copied' : label}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{text}</code>
      </pre>
      {failed && <p role="alert">Copy failed. Select the commands and copy them manually.</p>}
    </div>
  );
}

export function AgentManualSetup({
  workspace,
  access,
  identity,
  connectionForm,
  connected = false,
}: Pick<BuilderOptions, 'workspace' | 'access' | 'identity'> & { connectionForm: ReactNode; connected?: boolean }) {
  const [os, setOs] = useState<Terminal>('unix');
  const commands = manualCommands(os, workspace);
  return (
    <section className="agent-manual" aria-label="Manual setup">
      <div className="manual-heading">
        <h2>Set it up yourself.</h2>
        <label>
          Terminal
          <select aria-label="Terminal" value={os} onChange={e => setOs(e.target.value as Terminal)}>
            <option value="unix">macOS / Linux</option>
            <option value="windows">Windows PowerShell</option>
          </select>
        </label>
      </div>
      <section className="manual-step">
        <h3>
          <span>1</span> Run a preview
        </h3>
        <p>
          Install Git and Python 3.10 or newer, then paste these commands into your terminal. This runs the
          deterministic starter without placing trades.
        </p>
        {!workspace && (
          <p className="manual-note">
            Starts in the public Telarchy workspace. You can choose another when connecting.
          </p>
        )}
        <Commands label="Copy preview commands" text={commands.preview} />
        <p className="manual-note">
          You’ll see candidate forecasts, or a message that there are no trades to suggest. Both are valid previews.
        </p>
      </section>
      {!connected && (
        <section className="manual-step">
          <h3>
            <span>2</span>{' '}
            {connected ? 'Your key is ready' : `Connect ${identity === 'bot' ? 'your bot' : 'your account'}`}
          </h3>
          <p>
            {connected
              ? 'Copy your key for the terminal prompt in the next step.'
              : access === 'read'
                ? 'Optional for public research. Create a key when you need authenticated access.'
                : 'Create a trading key. A separate bot needs credits before it can trade.'}
          </p>
          {connectionForm}
        </section>
      )}
      <section className="manual-step">
        <h3>
          <span>{connected ? 2 : 3}</span> {connected ? 'Run with your key' : 'Try it with your key'}
        </h3>
        <p>
          Copy and run these commands first. When the terminal asks for your key, copy it below and paste it. This
          previews; it does not trade.
        </p>
        <Commands label="Copy connection commands" text={commands.connected} />
        {connected && connectionForm}
        {access !== 'read' && (
          <details className="manual-live">
            <summary>After the preview: allow live trading</summary>
            <p>Review the forecast first. This run spends up to 1 credit per trade and 5 credits per cycle.</p>
            <Commands label="Copy trading command" text={commands.live} />
          </details>
        )}
      </section>
      <p className="manual-note">
        Each command runs once. For an AI-assisted starter, your own strategy, or continuous operation, follow the{' '}
        <Link to="/guides/build-agent">build guide</Link>.
      </p>
    </section>
  );
}
