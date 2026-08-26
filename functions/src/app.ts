import { toNodeHandler } from 'better-auth/node';
import compression from 'compression';
import type { NextFunction, Request, Response } from 'express';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { auth } from './auth';
import { currentStoreName, runInBetaStore } from './db/client';
import { betaGate } from './lib/beta-gate';
import { handleBetaBranchChoice, isBetaPath, proxyToCandidate } from './lib/beta-surface';
import { corsMiddleware } from './lib/cors';
import { AppError } from './lib/errors';
import { HELP } from './lib/help-catalog';
import { publicOrigins } from './lib/origins';
import { isBetaRequest } from './lib/request-env';
import { requireConsentIfUser } from './middleware/consent';
import { requireCapability } from './middleware/roles';
import { apiAuthPolicy } from './middleware/route-policy';
import { activityRouter } from './routes/activity';
import { adminRouter } from './routes/admin';
import { agentsRouter } from './routes/agents';
import { billingRouter } from './routes/billing';
import { cronRouter } from './routes/cron';
import { dataRoomRouter } from './routes/data-room';
import { eventsRouter } from './routes/events';
import { feedbackRouter } from './routes/feedback';
import { fundingRouter } from './routes/funding';
import { groupsRouter } from './routes/groups';
import { guidesRouter } from './routes/guides';
import { leaderboardRouter } from './routes/leaderboard';
import { legalRouter } from './routes/legal';
import { manifoldRouter } from './routes/manifold';
import { marketplaceRouter } from './routes/marketplace';
import { metricsRouter } from './routes/metrics';
import { notificationsRouter } from './routes/notifications';
import { onboardRouter } from './routes/onboard';
import { predictionsRouter } from './routes/predictions';
import { proposalsRouter } from './routes/proposals';
import { seasonsRouter } from './routes/seasons';
import { setupRouter } from './routes/setup';
import { sourcesRouter } from './routes/sources';
import { systemRouter } from './routes/system';
import { updatesRouter } from './routes/updates';
import { userauthRouter } from './routes/userauth';
import { waitlistRouter } from './routes/waitlist';
import { workspacesRouter } from './routes/workspaces';
import { runningPreviewTag } from './services/release';

export const app = express();

/**
 * Cloud Run fronts every request with exactly one proxy hop (the Google
 * front end), which appends the real client IP to X-Forwarded-For. Trusting
 * that one hop makes req.ip the visitor, not the load-balancer socket.
 * Without it every anonymous visitor shared one rate-limit bucket per
 * instance, so a single scanner could starve all anonymous traffic (and
 * express-rate-limit logged a ValidationError on every boot). A client can
 * prepend forged X-Forwarded-For entries, but with one trusted hop Express
 * reads only the entry the front end itself appended.
 */
app.set('trust proxy', 1);

/**
 * Compress every compressible response: HTML, the ~615 KB JS bundle
 * (~188 KB gzipped), CSS, and all API JSON. Registered before any route or
 * static handler so the whole surface is covered; images and sub-1KB bodies
 * are skipped by the default filter/threshold. Before 2026-08-20 nothing on
 * the site was compressed at all.
 */
app.use(compression());

/**
 * The beta is a full copy of this app, on the production database, at a URL
 * anyone who learns it can open (owner decision 2026-08-20: nothing reaches
 * the public until you press Publish; docs/infra/deploy.md). It must never be
 * the thing a search engine finds when someone looks for Telarchy: a second
 * indexed copy would split every link and could show an unpublished build to
 * strangers.
 *
 * The public origin is whatever ALLOWED_ORIGIN names. Any OTHER host serving
 * this app is by definition not the published site, so it gets noindex. That
 * covers the candidate revision and a preview URL without having to enumerate
 * them.
 */
app.use((req, res, next) => {
  const host = req.headers.host;
  const isPublic = !host || publicOrigins().some(o => o.endsWith(`//${host}`) || o.endsWith(`//www.${host}`));
  // The beta is never indexable, whichever host it is reached on: on the
  // public domain it lives under /beta, and there it is still an unpublished
  // build showing production data.
  if (!isPublic || req.path === '/beta' || req.path.startsWith('/beta/')) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});

app.use(corsMiddleware);
// Payment webhooks verify a signature over the raw body, so the JSON parser
// steps aside for them; routes/billing.ts reads the body raw itself. The
// router is mounted after the policy like every other router.
const jsonBody = express.json();
app.use((req, res, next) => (req.path.startsWith('/api/billing/') ? next() : jsonBody(req, res, next)));

