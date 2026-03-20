import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type Page = 'metrics' | 'agents' | 'markets' | 'tasks';

const NAV_ITEMS: { to: string; label: string; page: Page }[] = [
  { to: '/metrics', label: 'Metrics', page: 'metrics' },
  { to: '/agents', label: 'Agents', page: 'agents' },
  { to: '/markets', label: 'Markets', page: 'markets' },
  { to: '/tasks', label: 'Tasks', page: 'tasks' },
];

export interface HeaderProps {
  activePage?: Page;
  actions?: ReactNode;
  /** If provided, displays the workspace name and a settings link. */
  workspaceName?: string;
  /** Whether to show the workspace settings gear link. */
  showSettings?: boolean;
}

export function Header({ activePage, actions, workspaceName, showSettings }: HeaderProps) {
  return (
    <div className="header">
      <img src="/logo.png" alt="Telarchy" style={{ height: '5.25rem' }} />
      <nav className="header-nav">
        {NAV_ITEMS.map(item => (
          <Link key={item.page} to={item.to} className={`nav-link${item.page === activePage ? ' active' : ''}`}>
            {item.label}
          </Link>
        ))}
        <Link to="/marketplace" className="nav-link" style={{ fontSize: '0.85rem' }}>
          Marketplace
        </Link>
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
