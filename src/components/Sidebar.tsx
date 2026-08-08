import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useWorkspace } from '../hooks/useWorkspace';
import { useTheme } from '../hooks/useTheme';
import { api, onApiMutation } from '../lib/api';
import { Logo } from './Logo';

export function Sidebar({ className = '' }: { className?: string }) {
  const { user, logout } = useAuth();
  const { workspace, allWorkspaces, switchWorkspace, wsPath, error } = useWorkspace(!!user);
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, cycleTheme } = useTheme();
  const [workspaceNavOpen, setWorkspaceNavOpen] = useState(true);
  const [usdcEnabled, setUsdcEnabled] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);

  // Personal drag-to-reorder of the workspace list. `localOrder` is the ordered
  // list of ids the user has dragged this session; it overrides the API order
  // optimistically (the list refetch on switch returns the same persisted order,
  // so there is no flash back). New/removed workspaces are reconciled below.
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const displayWorkspaces = useMemo(() => {
    if (!localOrder) return allWorkspaces;
    const byId = new Map(allWorkspaces.map(w => [w.id, w]));
    const known = new Set(localOrder);
    const ordered = localOrder.map(id => byId.get(id)).filter((w): w is typeof allWorkspaces[number] => Boolean(w));
    const extra = allWorkspaces.filter(w => !known.has(w.id));
    return [...ordered, ...extra];
  }, [allWorkspaces, localOrder]);

  const reorderWorkspaces = (sourceId: string, targetId: string) => {
    if (!sourceId || sourceId === targetId) return;
    const ids = displayWorkspaces.map(w => w.id);
    const from = ids.indexOf(sourceId);
    if (from < 0 || ids.indexOf(targetId) < 0) return;
    ids.splice(from, 1);
    ids.splice(ids.indexOf(targetId), 0, sourceId); // drop source just above the target
    setLocalOrder(ids);
    api.reorderWorkspaces(ids).catch(err => console.error('Failed to persist workspace order', err));
  };

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
    const load = () => {
      api.getParticipant()
        .then(p => { if (!cancelled) setBalance((p as { balance?: number }).balance ?? null); })
        .catch(err => console.error('Failed to load participant balance', err));
    };
    load();
    // Credits move through mutating API calls (trades, liquidity top-ups,
    // proposal subsidies), so refetch right after any of them instead of
    // waiting for a route change. Debounced to coalesce mutation bursts.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = onApiMutation(() => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    });
    return () => { cancelled = true; clearTimeout(timer); unsubscribe(); };
  }, [user, location.pathname]);

  const currentPath = location.pathname;
  const canAccessWorkspace = workspace?.tier && workspace.tier !== 'none';
  const isAdmin = workspace?.tier === 'admin';
  // Trader-first (vision.md, 2026-08-08): a trader's subnav leads with the
  // tradeable surfaces and hides owner plumbing entirely (sources, check-in,
  // participants, settings). Admins keep the full management order.
  const workspaceLinks = isAdmin
    ? [
        { tab: 'metrics', label: 'Metrics' },
        { tab: 'check-in', label: 'Check-in' },
        { tab: 'proposals', label: 'Proposals' },
        { tab: 'markets', label: 'Markets' },
        { tab: 'participants', label: 'Participants' },
        { tab: 'sources', label: 'Sources' },
        { tab: 'activity', label: 'Activity' },
        { tab: 'settings', label: 'Settings' },
      ]
    : [
        { tab: 'markets', label: 'Markets' },
        { tab: 'proposals', label: 'Proposals' },
        { tab: 'metrics', label: 'Metrics' },
        { tab: 'activity', label: 'Activity' },
      ];
  const WORKSPACE_TABS = ['overview', 'metrics', 'check-in', 'proposals', 'markets', 'participants', 'sources', 'activity', 'settings'];
  // A workspace tab is the last path segment in both the flat (/metrics) and
  // namespaced (/{owner}/{slug}/metrics) forms.
  const currentTab = currentPath.split('/').filter(Boolean).pop() ?? '';
  const onWorkspacePath = WORKSPACE_TABS.includes(currentTab);

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
          {displayWorkspaces.map(ws => {
            const isSelected = ws.id === workspace?.workspaceId;
            const showSubnav = isSelected && workspaceNavOpen;
            const draggable = displayWorkspaces.length > 1;
            return (
              <div
                key={ws.id}
                className={`sidebar-workspace-group${dragOverId === ws.id ? ' drag-over' : ''}${dragId.current === ws.id ? ' dragging' : ''}`}
                draggable={draggable}
                onDragStart={e => {
                  dragId.current = ws.id;
                  e.dataTransfer.effectAllowed = 'move';
                  // Some browsers require data to be set for the drag to start.
                  e.dataTransfer.setData('text/plain', ws.id);
                }}
                onDragOver={e => {
                  if (!dragId.current || dragId.current === ws.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  if (dragOverId !== ws.id) setDragOverId(ws.id);
                }}
                onDragLeave={() => { if (dragOverId === ws.id) setDragOverId(null); }}
                onDrop={e => {
                  e.preventDefault();
                  if (dragId.current) reorderWorkspaces(dragId.current, ws.id);
                  dragId.current = null;
                  setDragOverId(null);
                }}
                onDragEnd={() => { dragId.current = null; setDragOverId(null); }}
              >
                <button
                  className={`sidebar-nav-item sidebar-workspace-name${isSelected ? ' selected' : ''}${isSelected && currentTab === 'overview' ? ' active' : ''}`}
                  onClick={() => {
                    if (isSelected) {
                      if (canAccessWorkspace) navigate(wsPath('overview'));
                      return;
                    }
                    setWorkspaceNavOpen(true);
                    // Navigate straight to the clicked workspace's namespaced
                    // URL (we already have its owner/slug), so we don't bounce
                    // through the flat redirector.
                    const target = ws.ownerHandle && ws.slug
                      ? `/${encodeURIComponent(ws.ownerHandle)}/${encodeURIComponent(ws.slug)}/overview`
                      : (onWorkspacePath ? undefined : '/metrics');
                    switchWorkspace(ws.id, target);
                  }}
                >
                  <span>{ws.name}</span>
                  {isSelected && canAccessWorkspace && (
                    <span
                      className="sidebar-workspace-toggle"
                      aria-label={workspaceNavOpen ? 'Collapse workspace nav' : 'Expand workspace nav'}
                      role="button"
                      tabIndex={0}
                      onClick={e => { e.stopPropagation(); setWorkspaceNavOpen(open => !open); }}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          e.stopPropagation();
                          setWorkspaceNavOpen(open => !open);
                        }
                      }}
                      style={{ cursor: 'pointer' }}
                    >
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
                        key={link.tab}
                        to={wsPath(link.tab)}
                        data-tour-id={`nav-${link.tab}`}
                        className={`sidebar-nav-item sidebar-subnav-item${currentTab === link.tab ? ' active' : ''}`}
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {workspace?.platformAdmin ? (
            <Link to="/create-workspace" className="sidebar-nav-item sidebar-nav-muted">
              + Create workspace
            </Link>
          ) : (
            <Link to="/manage" className="sidebar-nav-item sidebar-nav-muted">
              Run your own workspace →
            </Link>
          )}
        </div>
      )}

      <div className="sidebar-section">
        <div className="sidebar-section-label">Platform</div>
        <Link to="/marketplace" data-tour-id="nav-marketplace" className={`sidebar-nav-item${currentPath === '/marketplace' ? ' active' : ''}`}>
          Marketplace
        </Link>
        <Link to="/leaderboard" data-tour-id="nav-leaderboard" className={`sidebar-nav-item${currentPath === '/leaderboard' ? ' active' : ''}`}>
          Leaderboard
        </Link>
        <Link to="/api-access" data-tour-id="nav-api-access" className={`sidebar-nav-item${currentPath === '/api-access' ? ' active' : ''}`}>
          API
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
        <Link to="/guides" data-tour-id="nav-guides" className={`sidebar-nav-item${currentPath === '/guides' ? ' active' : ''}`}>
          Guides
        </Link>
        {workspace?.platformAdmin && (
          <Link to="/agents" className={`sidebar-nav-item${currentPath.startsWith('/agents') ? ' active' : ''}`}>
            Agents
          </Link>
        )}
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
