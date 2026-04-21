import { type ReactNode, useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Logo } from './Logo';

type Page = 'metrics' | 'agents' | 'markets' | 'tasks';

type NavItem = { to: string; label: string; page?: Page };

const CREATOR_NAV: NavItem[] = [
  { to: '/metrics', label: 'Metrics',   page: 'metrics' },
  { to: '/markets', label: 'Markets',   page: 'markets' },
  { to: '/tasks',   label: 'Tasks',     page: 'tasks'   },
  { to: '/agents',  label: 'Agents',    page: 'agents'  },
];

const OPERATOR_NAV: NavItem[] = [
  { to: '/agents',      label: 'My Agents',    page: 'agents' },
  { to: '/agent-login', label: 'API Key Portal' },
];

const AGENT_NAV: NavItem[] = [];

const PLATFORM_NAV: NavItem[] = [];

export interface HeaderProps {
  activePage?: Page;
  /** 'creator' = workspace owner nav; 'operator' = participant tooling nav; 'agent' = API-key portal nav; 'platform' = platform-admin pages (no workspace tabs or switcher). Defaults to 'creator'. */
  navMode?: 'creator' | 'operator' | 'agent' | 'platform';
  actions?: ReactNode;
  /** If provided, displays the workspace name (fallback when workspaces list not supplied). */
  workspaceName?: string;
  /** Whether to show the workspace settings gear link. */
  showSettings?: boolean;
  /** All workspaces the user belongs to. */
  workspaces?: { id: string; name: string }[];
  /** Currently active workspace ID. */
  activeWorkspaceId?: string;
  /** Called when the user selects a different workspace. */
  onWorkspaceSwitch?: (id: string) => void;
  /** Agent ID to display in agent nav mode. */
  agentId?: string;
}

export const OPERATOR_ID = '__operator__';

function WorkspaceSwitcher({ workspaces, activeId, onSwitch }: {
  workspaces: { id: string; name: string }[];
  activeId?: string;
  onSwitch: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const isOperatorMode = activeId === OPERATOR_ID;
  const active = isOperatorMode ? null : (workspaces.find(w => w.id === activeId) ?? workspaces[0]);
  const label = isOperatorMode ? 'My Agents' : (active?.name ?? '-');

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: '0.5rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)',
          padding: '0.45rem 0.75rem',
          cursor: 'pointer',
          color: 'var(--text-primary)',
          fontSize: '0.9rem',
          fontWeight: 600,
          whiteSpace: 'nowrap',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          maxWidth: 220,
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)'; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-color)'; e.currentTarget.style.boxShadow = 'none'; }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <span style={{ fontSize: '0.6rem', color: 'var(--text-tertiary)', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 6px)',
          left: 0,
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          minWidth: 220,
          zIndex: 100,
          overflow: 'hidden',
        }}>
          {workspaces.map(w => (
            <button
              key={w.id}
              onClick={() => { onSwitch(w.id); setOpen(false); }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                width: '100%',
                textAlign: 'left',
                padding: '0.6rem 1rem',
                background: w.id === activeId ? 'var(--bg-secondary)' : 'none',
                border: 'none',
                borderBottom: '1px solid var(--border-color)',
                cursor: 'pointer',
                fontSize: '0.875rem',
                fontWeight: w.id === activeId ? 600 : 400,
                color: 'var(--text-primary)',
              }}
            >
              {w.name}
              {w.id === activeId && <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>✓</span>}
            </button>
          ))}
          <div style={{ borderTop: '1px solid var(--border-color)', margin: '0.25rem 0' }} />
          <button
            onClick={() => { navigate('/agents?view=operator'); setOpen(false); }}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              width: '100%',
              textAlign: 'left',
              padding: '0.6rem 1rem',
              background: isOperatorMode ? 'var(--bg-secondary)' : 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: '0.875rem',
              fontWeight: isOperatorMode ? 600 : 400,
              color: 'var(--text-secondary)',
            }}
          >
            My Agents
            {isOperatorMode && <span style={{ color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>✓</span>}
          </button>
        </div>
      )}
    </div>
  );
}

export function Header({ activePage, navMode = 'creator', actions, workspaceName, showSettings, workspaces, activeWorkspaceId, onWorkspaceSwitch, agentId }: HeaderProps) {
  const navItems =
    navMode === 'operator' ? OPERATOR_NAV :
    navMode === 'agent' ? AGENT_NAV :
    navMode === 'platform' ? PLATFORM_NAV :
    CREATOR_NAV;
  const hideWorkspaceArea = navMode === 'platform';
  const location = useLocation();
  const navigate = useNavigate();

  const agentArea: ReactNode = agentId ? (
    <span style={{
      fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
      background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md)', padding: '0.45rem 0.75rem',
      fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
    }}>
      {agentId}
    </span>
  ) : null;

  let workspaceArea: ReactNode = null;
  if (workspaces !== undefined) {
    if (workspaces.length > 1 && onWorkspaceSwitch) {
      workspaceArea = (
        <WorkspaceSwitcher workspaces={workspaces} activeId={activeWorkspaceId} onSwitch={onWorkspaceSwitch} />
      );
    } else if (workspaces.length === 1) {
      workspaceArea = (
        <span style={{
          fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
          background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
          borderRadius: 'var(--radius-md)', padding: '0.45rem 0.75rem',
          maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {workspaces[0].name}
        </span>
      );
    } else if (workspaces.length === 0 && location.pathname !== '/create-workspace') {
      workspaceArea = (
        <Link to="/create-workspace" style={{ fontSize: '0.875rem', color: 'var(--focus-border)', textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap' }}>
          + Create workspace
        </Link>
      );
    }
  } else if (workspaceName) {
    workspaceArea = (
      <span style={{
        fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)',
        background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
        borderRadius: 'var(--radius-md)', padding: '0.45rem 0.75rem',
        maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {workspaceName}
      </span>
    );
  }

  return (
    <div className="header">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', alignItems: 'flex-start' }}>
        <Logo variant="lockup" height="3.75rem" />
        {agentArea && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
              Participant
            </span>
            {agentArea}
          </div>
        )}
        {!agentArea && !hideWorkspaceArea && workspaceArea && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
              Workspace
            </span>
            {workspaceArea}
          </div>
        )}
      </div>
      <nav className="header-nav">
        {navItems.map(item => (
          <Link key={item.to} to={item.to} className={`nav-link${item.page === activePage ? ' active' : ''}`}>
            {item.label}
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        {showSettings && (
          <button className="dark-mode-toggle" title="Workspace settings" onClick={() => navigate('/settings')}>⚙</button>
        )}
        {actions}
      </div>
    </div>
  );
}
