import { Link, useLocation } from 'react-router-dom';

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
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <rect x="4" y="7" width="16" height="13" rx="4" />
        <path d="M12 3v4M1 12v4m22-4v4M8 16h8" />
        <circle cx="8" cy="12" r=".8" />
        <circle cx="16" cy="12" r=".8" />
      </svg>
      <span>Agents</span>
    </Link>
  );
}
