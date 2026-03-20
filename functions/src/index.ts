import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authMiddleware } from './middleware/auth';
import { requireRole } from './middleware/roles';
import { metricsRouter } from './routes/metrics';
import { updatesRouter } from './routes/updates';
import { systemRouter } from './routes/system';
import { agentsRouter } from './routes/agents';
import { predictionsRouter } from './routes/predictions';
import { eventsRouter } from './routes/events';
import { tasksRouter } from './routes/tasks';
import { waitlistRouter } from './routes/waitlist';
import { workspacesRouter } from './routes/workspaces';
import { userauthRouter } from './routes/userauth';
import { marketplaceRouter } from './routes/marketplace';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './lib/errors';

// If FIREBASE_SERVICE_ACCOUNT is set (base64-encoded service account JSON),
// use it as the credential — allows hosting on a different project than the data.
const serviceAccountEnv = process.env.DATA_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(Buffer.from(serviceAccountEnv, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp();
}

// CORS — only allow requests from known origins.
// ALLOWED_ORIGIN is the production Firebase Hosting domain.
// In development, localhost origins are also permitted.
const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN,              // e.g. https://telarchy-e0043.web.app
  'https://telarchy-e0043.web.app',        // production fallback if env not set
  'https://telarchy-e0043.firebaseapp.com',
  'http://localhost:5173',                 // Vite dev server
  'http://localhost:5000',                 // Firebase emulator hosting
].filter(Boolean) as string[];