/**
 * Hand the whole beta to the candidate revision, API included.
 *
 * ORDER IS THE FEATURE HERE, and getting it wrong is what shipped on
 * 2026-08-20: the prefix strip below used to run first, so by the time the
 * proxy looked at a request its path was already `/api/...` and no longer
 * recognisable as the beta's. The result was a beta serving the candidate's
 * FRONTEND against the PUBLISHED backend, which is the frontend-only preview
 * this whole thing exists not to be. Proxy first, strip second.
 *
 * After express.json(), because a proxied POST has to carry its body.
 */
/**
 * The beta is admin only (lib/beta-gate.ts; docs/infra/deploy.md, "The beta
 * is admin only"). Before the proxy, so the published revision decides for
 * every build it forwards to, and before the store swap, so the session is
 * read where identity lives.
 */
app.use(betaGate());

app.use(async (req, res, next) => {
  if (!isBetaPath(req.path)) return next();
  // `/beta?branch=br-<name>` picks which build /beta shows; the published
  // revision answers it itself, before forwarding anything (docs/infra/
  // deploy.md, "Branch previews").
  if (handleBetaBranchChoice(req, res)) return;
  if (await proxyToCandidate(req, res)) return;
  // Nothing to forward to (this IS the candidate, or none is waiting): fall
  // through and serve the beta locally.
  next();
});

/**
 * The beta reads and writes its OWN database (owner ask 2026-08-20), and the
 * decision is made here, per request, from the request itself.
 *
 * It must run BEFORE the prefix strip below: afterwards a beta API call looks
 * exactly like a production one, which is the same ordering that made the beta
 * serve the published backend on the day it shipped. It must also run after
 * the proxy above, so a request being forwarded is never counted twice.
 *
 * Everything downstream keeps importing `db` as it always has; the handle
 * resolves per query to whichever store this async context belongs to
 * (db/client.ts). Off Cloud Run, and on any instance without a beta database
 * configured, there is one store and this changes nothing.
 */
app.use((req, res, next) => {
  if (!isBetaRequest(req.path, req.headers.host)) return next();
  runInBetaStore(() => {
    // The stripe on the beta says which store it is on, and a client can read
    // it without a page: an experiment run against the live floor by accident
    // is exactly what this header exists to make visible.
    res.setHeader('X-Telarchy-Store', currentStoreName());
    next();
  });
});

/**
 * `/beta/api/...` is the beta's own API (docs/infra/deploy.md). The beta
 * bundle is built with its API base at /beta, so its calls arrive prefixed;
 * strip it here, once the request is known to be served locally, and every
 * existing endpoint serves the beta unchanged. Mounting a second copy of the
 * API under /beta would be two code paths for one capability, which AGENTS.md
 * forbids for exactly the reason it would bite here: they would drift.
 */
app.use((req, _res, next) => {
  if (req.url === '/beta/api' || req.url.startsWith('/beta/api/') || req.url.startsWith('/beta/api?')) {
    req.url = req.url.slice('/beta'.length);
  }
  next();
});

// Recursively delete a key from an arbitrary JSON value, in place.
function stripKeyDeep(value: unknown, key: string): void {
  if (Array.isArray(value)) {
    for (const v of value) stripKeyDeep(v, key);
    return;
  }
  if (value && typeof value === 'object') {
    delete (value as Record<string, unknown>)[key];
    for (const v of Object.values(value as Record<string, unknown>)) stripKeyDeep(v, key);
  }
}

// Agents read `resolvesOn` (the exact settlement timestamp); `targetDate` is a
// UI-only granularity label that misled agents into reasoning about the period
// ("June") instead of the resolution moment ("2026-07-01T00:00:00Z"), so we
// strip it from agent-key responses. Browser sessions (uid) and unauthenticated
// public/UI callers keep it; master-key operators keep it too. The wrapper is
// installed early but reads req.auth at response time, so it sees the auth each
// router populates regardless of mount order. Agents trade by `marketId` (still
// present) or send their own chosen `targetDate` as a trade/create input — that
// input parsing is unaffected, this only shapes response bodies.
app.use('/api', (req, res, next) => {
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (req.auth?.agentId && !req.auth?.uid) stripKeyDeep(body, 'targetDate');
    return json(body);
  };
  next();
});

