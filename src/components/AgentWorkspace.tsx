import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';
import { withBase } from '../lib/base-path';
import { AgentBuilder, type BuilderFloor } from './AgentBuilder';
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
  // The door from a market (docs/audience-pages.md, "The door from a
  // market"): /agents?market=<slug> opens the new-bot form with that market
  // preset. Until the market is known the form is not shown, so a bot is
  // never created in the default workspace by a visitor who came for
  // another; a market that cannot be read falls back to the plain form.
  const market = new URLSearchParams(location.search).get('market') || '';
  const [floor, setFloor] = useState<BuilderFloor | null>(null);
  const [floorFailed, setFloorFailed] = useState(false);
  useEffect(() => {
    setFloor(null);
    setFloorFailed(false);
    if (!market) return;
    let current = true;
    api
      .getMarketplaceWorkspace(market)
      .then(w => {
        if (current) setFloor({ workspaceId: w.workspaceId, slug: w.slug || w.workspaceId, name: w.name });
      })
      .catch(() => {
        if (current) setFloorFailed(true);
      });
    return () => {
      current = false;
    };
  }, [market]);
  useEffect(() => {
    if (location.hash === '#agent-setup' || market) {
      setNewBot(true);
      setSetup(n => n + 1);
    }
    if (location.hash) document.getElementById('manage-agents')?.scrollIntoView?.({ block: 'start' });
  }, [location.hash, market]);
  const clearHash = () => {
    if (location.hash) navigate(`${location.pathname}${location.search}`, { replace: true, state: location.state });
  };
  const cancel = () => {
    setNewBot(false);
    clearHash();
  };
  const builder =
    market && !floor && !floorFailed ? (
      <p role="status">Loading the market…</p>
    ) : (
      <div className="agent-new-bot">
        {user && (
          <button type="button" className="builder-cancel" onClick={cancel} aria-label="Cancel new bot">
            Cancel
          </button>
        )}
        <AgentBuilder
          key={`${user?.id || 'anonymous'}:${setup}:${floor?.workspaceId ?? ''}`}
          freshSetup={setup > 0}
          creationOnly
          floor={floor ?? undefined}
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
