import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTheme } from '../hooks/useTheme';
import { api } from '../lib/api';
import { Logo } from './Logo';

export function Sidebar({ className = '' }: { className?: string }) {
  const { user, logout } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace, error } = useWorkspace(!!user);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, cycleTheme } = useTheme();
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(true);
  const [usdcEnabled, setUsdcEnabled] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    fetch('/api/public-config')
      .then(r => r.json())
      .then(s => setUsdcEnabled(Boolean((s as { usdcSettlementEnabled?: boolean }).usdcSettlementEnabled)))
      .catch(err => console.error('Failed to load public config for settlement flag', err));
  }, [user]);

  useEffect(() => {
    if (!user) { setBalance(null); return; }
    let cancelled = false;
    api.getParticipant()
      .then(p => { if (!cancelled) setBalance((p as { balance?: number }).balance ?? null); })
      .catch(err => console.error('Failed to load participant balance', err));
    return () => { cancelled = true; };
  }, [user, location.pathname]);

  const currentPath = location.pathname;
  const canAccessWorkspace = workspace?.tier && workspace.tier !== 'none';
  const isAdmin = workspace?.tier === 'admin';
  const workspaceLinks = [
    { to: '/metrics', label: 'Metrics' },
    ...(isAdmin ? [{ to: '/check-in', label: 'Check-in' }] : []),
    { to: '/tasks', label: 'Tasks' },
    { to: '/markets', label: 'Markets' },
    ...(isAdmin ? [{ to: '/participants', label: 'Participants' }] : []),
    { to: '/sources', label: 'Sources' },
    ...(isAdmin ? [{ to: '/settings', label: 'Settings' }] : []),
  ];
  const workspacePaths = ['/metrics', '/check-in', '/tasks', '/markets', '/participants', '/sources', '/settings'];
  const onWorkspacePath = workspacePaths.includes(currentPath);

  useEffect(() => {
    setWorkspaceNavOpen(true);
  }, [workspace?.workspaceId]);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className={`sidebar ${className}`.trim()}>
      <div className="sidebar-logo">
        <Logo variant="lockup" height="2.5rem" />
      </div>

      {error && (
        <div className="sidebar-section" style={{ color: 'var(--error-text)', fontSize: '0.8rem', padding: '0.5rem 1rem' }}>
          Failed to load workspace
        </div>
      )}

      {allWorkspaces.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-label">Workspaces</div>
          {allWorkspaces.map(ws => {
            const isSelected = ws.id === workspace?.workspaceId;
            const showSubnav = isSelected && workspaceNavOpen;
            return (
              <div key={ws.id} className="sidebar-workspace-group">
                <button
                  className={`sidebar-nav-item${isSelected ? ' selected' : ''}`}
                  onClick={() => {
                    if (isSelected) {
                      setWorkspaceNavOpen(open => !open);
                      return;
                    }
                    setWorkspaceNavOpen(true);
                    switchWorkspace(ws.id, onWorkspacePath ? undefined : '/metrics');
                  }}
                >
                  <span>{ws.name}</span>
                  {isSelected && canAccessWorkspace && (
                    <span className="sidebar-workspace-toggle" aria-hidden="true">
                      {workspaceNavOpen ? '▾' : '▸'}
                    </span>
                  )}
                </button>
                {showSubnav && (
                  <div className="sidebar-workspace-subnav">
                    {isAdmin && isSelected && (
                      <div className="sidebar-workspace-id">{ws.id}</div>
                    )}
                    {canAccessWorkspace && workspaceLinks.map(link => (
                      <Link
                        key={link.to}
                        to={link.to}
                        className={`sidebar-nav-item sidebar-subnav-item${currentPath === link.to ? ' active' : ''}`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <Link to="/create-workspace" className="sidebar-nav-item sidebar-nav-muted">
            + Create workspace
          </Link>
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-section-label">Platform</div>
        <Link to="/marketplace" className={`sidebar-nav-item${currentPath === '/marketplace' ? ' active' : ''}`}>
          Marketplace
        </Link>
        <Link to="/account" className={`sidebar-nav-item${currentPath === '/account' ? ' active' : ''}`}>
          Account
        </Link>
        {usdcEnabled && (
          <Link
            to="/account#top-up-credits"
            className="sidebar-nav-item sidebar-nav-muted"
            style={{ fontSize: '0.8rem', paddingTop: '0.15rem', paddingBottom: '0.35rem' }}
          >
            Top up credits (USDC)
          </Link>
        )}
        <Link to="/guides" className={`sidebar-nav-item${currentPath === '/guides' ? ' active' : ''}`}>
          Guides
        </Link>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-bottom">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.5rem 1rem', fontSize: '0.7rem' }}>
          <Link to="/terms" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>Terms</Link>
          <Link to="/privacy" style={{ color: 'var(--text-tertiary)', textDecoration: 'none' }}>Privacy</Link>
          <button
            className="theme-toggle"
            onClick={cycleTheme}
            title={`Theme: ${theme} (click to cycle)`}
            aria-label={`Theme: ${theme}. Click to cycle.`}
            style={{ marginLeft: 'auto' }}
          >
            {theme === 'light' ? '☀' : theme === 'dark' ? '☾' : '◐'}
          </button>
        </div>
        {user && (
          <>
            <Link
              to="/account"
              style={{
                display: 'block',
                padding: '0.6rem 1rem',
                textDecoration: 'none',
                borderTop: '1px solid var(--border-color)',
                marginTop: '0.25rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                  {user.name || user.email}
                </div>
                <div style={{ fontFamily: 'monospace', fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {balance == null ? '…' : balance.toFixed(2)}
                  <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--text-tertiary)', marginLeft: '0.25rem' }}>cr</span>
                </div>
              </div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
            </Link>
            <button className="sidebar-nav-item sidebar-nav-logout" onClick={handleLogout}>
              Logout
            </button>
          </>
        )}
      </div>
    </aside>
  );
}
