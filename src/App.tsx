import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { BetaBanner } from './components/BetaBanner';
import { BuildWatch } from './components/BuildWatch';
import { api } from './lib/api';
import { BASE_PATH } from './lib/base-path';
import { pickDefaultFloor } from './lib/floors';
import { lazyPage } from './lib/lazy-page';
import { popStashedNextPath } from './lib/nextPath';
import { captureRefFromLocation } from './lib/ref';
import { FloorsPage } from './pages/FloorsPage';
/* Eager: the two first-paint routes. `/` is the list, `/:slug` is the floor;
   between them they are what nearly every visitor lands on, so their code
   belongs in the entry bundle. */
import { TradePage } from './pages/TradePage';

/* Lazy: everything else splits into per-route chunks (2026-08-20). The entry
   bundle was 615 KB with every page in it, so a phone visitor downloaded the
   admin cockpit and the markdown pipeline (react-markdown, in four of these
   pages) to look at one market. lazy-page.tsx also owns the deploy-rotated-
   chunk failure mode. */
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const SignupPage = lazyPage(() => import('./pages/SignupPage'), 'SignupPage');
const WaitlistPage = lazyPage(() => import('./pages/WaitlistPage'), 'WaitlistPage');
const LeaderPage = lazyPage(() => import('./pages/LeaderPage'), 'LeaderPage');
const AnnouncementsPage = lazyPage(() => import('./pages/AnnouncementsPage'), 'AnnouncementsPage');
const FundingPage = lazyPage(() => import('./pages/FundingPage'), 'FundingPage');
const SeasonPage = lazyPage(() => import('./pages/SeasonPage'), 'SeasonPage');
const EarnPage = lazyPage(() => import('./pages/EarnPage'), 'EarnPage');
const ParticipantProfilePage = lazyPage(() => import('./pages/ParticipantProfilePage'), 'ParticipantProfilePage');
const AdminPage = lazyPage(() => import('./pages/AdminPage'), 'AdminPage');
const DataRoomPage = lazyPage(() => import('./pages/DataRoomPage'), 'DataRoomPage');
const LegalPage = lazyPage(() => import('./pages/LegalPage'), 'LegalPage');
const AboutPage = lazyPage(() => import('./pages/AboutPage'), 'AboutPage');
const ContactPage = lazyPage(() => import('./pages/ContactPage'), 'ContactPage');
const AudiencePage = lazyPage(() => import('./pages/AudiencePage'), 'AudiencePage');
const GuidesPage = lazyPage(() => import('./pages/GuidesPage'), 'GuidesPage');

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

// /account lands on the instance's first public floor (docs/vision.md,
// "Self-hosting"): the managed instance's is LookPilot today, a self-hosted
// instance's is whatever it lists first, and an instance with none goes to /floors.
function AccountRedirect() {
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    api
      .getMarketplace(1)
      .then(list => setTarget(pickDefaultFloor(list)))
      .catch(() => setTarget('/floors'));
  }, []);
  if (!target) return null;
  return <Navigate to={`${target}#account`} replace />;
}

/**
 * Put someone back where they were after an OAuth round trip.
 *
 * The stash has existed since signup did, and nothing ever read it: OAuth
 * leaves for the provider and comes back to `callbackURL: '/'`, so anyone who
 * signed in with Google from a market, a season entry or a half-finished
 * setup landed on the home page with no way back to what they were doing
 * (owner direction 2026-08-24: "if i sign up from there it shouldnt
 * disappear"). Email signup never had the problem, which is why it went
 * unnoticed.
 *
 * Only fires where OAuth actually lands, so a normal visit to the home page
 * never redirects, and pops the value so a later visit does not either.
 */
function ResumeAfterOAuth() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== '/') return;
    const next = popStashedNextPath();
    if (next && next !== '/') navigate(next, { replace: true });
  }, [pathname, navigate]);
  return null;
}

export function App() {
  // Attribution: a `?ref=<slug>` on any landing URL is kept for 30 days so the
  // signup that follows can say where it came from (src/lib/ref.ts).
  useEffect(() => {
    captureRefFromLocation();
  }, []);
  return (
    <BrowserRouter basename={BASE_PATH || '/'}>
      <ResumeAfterOAuth />
      {/* Renders nothing on telarchy.com. Anywhere else, it says so, and
          carries the Publish button. */}
      <BetaBanner />
      {/* Every page, not just the floor: a tab left open across a Publish
          catches up on its own (docs/infra/deploy.md, "A tab that is already
          open picks the new build up"). */}
      <BuildWatch />
      <Routes>
        {/* The market list IS the home page (owner direction 2026-08-20).
            telarchy.com used to bounce straight to one company's market,
            which told a first-time visitor that Telarchy was that company. */}
        <Route path="/" element={<FloorsPage />} />

        {/* The doors */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route path="/waitlist" element={<WaitlistPage />} />
        {/* The operator door is retired (owner decision 2026-09-01:
          "the management happens from the workspace itself directly now").
          Creating a floor is a dialog on the home page and everything after
          it is on the floor, so this route only catches links already
          printed elsewhere. */}
        <Route path="/manage" element={<Navigate to="/" replace />} />

        {/* The story and the door to a human (owner ask 2026-08-21). Copy is
            canonical in docs/about-page.md. */}
        <Route path="/about" element={<AboutPage />} />
        <Route path="/contact" element={<ContactPage />} />
        {/* The guides have been served at /api/guides and advertised in the
            sitemap and llms.txt since long before they had a page; without
            these routes /guides fell through to /:slug and told a visitor
            there was no market at that address. */}
        <Route path="/guides" element={<GuidesPage />} />
        <Route path="/guides/:section" element={<GuidesPage />} />
        {/* The audience pages: copy in docs/audience-pages.md, one component,
            seven routes. They sit above /:slug so a workspace named "owners"
            can never shadow them (the server reserves the names too). */}
        {[
          '/forecast',
          '/for-agents',
          '/owners',
          '/compare/manifold',
          '/compare/polymarket',
          '/compare/metaculus',
          '/compare/futarchy-fi',
        ].map(r => (
          <Route key={r} path={r} element={<AudiencePage route={r} />} />
        ))}

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

        {/* No /beta route: on telarchy.com the server owns that prefix and
            forwards it to the build waiting to be published (owner ask
            2026-08-20, functions/src/lib/beta-surface.ts). The beta is a whole
            app served under /beta, not a page inside this one. */}

        {/* Operator switch, linked from nowhere. */}

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
        {/* How credits are earned, read from the live earn table so the page
            and the code can never disagree (owner ask 2026-08-30). */}
        <Route path="/earn" element={<EarnPage />} />
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
        <Route path="/account" element={<AccountRedirect />} />

        {/* telarchy.com/<slug> is a market. Last, so every named route above
            wins over a workspace that happens to share its name. */}
        <Route path="/:slug/announcements" element={<AnnouncementsPage />} />
        {/* Where money enters one floor (docs/liquidity-purchases.md). Above
            /:slug so a workspace named "funding" cannot swallow it. */}
        <Route path="/:slug/funding" element={<FundingPage />} />
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
