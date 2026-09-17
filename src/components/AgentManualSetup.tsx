import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BuilderOptions } from '../lib/agent-builder';

type Terminal = 'unix' | 'windows';
/**
 * The commands a newcomer pastes, in the order they paste them. The agent
 * defaults to the public floor and asks for the key itself (`--login`), so no
 * block sets a variable or holds a secret, and every block after the first is
 * one line. Workspace context is quoted as shell data, never interpolated.
 * `scripts/check-reference-agent-commands.mjs` holds these against the
 * reference agent's main branch.
 */
export function manualCommands(os: Terminal, workspace: string) {
  const quote = os === 'windows' ? `'${workspace.replace(/'/g, "''")}'` : `'${workspace.replace(/'/g, "'\\''")}'`;
  const python = os === 'windows' ? '.\\.venv\\Scripts\\python.exe' : '.venv/bin/python';
  const run = `${python} agent.py${workspace ? ` --workspace ${quote}` : ''}`;
  return {
    preview: [
      'git clone https://github.com/Reblexis/telarchy-reference-agent.git',
      'cd telarchy-reference-agent',
      `${os === 'windows' ? 'py -3' : 'python3'} -m venv .venv`,
      `${python} -m pip install -r requirements.txt`,
      run,
    ].join('\n'),
    login: `${python} agent.py --login`,
    connected: run,
    live: `${run} --live`,
    keepRunning: `${run} --live --every 30`,
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
          Install Git and Python 3.10 or newer, then paste these commands into your terminal. It shows what the starter
          bot would trade. No account needed, nothing is spent.
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
        {access === 'read' && (
          <p className="manual-note">For public research you can stop here. The next steps are for trading.</p>
        )}
      </section>
      {!connected && (
        <section className="manual-step">
          <h3>
            <span>2</span> {identity === 'bot' ? 'Create your bot' : 'Create your key'}
          </h3>
          <p>
            {access === 'read'
              ? 'Optional for public research. Create a key when you need authenticated access.'
              : 'Create a trading key. A separate bot needs credits before it can trade.'}
          </p>
          {connectionForm}
        </section>
      )}
      <section className="manual-step">
        <h3>
          <span>{connected ? 2 : 3}</span> Connect your key
        </h3>
        <p>
          Run this, then paste your key when it asks. The key is checked and saved on your computer, so you do this only
          once.
        </p>
        <Commands label="Copy connect command" text={commands.login} />
        {connected && connectionForm}
        <p>Preview again. With a key it shows the estimated price of each trade. Still nothing is spent.</p>
        <Commands label="Copy preview command" text={commands.connected} />
        {access !== 'read' && (
          <details className="manual-live">
            <summary>After the preview: trade for real</summary>
            <p>This spends up to 1 credit per trade and 5 credits per run.</p>
            <Commands label="Copy trading command" text={commands.live} />
            <p>To keep it trading, one run every 30 minutes until you press Ctrl+C:</p>
            <Commands label="Copy repeating command" text={commands.keepRunning} />
          </details>
        )}
      </section>
      <p className="manual-note">
        Every run ends by telling you the next step. For an AI-assisted starter or your own strategy, follow the{' '}
        <Link to="/guides/build-agent">build guide</Link>.
      </p>
    </section>
  );
}
