import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

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
  /** All workspaces the user belongs to. When more than one, renders a switcher dropdown. */
  workspaces?: { id: string; name: string }[];
  /** Currently active workspace ID — used as the select value in the switcher. */
  activeWorkspaceId?: string;
  /** Called when the user selects a different workspace from the dropdown. */
  onWorkspaceSwitch?: (id: string) => void;
}

export function Header({ activePage, navMode = 'creator', actions, workspaceName, showSettings, workspaces, activeWorkspaceId, onWorkspaceSwitch }: HeaderProps) {
  const navItems = navMode === 'operator' ? OPERATOR_NAV : CREATOR_NAV;
  const location = useLocation();

  // Workspace area rendering:
  // - workspaces provided + length > 1 → switcher dropdown
  // - workspaces provided + length === 1 → static label (single workspace name)
  // - workspaces provided + length === 0 → "+ Create workspace" link (no workspace yet)
  // - workspaces not provided → fall back to workspaceName prop (static label)
  let workspaceArea: ReactNode = null;
  if (workspaces !== undefined) {
    if (workspaces.length > 1 && onWorkspaceSwitch) {
      workspaceArea = (
        <select
          value={activeWorkspaceId ?? ''}
          onChange={e => onWorkspaceSwitch(e.target.value)}
          style={{
            fontSize: '0.8rem',
            color: 'var(--text-secondary)',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-color)',
            borderRadius: '0.25rem',
            padding: '0.2rem 0.4rem',
            maxWidth: 160,
            cursor: 'pointer',
          }}
        >
          {workspaces.map(w => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
      );
    } else if (workspaces.length === 1) {
      workspaceArea = (
        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {workspaces[0].name}
        </span>
      );
    } else if (workspaces.length === 0 && location.pathname !== '/create-workspace') {
      workspaceArea = (
        <Link to="/create-workspace" style={{ fontSize: '0.8rem', color: 'var(--focus-border)', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
          + Create workspace
        </Link>
      );
    }
  } else if (workspaceName) {
    workspaceArea = (
      <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {workspaceName}
      </span>
    );
  }

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
        {workspaceArea}
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
