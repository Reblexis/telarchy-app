import { Link, useLocation } from 'react-router-dom';
import { BotGlyph } from './BotGlyph';

/** The permanent agent destination shared by floor and document top bars. */
export function AgentNavLink() {
  const location = useLocation();
  return (
    <Link
      className="pubws-agents"
      to="/agents"
      state={
        location.pathname === '/agents'
          ? location.state
          : { agentReturnTo: `${location.pathname}${location.search}${location.hash}` }
      }
      aria-label="Agents and API keys"
      title="Agents and API keys"
      aria-current={location.pathname === '/agents' ? 'page' : undefined}
    >
      <BotGlyph />
      <span>Agents</span>
    </Link>
  );
}
