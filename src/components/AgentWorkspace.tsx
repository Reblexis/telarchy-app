import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { withBase } from '../lib/base-path';
import { AgentBuilder } from './AgentBuilder';
import type { CreatedConnection } from './AgentConnectionSetup';
import { MyAgents } from './MyAgents';

/** One surface: bots are created inside the Bots section, keys inside the Keys
 * section. Opening a row never discards an unfinished new-bot form. */
export function AgentWorkspace() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [created, setCreated] = useState<CreatedConnection | null>(null);
  const [revision, setRevision] = useState(0);
  const [setup, setSetup] = useState(0);
  const [newBot, setNewBot] = useState(false);
  useEffect(() => {
    if (location.hash === '#agent-setup') {
      setNewBot(true);
      setSetup(n => n + 1);
    }
    if (location.hash) document.getElementById('manage-agents')?.scrollIntoView?.({ block: 'start' });
  }, [location.hash]);
  const clearHash = () => {
    if (location.hash) navigate(`${location.pathname}${location.search}`, { replace: true, state: location.state });
  };
  const cancel = () => {
    setNewBot(false);
    clearHash();
  };
  const builder = (
    <div className="agent-new-bot">
      {user && (
        <button type="button" className="builder-cancel" onClick={cancel} aria-label="Cancel new bot">
          Cancel
        </button>
      )}
      <AgentBuilder
        key={`${user?.id || 'anonymous'}:${setup}`}
        freshSetup={setup > 0}
        creationOnly
        onConnected={result => {
          setCreated(result);
          setRevision(r => r + 1);
          setSetup(n => n + 1);
          setNewBot(false);
          clearHash();
        }}
      />
    </div>
  );
  return (
    <section id="manage-agents" className="agent-management" aria-label="Agents and keys">
      {loading ? (
        <p role="status">Loading your agents…</p>
      ) : user ? (
        <MyAgents
          key={user.id}
          revision={revision}
          created={created?.userId === user.id ? created : undefined}
          builder={newBot ? builder : undefined}
          onCreate={() => {
            setNewBot(true);
            setSetup(n => n + 1);
          }}
        />
      ) : (
        <div className="agent-login-state">
          {builder}
          <p>Sign in to see your bots, send credits, and manage API keys.</p>
          <Link
            className="pubws-cta pubws-cta--small"
            to={`/login?next=${encodeURIComponent(withBase('/agents#manage-agents'))}`}
          >
            Log in to manage agents and keys
          </Link>
        </div>
      )}
    </section>
  );
}
