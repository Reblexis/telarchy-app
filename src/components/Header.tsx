import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Page = 'metrics' | 'agents' | 'markets' | 'tasks' | 'marketplace';

const CREATOR_NAV: { to: string; label: string; page: Page }[] = [
  { to: '/metrics',     label: 'Metrics',     page: 'metrics' },
  { to: '/markets',     label: 'Markets',     page: 'markets' },
  { to: '/tasks',       label: 'Tasks',       page: 'tasks' },
  { to: '/agents',      label: 'Agents',      page: 'agents' },
  { to: '/marketplace', label: 'Marketplace', page: 'marketplace' },
];

const OPERATOR_NAV: { to: string; label: string; page: Page }[] = [
  { to: '/agents',      label: 'My Agents',   page: 'agents' },
  { to: '/marketplace', label: 'Marketplace', page: 'marketplace' },
];

export interface HeaderProps {
  activePage?: Page;
  /** 'creator' = workspace owner nav; 'operator' = agent-only nav. Defaults to 'creator'. */
  navMode?: 'creator' | 'operator';
  actions?: ReactNode;
  /** If provided, displays the workspace name. */
  workspaceName?: string;
  /** Whether to show the workspace settings gear link. */
  showSettings?: boolean;
}

export function Header({ activePage, navMode = 'creator', actions, workspaceName, showSettings }: HeaderProps) {
  const navItems = navMode === 'operator' ? OPERATOR_NAV : CREATOR_NAV;

  return (
    <div className="header">
      <img src="/logo_transparent_bg.png" alt="Telarchy" style={{ height: '5.25rem' }} />
      <nav className="header-nav">
        {navItems.map(item => (
          <Link key={item.page} to={item.to} className={`nav-link${item.page === activePage ? ' active' : ''}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        {workspaceName && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {workspaceName}
          </span>
        )}
        {showSettings && (
          <Link to="/settings" title="Workspace settings">
            <button className="btn" style={{ padding: '0.3rem 0.6rem', fontSize: '1rem' }}>⚙</button>
          </Link>
        )}
        {actions}
      </div>
    </div>
  );
}
