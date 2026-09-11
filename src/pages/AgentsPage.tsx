import { useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AgentMark } from '../components/AgentMark';
import { AgentWorkspace } from '../components/AgentWorkspace';
import { PageTopBar } from '../components/PageTopBar';

/** A working home for agent connections, with no marketing or console chrome. */
export function AgentsPage() {
  const location = useLocation();
  const candidate = location.state?.agentReturnTo;
  const returnTo = useRef(
    typeof candidate === 'string' &&
      candidate.startsWith('/') &&
      !candidate.startsWith('//') &&
      !candidate.startsWith('/agents')
      ? candidate
      : '/',
  );
  return (
    <div className="pubws agents-page">
      <PageTopBar />
      <main className="pubws-doc">
        <header className="agents-hero">
          <Link className="agents-back" to={returnTo.current}>
            <span aria-hidden="true">←</span> Back
          </Link>
          <AgentMark compact />
          <h1>Agents</h1>
        </header>
        <AgentWorkspace />
        <footer className="agents-foot">
          <p>Runs on your computer or server. Access is managed here.</p>
          <div>
            <Link to="/guides/build-agent">Build guide ↗</Link>
            <Link to="/for-agents">Explore agent strategies ↗</Link>
          </div>
        </footer>
      </main>
    </div>
  );
}
