import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { InspectModeProvider, useInspectMode } from './hooks/useInspectMode';
import { RequireAuth, RequireWorkspace } from './components/RequireAuth';
import { LandingPage } from './pages/LandingPage';
import { SetupPage } from './pages/SetupPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CreateWorkspacePage } from './pages/CreateWorkspacePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { MetricsPage } from './pages/MetricsPage';
import { AgentsPage } from './pages/AgentsPage';
import { MarketsPage } from './pages/MarketsPage';
import { TasksPage } from './pages/TasksPage';
import { WaitlistPage } from './pages/WaitlistPage';
import { StartPage } from './pages/StartPage';
import { AdminPage } from './pages/AdminPage';

function InspectBanner() {
  const { inspectTask, setInspectTask } = useInspectMode();
  if (!inspectTask) return null;
  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000,
      background: '#7c3aed', color: '#fff',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem',
      padding: '0.5rem 1rem', fontSize: '0.875rem',
    }}>
      <span>Inspecting: <strong>{inspectTask.title}</strong> — Metrics and Markets show conditional predictions</span>
      <Link to="/tasks" style={{ color: '#e9d5ff', textDecoration: 'underline', fontSize: '0.8rem' }}>Back to Tasks</Link>
      <button
        onClick={() => setInspectTask(null)}
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: '0.25rem', padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}
      >
        Exit Inspect
      </button>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <InspectModeProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/setup" element={<SetupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/marketplace" element={<MarketplacePage />} />
          <Route path="/waitlist" element={<WaitlistPage />} />
          {/* Requires login, but not a workspace */}
          <Route element={<RequireAuth />}>
            <Route path="/start" element={<StartPage />} />
            <Route path="/create-workspace" element={<CreateWorkspacePage />} />
            <Route path="/agents" element={<AgentsPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
          {/* Requires login + an active workspace */}
          <Route element={<RequireWorkspace />}>
            <Route path="/settings" element={<WorkspaceSettingsPage />} />
            <Route path="/metrics" element={<MetricsPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/tasks" element={<TasksPage />} />
          </Route>
        </Routes>
        <InspectBanner />
      </InspectModeProvider>
    </BrowserRouter>
  );
}
