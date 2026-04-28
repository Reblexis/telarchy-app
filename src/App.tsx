import { BrowserRouter, Routes, Route, Link, Navigate, useParams } from 'react-router-dom';
import { InspectModeProvider, useInspectMode } from './hooks/useInspectMode';
import { RequireAuth, RequireWorkspace, RequireAgentSession } from './components/RequireAuth';
import { AppLayout } from './components/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CreateWorkspacePage } from './pages/CreateWorkspacePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { MetricsPage } from './pages/MetricsPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { MarketsPage } from './pages/MarketsPage';
import { TasksPage } from './pages/TasksPage';
import { WaitlistPage } from './pages/WaitlistPage';
import { StartPage } from './pages/StartPage';
import { AdminPage } from './pages/AdminPage';
import { AccountPage } from './pages/AccountPage';
import { AgentLoginPage } from './pages/AgentLoginPage';
import { AgentPortalPage } from './pages/AgentPortalPage';
import { GuidesPage } from './pages/GuidesPage';
import { LegalPage } from './pages/LegalPage';
import { SourcesPage } from './pages/SourcesPage';
import { CheckInPage } from './pages/CheckInPage';
import { OverviewPage } from './pages/OverviewPage';
import { ActivityPage } from './pages/ActivityPage';

function MarketplaceWorkspaceRedirect() {
  const { workspaceId } = useParams();
  return <Navigate to={`/marketplace?workspace=${encodeURIComponent(workspaceId ?? '')}`} replace />;
}

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
      <span>Inspecting: <strong>{inspectTask.title}</strong> - showing impact predictions</span>
      <Link to="/tasks" style={{ color: '#e9d5ff', textDecoration: 'underline', fontSize: '0.8rem' }}>Back to Tasks</Link>
      <button
        onClick={() => setInspectTask(null)}
        style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: '#fff', borderRadius: '6px', padding: '0.2rem 0.6rem', cursor: 'pointer', fontSize: '0.8rem' }}
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
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/waitlist" element={<WaitlistPage />} />
          <Route path="/agent-login" element={<AgentLoginPage />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          {/* Agent portal: requires agent session (agent ID + API key), not Firebase */}
          <Route element={<RequireAgentSession />}>
            <Route path="/agent" element={<AgentPortalPage />} />
          </Route>
          {/* Authenticated routes, all wrapped in AppLayout (sidebar) */}
          <Route element={<AppLayout />}>
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/marketplace/:workspaceId" element={<MarketplaceWorkspaceRedirect />} />
            <Route path="/guides" element={<GuidesPage />} />
            <Route path="/guides/:section" element={<GuidesPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/start" element={<StartPage />} />
              <Route path="/create-workspace" element={<CreateWorkspacePage />} />
              <Route path="/participants" element={<ParticipantsPage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/account" element={<AccountPage />} />
            </Route>
            <Route element={<RequireWorkspace />}>
              <Route path="/overview" element={<OverviewPage />} />
              <Route path="/settings" element={<WorkspaceSettingsPage />} />
              <Route path="/check-in" element={<CheckInPage />} />
              <Route path="/metrics" element={<MetricsPage />} />
              <Route path="/markets" element={<MarketsPage />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/sources" element={<SourcesPage />} />
              <Route path="/activity" element={<ActivityPage />} />
            </Route>
          </Route>
        </Routes>
        <InspectBanner />
      </InspectModeProvider>
    </BrowserRouter>
  );
}
