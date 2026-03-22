import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';

export function Sidebar() {
  const { user, logout } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace } = useWorkspace(user);
  const location = useLocation();
  const navigate = useNavigate();

  const currentPath = location.pathname;
  const inWorkspace = workspace?.workspaceId && workspace.workspaceId !== 'default';
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

      {allWorkspaces.length > 0 && (
        <div className="sidebar-section">
          <div className="sidebar-section-label">Workspaces</div>
          {allWorkspaces.map(ws => (
            <button
              key={ws.id}
              className={`sidebar-nav-item${ws.id === workspace?.workspaceId ? ' active' : ''}`}
              onClick={() => switchWorkspace(ws.id)}
            >
              {ws.name}
            </button>
          ))}
          <Link to="/create-workspace" className="sidebar-nav-item sidebar-nav-muted">
            + Create workspace
          </Link>
        </div>
      )}

      {inWorkspace && (
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
      </div>

      <div className="sidebar-spacer" />

      <div className="sidebar-bottom">
        {inWorkspace && isAdmin && workspace?.workspaceId !== 'default' && (
          <Link to="/settings" className={`sidebar-nav-item${currentPath === '/settings' ? ' active' : ''}`}>
            Settings
          </Link>
        )}
        {user && (
          <button className="sidebar-nav-item sidebar-nav-logout" onClick={handleLogout}>
            Logout
          </button>
        )}
      </div>
    </aside>
  );
}
