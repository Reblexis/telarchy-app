import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { WaitlistPage } from './pages/WaitlistPage';
import { LegalPage } from './pages/LegalPage';
import { TradePage } from './pages/TradePage';
import { FloorsPage } from './pages/FloorsPage';
import { LeaderPage } from './pages/LeaderPage';
import { AnnouncementsPage } from './pages/AnnouncementsPage';
import { SeasonPage } from './pages/SeasonPage';
import { ManagePage } from './pages/ManagePage';
import { ParticipantProfilePage } from './pages/ParticipantProfilePage';
import { AdminPage } from './pages/AdminPage';
import { DataRoomPage } from './pages/DataRoomPage';
import { BetaPage } from './pages/BetaPage';
import { BetaBanner } from './components/BetaBanner';

/* The whole app is the public surface (owner decision 2026-08-19: get rid of
   the old GUI). Every route below renders a standalone `.pubws` page. There
   is no app shell, no sidebar, no workspace tabs, no alpha wall and no
   console, because there is no second design language left to hide: the
   console (AppLayout, the nine workspace tabs, /agents, the guides, the
   tutorial engine, the agent portal) was DELETED rather than curtained
   off. /admin went with it and came back on 2026-08-19, rewritten in this
   language, sharing no code with the page it replaces. Git history is its archive; every API endpoint it drove is still
   live, so the operator drives those by hand until a surface for them is
   rebuilt in this language. See docs/ui-conventions.md. */

// The public floor telarchy.com IS: the root, and anything unrecognised,
// land here. One company for now; a list when there are more.
const DEFAULT_FLOOR = '/lookpilot';

/** telarchy.com/local hops to the dev server (owner ask 2026-08-11): a
    muscle-memory shortcut for iterating, carrying the rest of the path
    (/local/leaderboard -> localhost/leaderboard). Works only where a dev
    server runs, which is the point; for anyone else it just fails to
    connect on their own machine. */
function LocalRedirect() {
  useEffect(() => {
    const rest = window.location.pathname.replace(/^\/local\/?/, '');
    window.location.replace(`http://localhost:5173/${rest || DEFAULT_FLOOR.slice(1)}${window.location.search}`);
  }, []);
  return null;
}

export function App() {
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
      {/* Renders nothing on telarchy.com. Anywhere else, it says so, and
          carries the Publish button. */}
      <BetaBanner />
      <Routes>
        {/* The market list IS the home page (owner direction 2026-08-20).
            telarchy.com used to bounce straight to one company's market,
            which told a first-time visitor that Telarchy was that company. */}
        <Route path="/" element={<FloorsPage />} />

        {/* The doors */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        <Route path="/manage" element={<ManagePage />} />

        {/* Legal, served as markdown by the API */}
        <Route path="/terms" element={<LegalPage document="terms" />} />
        <Route path="/privacy" element={<LegalPage document="privacy" />} />
        {/* A season's published rules: what makes the contest a skill contest
            rather than an ad-hoc payout. Linked from the standings and the
            entry toggle. */}
        <Route path="/legal/season-0" element={<LegalPage document="season-0" />} />
        {/* The season was called Season 1 until 2026-08-19. The old rules URL
            keeps working, because a rules link that has been quoted anywhere
            must not 404. */}
        <Route path="/legal/season-1" element={<LegalPage document="season-1" />} />

        {/* The owner's cockpit: traffic, signups, the waitlist and the
            reports. Platform-admin only, gated server-side on every endpoint
            it reads; anyone else lands on the floor the way an unrecognised
            URL does, so the page never announces itself. Rebuilt in the
            floor's language 2026-08-19 (docs/ui-conventions.md, "The
            cockpit") rather than restored from the deleted console. */}
        <Route path="/admin" element={<AdminPage />} />

        {/* The door to the build waiting to be published (owner ask
            2026-08-20). Platform-admin only; anyone else lands on the market
            list, so the page never announces that a beta exists. */}
        <Route path="/beta" element={<BetaPage />} />

        {/* Operator switch, linked from nowhere. */}
        <Route path="/local" element={<LocalRedirect />} />
        <Route path="/local/*" element={<LocalRedirect />} />

        {/* The floor and the ways around it */}
        {/* Was the home of this page until 2026-08-20. Kept as a redirect
            rather than deleted: the URL has been shared. */}
        <Route path="/marketplace" element={<Navigate to="/" replace />} />
        {/* A shared workspace link renders the real market page rather than
            bouncing into the list with the search box pre-filled. */}
        <Route path="/marketplace/:workspaceId" element={<TradePage />} />
        <Route path="/marketplace/:workspaceId/announcements" element={<AnnouncementsPage />} />
        <Route path="/leaderboard" element={<LeaderPage />} />
        {/* The prize competition has its own page, so the market page and the
            leaderboard carry one line and a link instead of the whole pitch
            (owner direction 2026-08-19). */}
        <Route path="/season" element={<SeasonPage />} />
        <Route path="/participants/:id" element={<ParticipantProfilePage />} />

        {/* Telarchy's own books: vision, traction, traffic, what shipped and
            what is planned, every figure read live from the same database
            that serves this page (owner ask 2026-08-20). Declared before the
            /:slug route so a workspace can never take the URL.
            Spec: docs/data-room.md. */}
        <Route path="/data-room" element={<DataRoomPage />} />

        {/* The account is a dialog on the floor, not a page (owner direction
            2026-08-19: settings belong in the new account settings). The old
            /account URL still works because notification emails and older
            links point at it: it opens the floor with the dialog up. */}
        <Route path="/account" element={<Navigate to={`${DEFAULT_FLOOR}#account`} replace />} />

        {/* telarchy.com/<slug> is a market. Last, so every named route above
            wins over a workspace that happens to share its name. */}
        <Route path="/:slug/announcements" element={<AnnouncementsPage />} />
        <Route path="/:slug" element={<TradePage />} />

        {/* Anything else, every dead console URL included, is not an error
            page: it is the floor. */}
        {/* An address nobody recognises lands on the whole list, not on one
            company's market. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