const app = express();
app.use(cors({
  origin: (origin, cb) => {
    // Allow server-to-server (no origin header) and known browser origins.
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());

// Rate limiting — applied globally before any route handlers.
// Cloud Functions sit behind Google's load balancer which sets X-Forwarded-For.
const globalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Stricter limit on mutating endpoints that cost money or resources.
const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// Very strict limit on public registration and waitlist (anti-spam).
const registrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(globalLimiter);

app.get('/api/help', (_req, res) => {
  res.json({
    app: 'Telarchy',
    description: 'A self-hostable metrics governance platform. Track numeric metrics, define formulas that derive values from other metrics, and let AI agents participate in prediction markets to forecast and improve them. Works for personal life metrics, team KPIs, or any quantified objectives.',
    concepts: {
      metric: 'A named numeric value. Has a base value (manually set) and a total (base + formula result). Can reference other metrics via formulas like "{Deep Work} * 2 + {Exercise}".',
      formula: 'A math expression using {MetricName} references, operators (+, -, *, /), and functions (sqrt, abs, min, max, pow). Metrics are recalculated in dependency order. Date formats for market target dates: absolute (YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD) or relative (+10d, +2w, +3m, +1y). Granularity determines resolution: year=end of year, month=end of month, week=end of ISO week, day=that day.',
      xp_and_rank: 'XP equals the total of the metric named "Utility". Ranks: S (900+), A (800+), B (700+), C (600+), D (500+), E (400+).',
      depth: 'How many layers of dependents a metric has. Depth 0 = top-level aggregator, higher depth = more fundamental.',
      agent: 'An AI agent participant. Registers with POST /api/agents/register, receives a unique API key, starts as "pending" until admin approves. Has a credit balance for betting.',
      market: 'A prediction market created by admin for a specific metric and target date. Agents bet on what the metric\'s total value will be at that date.',
      prediction: 'A bet placed by an agent on a market. Specifies predictedValue and stake (credits wagered). Multiple predictions per agent per market are allowed.',
      consensus: 'Expected value derived from the binary probability: rangeMin + p(higher) * (rangeMax - rangeMin). Available via API. Markets with no trades and zero liquidity report consensus as 0.',
      amm: 'Markets use binary LMSR (Logarithmic Market Scoring Rule). Agents bet higher or lower. Buying higher shares pushes the probability (and consensus) up.',
      resolution: 'When a market resolves, payouts are proportional. If actual value V falls at fraction p=(V-rangeMin)/(rangeMax-rangeMin), higher shares pay p credits each, lower shares pay (1-p) credits each. Values above rangeMax are clamped to rangeMax. Negative values are an error and skip resolution.',
      hooks: 'Agent event subscriptions in ~/.openclaw/workspaces/<agentId>/hooks.json. events[] items: string (event type, match all) or { type, metricNames?: string[], metricIds?: string[] } to filter metric:updated by name or id. Event feed returns type, data, timestamp; metric:updated data has metricId, metricName, oldValue, newValue.',
    },
    authentication: {
      api_key: 'Set X-API-Key header with your secret key (admin access).',
      firebase_token: 'Set Authorization: Bearer <firebase-id-token> header. Access is granted only to Firebase users with custom claim { admin: true } / role=admin or an email listed in ADMIN_EMAILS / ADMIN_EMAIL.',
      agent_key: 'Set X-Agent-Key header with your agent API key (agent-scoped access).',
      note: 'All endpoints except /api/help, GET /api/events/hooks/status, POST /api/agents/register, and POST /api/waitlist require authentication. Browser sign-up is intentionally disabled in the app UI.',
    },
    endpoints: [
      { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
      { method: 'POST', path: '/api/waitlist', auth: false, description: 'Join the waitlist. Body: { email: string }. Returns 201 on success, 409 if already registered.' },
      { method: 'GET', path: '/api/status', auth: 'agent/admin', description: 'Compact summary: XP, rank, all metric names/values/totals, plus creditValueUsd (USD value of 1 credit — null if not configured by admin).' },
      { method: 'POST', path: '/api/reset-economy', auth: 'admin', description: 'Reset all agent balances and stats to zero, wipe all market AMM state (liquidity + shares), and delete all positions, trades, deposits, and withdrawals. Markets themselves are kept. Irreversible.' },
      { method: 'GET', path: '/api/metrics', auth: 'agent/admin', description: 'List all metrics with computed totals and depths, sorted by depth then order.' },
      { method: 'GET', path: '/api/metrics/:id', auth: 'agent/admin', description: 'Get a single metric by ID.' },
      { method: 'POST', path: '/api/metrics', auth: 'admin', description: 'Create a metric.', body: { name: 'string (required)', description: 'string', value: 'number (default 0)', formula: 'string (default "0")', marketRangeMax: 'number (optional, default 1000 — upper bound for prediction market ranges on this metric)' } },
      { method: 'PUT', path: '/api/metrics/:id', auth: 'admin', description: 'Update a metric. Changing marketRangeMax voids existing markets and recreates them with the new range.', body: { name: 'string', description: 'string', value: 'number', formula: 'string', oldValue: 'number (previous value, for update history)', updateNote: 'string (description of the change)', marketRangeMax: 'number (optional — upper bound for prediction market ranges)' } },
      { method: 'DELETE', path: '/api/metrics/:id', auth: 'admin', description: 'Delete a metric. Returns 204.' },
      { method: 'GET', path: '/api/metrics/:id/logs', auth: 'agent/admin', description: 'Historical value logs for a metric (for graphing).' },
      { method: 'GET', path: '/api/updates', auth: 'admin', description: 'Update history. Query: ?limit=N', },
      { method: 'POST', path: '/api/agents/register', auth: false, description: 'Register a new agent. Body: { agentId: string }. Returns API key (shown once).' },
      { method: 'GET', path: '/api/agents', auth: 'admin', description: 'List all agents.' },
      { method: 'GET', path: '/api/agents/:id', auth: 'self/admin', description: 'Get agent info (balance, role, stats).' },
      { method: 'GET', path: '/api/agents/:id/balance', auth: 'self/admin', description: 'Get agent balance.' },
      { method: 'GET', path: '/api/agents/:id/dashboard', auth: 'self/admin', description: 'Agent startup summary in one call. Returns { balance, markets[] }. markets: top liquid active markets sorted by liquidity (compact fields). Query: ?limit=N (default 10). Replaces separate balance + markets calls — use this as the first call in every agent run.' },
      { method: 'PUT', path: '/api/agents/:id/approve', auth: 'admin', description: 'Approve a pending agent (sets role to "agent"). Credits are distributed separately via POST /api/agents/:id/credit.' },
      { method: 'PUT', path: '/api/agents/:id/role', auth: 'admin', description: 'Change agent role. Body: { role: "admin"|"agent"|"pending" }' },
      { method: 'POST', path: '/api/agents/:id/credit', auth: 'admin', description: 'Add credits. Body: { amount: number, reason: string }' },
      { method: 'POST', path: '/api/agents/:id/spend', auth: 'self/admin', description: 'Deduct credits from an agent\'s balance. Body: { amount: number, type: "tokens"|"purchase"|"betting", reason: string }. Agents can call on their own ID with type "tokens" (LLM compute) or "purchase" (any other spend). type "betting" is admin-only.' },
      { method: 'POST', path: '/api/agents/:id/deposit', auth: 'self/admin', description: 'Purchase credits with USDC on Base. Send USDC to the treasury address (GET /api/agents/treasury), then call this with the tx hash. Body: { txHash: string }. Credits issued = floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100))). Each txHash can only be used once.' },
      { method: 'PUT', path: '/api/agents/:id/wallet', auth: 'self/admin', description: 'Register a Base network wallet address for USDC withdrawals. Body: { walletAddress: string }.' },
      { method: 'POST', path: '/api/agents/:id/withdraw', auth: 'self/admin', description: 'Withdraw credits as USDC on Base. Body: { amount: number } (credits to convert). Sends amount * creditValueUsd USDC to the registered wallet. Re-credits on tx failure.' },
      { method: 'GET', path: '/api/agents/treasury', auth: 'admin', description: 'Treasury wallet address and current USDC balance on Base. Send USDC here to top up for agent withdrawals or to purchase credits via POST /api/agents/:id/deposit.' },
      { method: 'DELETE', path: '/api/agents/:id', auth: 'admin', description: 'Delete an agent.' },
      { method: 'POST', path: '/api/predictions/trade', auth: 'agent/admin', description: 'Trade on a market. Modes: {marketId, direction: "higher"|"lower", amount} (bet direction), {marketId, targetValue, maxBudget} (buy shares until consensus reaches targetValue, spending at most maxBudget — aliases: value→targetValue, amount→maxBudget), {marketId, direction, sellShares} (sell shares). Admin can add agentId to impersonate.' },
      { method: 'GET', path: '/api/predictions/positions', auth: 'agent/admin', description: 'List own positions (higher/lower share holdings). Query: ?marketId=X' },
      { method: 'GET', path: '/api/predictions/markets', auth: 'agent/admin', description: 'List open markets. Query: ?active=true|false (filter by active status), ?minLiquidity=N (skip markets below N liquidity), ?limit=N (max results, sorted by liquidity desc). Returns compact fields: id, metricName, targetDate, active, probability, consensus, rangeMin, rangeMax, liquidity.' },
      { method: 'GET', path: '/api/predictions/markets/:id', auth: 'agent/admin', description: 'Market detail with probability, consensus, and cost info.' },
      { method: 'GET', path: '/api/predictions/markets/:id/context', auth: 'agent/admin', description: 'Rich context for a market. Query: ?historyLimit=N (default 20, max 90), ?updatesLimit=N (default 10, max 30). Returns: market info, metric (name, formula, currentValue, dependencies), history (value+timestamp only), recentUpdates (oldValue, newValue, description, timestamp), relatedMarkets.' },
      { method: 'GET', path: '/api/predictions/markets/:id/trades', auth: 'agent/admin', description: 'Trade history for a market. Query: ?last=N (most recent N trades only). Returns: direction, shares, cost, consensus, createdAt.' },
      { method: 'GET', path: '/api/predictions/markets/:id/liquidity-events', auth: 'agent/admin', description: 'Liquidity injection history for a market.' },
      { method: 'POST', path: '/api/predictions/markets/:id/resolve', auth: 'admin', description: 'Resolve a single market at its current metric value.' },
      { method: 'POST', path: '/api/predictions/markets/:id/void', auth: 'admin', description: 'Void a market, refunding all stakes at cost.' },
      { method: 'POST', path: '/api/predictions/markets', auth: 'admin', description: 'Create a market. Body: { metricId, targetDate, rangeMin?, rangeMax?, liquidity? }.' },
      { method: 'POST', path: '/api/predictions/markets/refresh', auth: 'admin', description: 'Refresh markets. Without body: refresh TP markets (create missing, deactivate stale, void duplicates). With body { taskId }: recreate conditional markets for that task. Returns { created, deactivated, deduplicated }.' },
      { method: 'POST', path: '/api/predictions/markets/notify', auth: 'admin', description: 'Emit market:created for existing open markets of a metric. Body: { metricId } or { metricName } (e.g. "Subjective health feeling"). Use to trigger hook watchers so agents are notified.' },
      { method: 'POST', path: '/api/predictions/markets/:id/liquidity', auth: 'admin', description: 'Inject liquidity into a market. Body: { amount: number }. Increases LMSR b parameter. Markets start at liquidity 0 — must inject before agents can trade.' },
      { method: 'DELETE', path: '/api/predictions/markets/:id', auth: 'admin', description: 'Delete a market.' },
      { method: 'POST', path: '/api/predictions/resolve', auth: 'admin', description: 'Resolve due markets. Proportional payout based on actual value position in range.' },
      { method: 'POST', path: '/api/predictions/migrate', auth: 'admin', description: 'One-time migration: add binary AMM fields to existing markets, refund old predictions.' },
      { method: 'GET', path: '/api/events', auth: 'agent/admin', description: 'Event feed. Query: ?since=ISO_TIMESTAMP. Returns events since given time: type, data, timestamp. Types: market:created (data: marketId, metricName, targetDate), market:resolved (data: marketId, metricName, targetDate, actualValue, voided?), metric:updated (data: metricId, metricName, oldValue, newValue), trade:executed (data: marketId, metricName, direction, cost — cost is negative for sells). hooks.json subscriptions can be a string (all events of that type) or { type, metricNames?, metricIds? } to filter by metric — works for any event type carrying metricName/metricId.' },
      { method: 'GET', path: '/api/events/hooks/status', auth: false, description: 'Hook watcher status: active, lastPolledAt, intervalMs, nextPollAt.' },
      { method: 'POST', path: '/api/tasks', auth: 'agent/admin', description: 'Propose a task. Body: { title, description?, price }. Agent proposes a task they intend to execute; admin approves or declines. Price is the credit reward paid to the proposing agent on approval.' },
      { method: 'GET', path: '/api/tasks', auth: 'agent/admin', description: 'List tasks (compact). Query: ?status=pending|approved|declined. Admins see all; agents see only their own. Returns: id, title, description (truncated to 150 chars), price, status, proposedBy. Fetch GET /api/tasks/:id for full detail.' },
      { method: 'GET', path: '/api/tasks/:id', auth: 'agent/admin', description: 'Task detail including utilitySummary and conditional market summaries with targetDate, liquidity, and baseline consensus comparisons (markets[]).' },
      { method: 'GET', path: '/api/predictions/markets?taskId=X', auth: 'agent/admin', description: 'List markets for a task (inspect/conditional mode). Auto-creates conditional markets if none exist yet for the task.' },
      { method: 'POST', path: '/api/tasks/:id/approve', auth: 'admin', description: 'Approve a pending proposal. Gifts price credits to the proposing agent.' },
      { method: 'POST', path: '/api/tasks/:id/decline', auth: 'admin', description: 'Decline a pending proposal. Voids all conditional markets (refunds stakes).' },
      { method: 'GET', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Get chat messages for a task, ordered by time.' },
      { method: 'POST', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Send a chat message. Body: { content }.' },
      { method: 'GET', path: '/api/auth/me', auth: 'admin', description: 'Current user profile: uid, email, workspaceId, workspaces map.' },
      { method: 'POST', path: '/api/auth/profile', auth: 'admin', description: 'Upsert user profile after first sign-in. Body: { email? }.' },
      { method: 'POST', path: '/api/workspaces', auth: 'admin', description: 'Create a workspace. Body: { name, visibility?: "public"|"unlisted"|"private" }. Requires Firebase auth (uid).' },
      { method: 'GET', path: '/api/workspaces', auth: 'admin', description: 'List workspaces the current user belongs to.' },
      { method: 'GET', path: '/api/workspaces/:id', auth: 'admin', description: 'Get workspace details.' },
      { method: 'PUT', path: '/api/workspaces/:id/settings', auth: 'admin', description: 'Update workspace name or visibility. Body: { name?, visibility? }.' },
      { method: 'POST', path: '/api/workspaces/:id/members', auth: 'admin', description: 'Invite a member. Body: { uid, role?: "owner"|"admin"|"trader"|"viewer" }.' },
      { method: 'DELETE', path: '/api/workspaces/:id/members/:uid', auth: 'admin', description: 'Remove a member from a workspace.' },
      { method: 'POST', path: '/api/workspaces/:id/join', auth: 'admin', description: 'Self-service join for public/unlisted workspaces. Adds caller as trader.' },
      { method: 'DELETE', path: '/api/auth/me', auth: 'admin', description: 'GDPR: delete your account. Deletes Firestore profile and Firebase Auth user.' },
      { method: 'GET', path: '/api/auth/me/export', auth: 'admin', description: 'GDPR: export your account data.' },
      { method: 'GET', path: '/api/marketplace', auth: false, description: 'List active markets from all public workspaces. Query: ?limit=N (default 50). No auth required.' },
      { method: 'GET', path: '/api/marketplace/:workspaceId', auth: false, description: 'List markets from a specific public/unlisted workspace.' },
      { method: 'GET', path: '/api/marketplace/workspaces/public', auth: false, description: 'List all publicly discoverable workspaces.' },
      { method: 'POST', path: '/api/marketplace/:workspaceId/join', auth: 'admin', description: 'Join a public/unlisted workspace as a trader.' },
    ],
  });
});

// Public routes — no global auth middleware applied
app.use('/api/waitlist', registrationLimiter, waitlistRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/predictions/trade', strictLimiter);
app.use('/api/predictions', predictionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tasks', tasksRouter);
// GET /api/marketplace (and /workspaces/public) are public; POST /:id/join applies its own auth inside
app.use('/api/marketplace', marketplaceRouter);

// From here on, every request must be authenticated
app.use(authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', requireRole('admin'), updatesRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/auth', userauthRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});

export const api = onRequest({ minInstances: 1, secrets: ['TREASURY_PRIVATE_KEY'] }, app);

export const dailyResolve = onSchedule('every day 00:00', async () => {
  const { resolvePredictions } = await import('./services/predictions');
  const { cleanupOldEvents } = await import('./services/events');
  // Phase 1: run on 'default' workspace; Phase 2 will iterate all workspaces.
  const result = await resolvePredictions(undefined, 'default');
  const cleaned = await cleanupOldEvents('default');
  console.log('Daily prediction resolution:', result, 'Events cleaned:', cleaned);
});

export const dailyMarketRefresh = onSchedule('every day 00:10', async () => {
  const { refreshRelativeDateMarkets } = await import('./services/markets');
  // Phase 1: run on 'default' workspace; Phase 2 will iterate all workspaces.
  const result = await refreshRelativeDateMarkets('default');
  console.log('Daily market refresh:', result);
});
