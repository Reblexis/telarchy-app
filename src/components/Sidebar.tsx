import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace, error } = useWorkspace(user);
  const location = useLocation();
  const navigate = useNavigate();

  const currentPath = location.pathname;
  const canAccessWorkspace = workspace?.tier && workspace.tier !== 'none';
  const isAdmin = workspace?.tier === 'admin';

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <img src="/logo_transparent_bg.png" alt="Telarchy" style={{ height: '3rem' }} />
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
            const isActive = ws.id === workspace?.workspaceId;
            return (
              <div key={ws.id}>
                <button
                  className={`sidebar-nav-item${isActive ? ' active' : ''}`}
                  onClick={() => switchWorkspace(ws.id)}
                >
                  {ws.name}
                </button>
                {isActive && (
                  <div style={{ padding: '0 1rem 0.35rem', fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ws.id}
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

      {canAccessWorkspace && (
        <div className="sidebar-section">
          <div className="sidebar-section-label">Workspace</div>
          <Link to="/metrics" className={`sidebar-nav-item${currentPath === '/metrics' ? ' active' : ''}`}>
            Metrics
          </Link>
          <Link to="/markets" className={`sidebar-nav-item${currentPath === '/markets' ? ' active' : ''}`}>
            Markets
          </Link>
          <Link to="/tasks" className={`sidebar-nav-item${currentPath === '/tasks' ? ' active' : ''}`}>
            Tasks
          </Link>
          <Link to="/agents" className={`sidebar-nav-item${currentPath === '/agents' ? ' active' : ''}`}>
            Agents
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
        <Link to="/guides" className={`sidebar-nav-item${currentPath === '/guides' ? ' active' : ''}`}>
          Guides
        </Link>
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-bottom">
        {canAccessWorkspace && isAdmin && (
          <Link to="/settings" className={`sidebar-nav-item${currentPath === '/settings' ? ' active' : ''}`}>
            Settings
          </Link>
        )}
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
              <div style={{ fontSize: '0.8rem', color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.email}
              </div>
              <div style={{ fontSize: '0.7rem', fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: '0.15rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.uid}
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