// RATE_LIMIT_MAX env var lets self-hosters raise or disable the limit.
// Default: 600/min (generous for single-user; doubled in 2026-Q2 because
// authed normal flows — page load + a few component fetches — were hitting
// the limit during persona-test runs and looking flaky to real users).
// Set to 0 to disable entirely. The global limit is intentionally lax
// because identified callers (master key, agent key, or signed-in session
// cookie) are skipped via `skip` — only anonymous traffic counts.
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '600', 10);

// True if the caller has any auth credential. We can't run authMiddleware
// before the limiter (the limiter runs once per request), so detect by
// header / cookie presence; the actual auth check still happens later.
function hasIdentity(req: { headers: Record<string, unknown>; cookies?: Record<string, unknown> }): boolean {
  if (req.headers['x-api-key']) return true;
  if (req.headers['x-agent-key']) return true;
  if (req.headers['authorization']) return true;
  const cookie = req.headers['cookie'];
  if (typeof cookie === 'string' && /better-auth\.session_token=|__Host-better-auth/i.test(cookie)) return true;
  return false;
}

// Shared by every limiter below. Keying is per client IP via `trust proxy`
// above (X-Forwarded-For's front-end entry); the RFC 7239 `Forwarded` header
// Cloud Run also sends is deliberately ignored, so that validation is off —
// without this each limiter logs a ValidationError stack on first use.
const limiterDefaults = {
  windowMs: 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  validate: { forwardedHeader: false },
} as const;

const globalLimiter = rateLimit({
  ...limiterDefaults,
  max: rateLimitMax || 1_000_000,
  skip: req => hasIdentity(req as unknown as { headers: Record<string, unknown> }),
});

const strictLimiter = rateLimit({
  ...limiterDefaults,
  max: rateLimitMax ? Math.max(Math.floor(rateLimitMax / 4), 10) : 1_000_000,
});

// Registration limit guards against signup-spam from a single IP. The
// historical 5/min was too tight: a parallel test run creating one user
// per spec, or a small team onboarding from one office IP, can reach it
// instantly. 30/min is still low enough to block real abuse and is
// configurable via REGISTRATION_LIMIT_MAX.
const registrationLimitMax = parseInt(process.env.REGISTRATION_LIMIT_MAX ?? '30', 10);
const registrationLimiter = rateLimit({
  ...limiterDefaults,
  max: registrationLimitMax || 1_000_000,
});

// Feedback (the public report-a-bug / feedback button) accepts anonymous
// submissions so a visitor who hit a bug can tell us without an account.
// This per-IP limiter is the anti-spam control for that open door; identified
// callers are attributed and skip it, exactly like the global limiter.
const feedbackLimitMax = parseInt(process.env.FEEDBACK_LIMIT_MAX ?? '20', 10);
const feedbackLimiter = rateLimit({
  ...limiterDefaults,
  max: feedbackLimitMax || 1_000_000,
  skip: req => hasIdentity(req as unknown as { headers: Record<string, unknown> }),
});

// Asking the floor a question spends real money on a model call, so this
// door is narrower than any other public one and does NOT skip identified
// callers: a key holder can spend as fast as an anonymous visitor.
const askLimitMax = parseInt(process.env.ASK_LIMIT_MAX ?? '6', 10);
const askLimiter = rateLimit({
  ...limiterDefaults,
  windowMs: 5 * 60 * 1000,
  max: askLimitMax || 1_000_000,
  message: { error: 'That is a lot of questions. Try again in a few minutes.' },
});

app.use(globalLimiter);

// Throttle account creation so bulk signup farming cannot bypass the global limit.
app.use('/api/auth/sign-up', registrationLimiter);

// Deny by default: every /api request is authenticated here, first, before any
// router. Which paths may answer anonymously is the explicit list in
// middleware/route-policy.ts; everything else is 401 without credentials. Mount
// order no longer decides anything (ARCHITECTURE.md, "Auth: deny by default").
app.use('/api', apiAuthPolicy);

// Our custom /api/auth/* routes (me, profile, export, delete) must be registered
// BEFORE the BetterAuth handler, which never calls next(). The policy resolved
// the session without rejecting, so BetterAuth's own sign-in/sign-up/sign-out
// paths still flow through when the router has no match.
app.use('/api/auth', userauthRouter);

// BetterAuth handles remaining /api/auth/* paths (sign-in, sign-up, session, callback…).
// Must be mounted on a path prefix. toNodeHandler() does not call next(), so
// mounting it globally would swallow all other routes with a 404.
app.all('/api/auth/*', toNodeHandler(auth));

