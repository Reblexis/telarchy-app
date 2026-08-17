import { BrowserRouter, Routes, Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { api, setActiveWorkspace } from './lib/api';
import { grantAlphaAccess, hasAlphaAccess, revokeAlphaAccess } from './lib/alpha';
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
import { TradePage } from './pages/TradePage';
import { FloorsPage } from './pages/FloorsPage';
import { LeaderPage } from './pages/LeaderPage';
import { ManagePage } from './pages/ManagePage';

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
    return <Navigate to={`/console/marketplace?workspace=${encodeURIComponent(workspaceId ?? '')}`} replace />;
  }
  return <Navigate to={`/${tab}`} replace />;
}

/* /marketplace is the public floor selection for EVERYONE, admin included
   (owner rule 2026-08-14: nothing public-facing redirects to the old
   console UI). The console keeps its own /console/* URLs, reached on
   purpose from the sidebar or /alpha, never as a side effect of a public
   link. An earlier version bounced admins into the console here; that is
   exactly the behaviour the rule forbids. */

// The public floor telarchy.com IS: root and everything hidden by the
// alpha wall land here. One startup for now; a list when there are more.
const DEFAULT_FLOOR = '/lookpilot';

/** telarchy.com/local hops to the dev server (owner ask 2026-08-11): a
    muscle-memory shortcut for iterating, carrying the rest of the path
    (/local/admin -> localhost/admin). Works only where a dev server
    runs, which is the point; for anyone else it just fails to connect
    on their own machine. */
function LocalRedirect() {
  useEffect(() => {
    const rest = window.location.pathname.replace(/^\/local\/?/, '');
    window.location.replace(`http://localhost:5173/${rest || DEFAULT_FLOOR.slice(1)}${window.location.search}`);
  }, []);
  return null;
}

/** The old console is ADMIN-ONLY (owner direction 2026-08-11,
    tightened from the localStorage curtain of 2026-08-10): every route
    behind this gate verifies the signed-in account is a platform admin,
    every time; anyone else, flag or no flag, lands on the floor. The
    localStorage flag survives only as an optimistic cache that skips the
    blank frame for the operator; it grants nothing by itself. Server-side
    auth on every hidden endpoint still holds regardless. */
function AlphaGate() {
  const [allowed, setAllowed] = useState<boolean | null>(hasAlphaAccess() ? true : null);
  useEffect(() => {
    api.getProfile()
      .then(p => {
        const isAdmin = (p as { platformAdmin?: boolean }).platformAdmin === true;
        if (isAdmin) grantAlphaAccess(); else revokeAlphaAccess();
        setAllowed(isAdmin);
      })
      .catch(() => { revokeAlphaAccess(); setAllowed(false); });
  }, []);
  if (allowed === null) return null;
  return allowed ? <Outlet /> : <Navigate to={DEFAULT_FLOOR} replace />;
}

function AlphaSwitch({ on }: { on: boolean }) {
  if (on) grantAlphaAccess(); else revokeAlphaAccess();
  return <Navigate to={on ? '/console/marketplace' : DEFAULT_FLOOR} replace />;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      <InspectModeProvider>
        <Routes>
          {/* The alpha wall (owner decision 2026-08-10): the public surface
              is the trading floor and the doors into it (login, signup,
              waitlist, legal), nothing else. The root IS the floor. The
              landing page, app shell, console, and account pages stay in
              the tree but render only behind the wall. */}
          <Route path="/" element={<Navigate to={DEFAULT_FLOOR} replace />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/waitlist" element={<WaitlistPage />} />
          <Route path="/terms" element={<LegalPage document="terms" />} />
          <Route path="/privacy" element={<LegalPage document="privacy" />} />
          {/* Operator switch, linked from nowhere. */}
          <Route path="/local" element={<LocalRedirect />} />
          <Route path="/local/*" element={<LocalRedirect />} />
          <Route path="/alpha" element={<AlphaSwitch on />} />
          <Route path="/alpha-off" element={<AlphaSwitch on={false} />} />
          {/* The share-link landing renders standalone: a stranger's first
              screen must be a poster, not an app shell with a sidebar. */}
          <Route path="/marketplace/:workspaceId" element={<TradePage />} />
          {/* The public floor selection, for everyone. */}
          <Route path="/marketplace" element={<FloorsPage />} />
          {/* The public leaderboard, in the market pages' own language. The
              console's own leaderboard lives at /console/leaderboard; no
              public route may land anyone in that UI. */}
          <Route path="/leaderboard" element={<LeaderPage />} />
          {/* Public profiles (owner ask 2026-08-11): a trader's name on the
              floor links here, so the page cannot sit behind the alpha
              wall. Shell-agnostic page; renders bare for visitors. */}
          <Route path="/participants/:id" element={<ParticipantProfilePage />} />
          <Route element={<AlphaGate />}>
          <Route path="/home" element={<LandingPage />} />
          <Route path="/claim" element={<ClaimPage />} />
          {/* Cinematic first-run canvas: full-screen (no sidebar), self-gates auth. */}
          <Route path="/welcome" element={<WelcomePage />} />
          <Route path="/agent-login" element={<AgentLoginPage />} />
          {/* Agent portal: requires agent session (agent ID + API key), not Firebase */}
          <Route element={<RequireAgentSession />}>
            <Route path="/agent" element={<AgentPortalPage />} />
          </Route>
          <Route path="/manage" element={<ManagePage />} />
          <Route element={<AppLayout />}>
            <Route path="/console/marketplace" element={<MarketplacePage />} />
            <Route path="/marketplace/:workspaceId/:tab" element={<MarketplaceTabRedirect />} />
            <Route path="/console/leaderboard" element={<LeaderboardPage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
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
          </Route>
          {/* Root-level slug: telarchy.com/<slug> IS the workspace's trading
              floor (trader-first flip, 2026-08-08). Last so every static
              route above wins; two-segment console routes are unaffected. */}
          <Route path="/:slug" element={<TradePage />} />
        </Routes>
      </InspectModeProvider>
    </BrowserRouter>
  );
}
