import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { setActiveWorkspace } from './lib/api';
import { InspectModeProvider } from './hooks/useInspectMode';
import { RequireAuth, RequireAgentSession } from './components/RequireAuth';
import { WorkspaceRouteGuard, FlatTabRedirect } from './components/WorkspaceRoute';
import { AppLayout } from './components/AppLayout';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { CreateWorkspacePage } from './pages/CreateWorkspacePage';
import { MarketplacePage } from './pages/MarketplacePage';
import { WorkspaceSettingsPage } from './pages/WorkspaceSettingsPage';
import { MetricsPage } from './pages/MetricsPage';
import { ParticipantsPage } from './pages/ParticipantsPage';
import { ParticipantProfilePage } from './pages/ParticipantProfilePage';
import { MarketsPage } from './pages/MarketsPage';
import { ProposalsPage } from './pages/ProposalsPage';
import { WaitlistPage } from './pages/WaitlistPage';
import { ClaimPage } from './pages/ClaimPage';
import { WelcomePage } from './pages/WelcomePage';
import { StartPage } from './pages/StartPage';
import { AdminPage } from './pages/AdminPage';
import { AgentsPage } from './pages/AgentsPage';
import { AgentDetailPage } from './pages/AgentDetailPage';
import { AccountPage } from './pages/AccountPage';
import { AgentLoginPage } from './pages/AgentLoginPage';
import { AgentPortalPage } from './pages/AgentPortalPage';
import { GuidesPage } from './pages/GuidesPage';
import { TutorialsPage } from './pages/TutorialsPage';
import { LegalPage } from './pages/LegalPage';
import { SourcesPage } from './pages/SourcesPage';
import { CheckInPage } from './pages/CheckInPage';
import { OverviewPage } from './pages/OverviewPage';
import { ActivityPage } from './pages/ActivityPage';
import { ApiPage } from './pages/ApiPage';
import { LeaderboardPage } from './pages/LeaderboardPage';
import { BenchmarkPage } from './pages/BenchmarkPage';
import { PublicWorkspacePage } from './pages/PublicWorkspacePage';

// /marketplace/:workspaceId is the destination for a shared workspace link, so
// it renders a real public workspace page rather than bouncing into the generic
// list with the search box pre-filled. See PublicWorkspacePage for why.

// /marketplace/:workspaceId/:tab — deep-link a workspace into a specific page.
// Sets the active workspace (so /proposals, /markets, etc. find their context)
// then redirects to /<tab>. Used by external links (agent profiles, share URLs).
const ALLOWED_TABS = new Set([
  'overview', 'metrics', 'markets', 'proposals', 'sources',
  'activity', 'settings', 'check-in', 'participants',
]);
function MarketplaceTabRedirect() {
  const { workspaceId, tab } = useParams();
  useEffect(() => {
    if (workspaceId) setActiveWorkspace(workspaceId);
  }, [workspaceId]);
  if (!tab || !ALLOWED_TABS.has(tab)) {
    return <Navigate to={`/marketplace?workspace=${encodeURIComponent(workspaceId ?? '')}`} replace />;
  }
  return <Navigate to={`/${tab}`} replace />;
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
          <Route path="/claim" element={<ClaimPage />} />
          {/* Cinematic first-run canvas: full-screen (no sidebar), self-gates auth. */}
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/agent-login" element={<AgentLoginPage />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          {/* Agent portal: requires agent session (agent ID + API key), not Firebase */}
          <Route element={<RequireAgentSession />}>
            <Route path="/agent" element={<AgentPortalPage />} />
          </Route>
          {/* Authenticated routes, all wrapped in AppLayout (sidebar) */}
          {/* The share-link landing renders standalone: a stranger's first
              screen must be a poster, not an app shell with a sidebar. */}
          <Route path="/marketplace/:workspaceId" element={<PublicWorkspacePage />} />
          <Route element={<AppLayout />}>
            <Route path="/marketplace" element={<MarketplacePage />} />
            <Route path="/marketplace/:workspaceId/:tab" element={<MarketplaceTabRedirect />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/participants/:id" element={<ParticipantProfilePage />} />
            <Route path="/guides" element={<GuidesPage />} />
            <Route path="/guides/:section" element={<GuidesPage />} />
            <Route path="/tutorials" element={<TutorialsPage />} />
            <Route element={<RequireAuth />}>
              <Route path="/start" element={<StartPage />} />
              <Route path="/create-workspace" element={<CreateWorkspacePage />} />
              <Route path="/admin" element={<AdminPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:id" element={<AgentDetailPage />} />
              <Route path="/account" element={<AccountPage />} />
              <Route path="/api-access" element={<ApiPage />} />
            </Route>
            {/* Legacy flat tab paths: redirect to the canonical namespaced URL
                of the active workspace (and keep the old needs-workspace
                redirects). Preserves bookmarks and external/marketplace links. */}
            <Route path="/overview" element={<FlatTabRedirect tab="overview" />} />
            <Route path="/metrics" element={<FlatTabRedirect tab="metrics" />} />
            <Route path="/markets" element={<FlatTabRedirect tab="markets" />} />
            <Route path="/proposals" element={<FlatTabRedirect tab="proposals" />} />
            <Route path="/sources" element={<FlatTabRedirect tab="sources" />} />
            <Route path="/activity" element={<FlatTabRedirect tab="activity" />} />
            <Route path="/settings" element={<FlatTabRedirect tab="settings" />} />
            <Route path="/check-in" element={<FlatTabRedirect tab="check-in" />} />
            <Route path="/participants" element={<FlatTabRedirect tab="participants" />} />
            {/* Canonical GitHub-style workspace routes: /{ownerHandle}/{slug}/<tab> */}
            <Route path="/:owner/:slug" element={<WorkspaceRouteGuard />}>
              <Route path="overview" element={<OverviewPage />} />
              <Route path="metrics" element={<MetricsPage />} />
              <Route path="markets" element={<MarketsPage />} />
              <Route path="proposals" element={<ProposalsPage />} />
              <Route path="sources" element={<SourcesPage />} />
              <Route path="activity" element={<ActivityPage />} />
              <Route path="settings" element={<WorkspaceSettingsPage />} />
              <Route path="check-in" element={<CheckInPage />} />
              <Route path="participants" element={<ParticipantsPage />} />
            </Route>
          </Route>
        </Routes>
      </InspectModeProvider>
    </BrowserRouter>
  );
}