app.use('/api/guides', guidesRouter);
app.use('/api/legal', legalRouter);
app.use('/api/billing', billingRouter);
// Telarchy's own books: prose and every number on the page, in one anonymous
// read. See docs/data-room.md.
app.use('/api/data-room', dataRoomRouter);

app.get('/api/public-config', async (_req, res) => {
  res.json({
    usdcSettlementEnabled: process.env.USDC_SETTLEMENT_ENABLED === 'true',
    // Funding packages (docs/liquidity.md): on telarchy.com switched on when
    // Season 0 ends. The owner surface shows the purchase only when true.
    fundingEnabled: process.env.FUNDING_ENABLED === 'true' && Boolean(process.env.STRIPE_SECRET_KEY),
    // Which store answered this request (owner ask 2026-08-20). The beta
    // stripe says it out loud, because "am I about to write to the live
    // floor" is the one question a tester must never have to guess at.
    store: currentStoreName(),
    // Which branch preview answered, if any: the `br-` tag on this revision,
    // null for the candidate and the published site. The stripe names it.
    preview: await runningPreviewTag(),
  });
});

// Bare probe of the API root. Without this, an unauthenticated GET /api hits
// the auth middleware and dead-ends on 401 with no hint where the docs live,
// which sends agents off to crawl the website instead.
app.get('/api', (_req, res) => {
  res.json({
    app: 'Telarchy',
    help: '/api/help',
    guides: '/api/guides',
    openapi: '/openapi.json',
    llms: '/llms.txt',
  });
});

/**
 * The catalog moved to lib/help-catalog.ts (2026-08-21) so Otto can search the
 * same object this serves. One catalog, one truth about what the API does.
 */
app.get('/api/help', (_req, res) => {
  res.json(HELP);
});

app.use('/api/cron', cronRouter);
app.use('/api/waitlist', registrationLimiter, waitlistRouter);
app.use('/api/import/manifold', registrationLimiter, manifoldRouter);
// Key-first onboarding shares the registration throttle: it mints identities.
app.use('/api/onboard', registrationLimiter, onboardRouter);
// Registering an agent mints an identity with signup credits and a full-scope
// key and auto-joins the Public group, so throttle it per-IP exactly like the
// other identity-minting routes. Otherwise cheap bulk identities defeat the
// per-identity position caps that keep the public floor's markets honest.
app.use('/api/agents/register', registrationLimiter);
app.use('/api/agents', agentsRouter);
app.use('/api/predictions/trade', strictLimiter);
app.use('/api/predictions', predictionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/proposals', proposalsRouter);
app.use(/^\/api\/marketplace\/[^/]+\/ask$/, askLimiter);
app.use('/api/marketplace', marketplaceRouter);
// The operator door's conversation spends the same money as the floor's, so
// it sits behind the same narrow limiter (the operator-door design note).
app.use('/api/setup/ask', askLimiter);
// This door answers an anonymous visitor too, and it needs to KNOW which it is
// talking to, since what Otto may promise depends on whether the caller can act
// at all; the policy resolves credentials without rejecting on this prefix.
app.use('/api/setup', setupRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/seasons', seasonsRouter);
app.use('/api/notifications', requireConsentIfUser, notificationsRouter);
app.use('/api/feedback', feedbackLimiter, feedbackRouter);

// Sources: the GitHub OAuth callback is a redirect from GitHub with no auth
// headers, so this prefix is optional-auth in the policy. Individual routes that
// need auth use requireCapability (which checks the req.auth the policy set).
app.use('/api/sources', requireConsentIfUser, sourcesRouter);

// Routers below were once "behind global auth"; the policy now authenticates
// them like everything else. Consent for browser sessions still applies here.
app.use('/api', requireConsentIfUser);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', requireCapability('manage'), updatesRouter);
app.use('/api/workspaces', fundingRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/activity', activityRouter);
app.use('/api', systemRouter);

app.use('/api', (req: Request, res: Response) => {
  res.status(404).json({ error: 'Not found', path: req.originalUrl });
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  // AppError messages are caller-facing by construction. An unexpected 5xx can
  // carry driver / internal detail (Postgres text, stack context), so return a
  // generic string; the real error is already logged above.
  const message = status >= 500 ? 'Internal error' : err.message;
  res.status(status).json({ error: message, ...extra });
});
