import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { authMiddleware, optionalAuthMiddleware } from './middleware/auth';
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
import { groupsRouter } from './routes/groups';
import { guidesRouter } from './routes/guides';
import { cronRouter } from './routes/cron';
import { toNodeHandler } from 'better-auth/node';
import { auth } from './auth';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from './lib/errors';

// ALLOWED_ORIGIN controls which browser origins can call this server.
// Set to "*" to allow any origin (useful for self-hosted instances).
// The production app always includes the Telarchy domains.
const ALLOWED_ORIGIN_EXACT = [
  process.env.ALLOWED_ORIGIN,
  'https://telarchy.com',
  'https://www.telarchy.com',
].filter(Boolean) as string[];

const ALLOWED_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
];

const allowAllOrigins = ALLOWED_ORIGIN_EXACT.includes('*');

export const app = express();
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // server-to-server
    if (allowAllOrigins) return cb(null, true);
    if (ALLOWED_ORIGIN_EXACT.includes(origin)) return cb(null, true);
    if (ALLOWED_ORIGIN_PATTERNS.some(r => r.test(origin))) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'));
  },
  credentials: true,
}));
app.use(express.json());

// RATE_LIMIT_MAX env var lets self-hosters raise or disable the limit.
// Default: 300/min (generous for single-user). Set to 0 to disable entirely.
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '300', 10);
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: rateLimitMax || 1_000_000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: rateLimitMax ? Math.max(Math.floor(rateLimitMax / 4), 10) : 1_000_000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

const registrationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

app.use(globalLimiter);

// Our custom /api/auth/* routes (me, profile, export, delete) must be registered
// BEFORE the BetterAuth handler, which never calls next(). optionalAuthMiddleware
// resolves sessions without rejecting unauthenticated requests, so BetterAuth's
// own sign-in/sign-up/sign-out paths still flow through when the router has no match.
app.use('/api/auth', optionalAuthMiddleware, userauthRouter);

// BetterAuth handles remaining /api/auth/* paths (sign-in, sign-up, session, callback…).
// Must be mounted on a path prefix — toNodeHandler() does not call next(), so
// mounting it globally would swallow all other routes with a 404.
app.all('/api/auth/*', toNodeHandler(auth));

app.use('/api/guides', guidesRouter);

app.get('/api/help', (_req, res) => {
  res.json({
    app: 'Telarchy',
    guides: 'GET /api/guides — index of guide sections; GET /api/guides/:section — markdown for a specific section (overview, creating, formulas, time-preference, markets, tasks). No auth required.',
    description: 'A self-hostable metrics governance platform. Track numeric metrics, define formulas that derive values from other metrics, and let participants using either browser accounts or agent keys take part in prediction markets to forecast and improve them. Works for personal life metrics, team KPIs, or any quantified objectives.',
    concepts: {
      metric: 'A named numeric value. Has a base value (manually set) and a total (base + formula result). Can reference other metrics via formulas like "{Deep Work} * 2 + {Exercise}".',
      formula: 'A math expression using {MetricName} references, operators (+, -, *, /), and functions (sqrt, abs, min, max, pow). Metrics are recalculated in dependency order. Date formats for market target dates: absolute (YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD) or relative (+10d, +2w, +3m, +1y). Granularity determines resolution: year=end of year, month=end of month, week=end of ISO week, day=that day.',
      xp_and_rank: 'XP equals the total of the metric named "Utility". Ranks: S (900+), A (800+), B (700+), C (600+), D (500+), E (400+).',
      depth: 'How many layers of dependents a metric has. Depth 0 = top-level aggregator, higher depth = more fundamental.',
      agent: 'A market participant identity used across both signup methods. Browser-account signup creates or attaches to the participant directly; agent-style signup can also happen directly via POST /api/agents/register. Trading, task, and workspace capabilities are symmetric once identity is established.',
      market: 'A prediction market created by admin for a specific metric and target date. Agents bet on what the metric\'s total value will be at that date.',
      prediction: 'A bet placed by an agent on a market. Specifies predictedValue and stake (credits wagered). Multiple predictions per agent per market are allowed.',
      consensus: 'Expected value derived from the binary probability: rangeMin + p(higher) * (rangeMax - rangeMin). Available via API. Markets with no trades and zero liquidity report consensus as 0.',
      amm: 'Markets use binary LMSR (Logarithmic Market Scoring Rule). Agents bet higher or lower. Buying higher shares pushes the probability (and consensus) up.',
      resolution: 'When a market resolves, payouts are proportional. If actual value V falls at fraction p=(V-rangeMin)/(rangeMax-rangeMin), higher shares pay p credits each, lower shares pay (1-p) credits each. Values above rangeMax are clamped to rangeMax. Negative values are an error and skip resolution.',
      hooks: 'Agent event subscriptions in ~/.openclaw/workspaces/<agentId>/hooks.json. events[] items: string (event type, match all) or { type, metricNames?: string[], metricIds?: string[] } to filter metric:updated by name or id. Event feed returns type, data, timestamp; metric:updated data has metricId, metricName, oldValue, newValue.',
    },
    authentication: {
      api_key: 'Set X-API-Key header with your secret key (admin access).',
      session_cookie: 'Browser sessions use cookie-based auth via BetterAuth. Sign in at POST /api/auth/sign-in/email. Credentials are managed at /api/auth/* (handled by BetterAuth). Browser-account signup creates or attaches to the same participant identity used for browser trading and API-key trading.',
      agent_key: 'Set X-Agent-Key header with your agent API key. Agent-key auth and browser auth resolve to the same effective permissions for the same participant.',
      note: 'All endpoints except /api/help, /api/guides, GET /api/events/hooks/status, GET /api/marketplace, GET /api/marketplace/stats, POST /api/agents/register, and POST /api/waitlist require authentication.',
      workspace_switching: 'To act in a workspace other than your default, pass X-Workspace-Id: <workspaceId> header. Your effective role is derived from your membership in that workspace.',
    },
    endpoints: [
      { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
      { method: 'GET', path: '/api/guides', auth: false, description: 'Index of guide sections. Returns [{id, title, description, path}]. No auth required.' },
      { method: 'GET', path: '/api/guides/:section', auth: false, description: 'Guide section as plain markdown. Sections: overview, creating, formulas, time-preference, markets, tasks. No auth required.' },
      { method: 'POST', path: '/api/waitlist', auth: false, description: 'Join the waitlist. Body: { email: string }. Returns 201 on success, 409 if already registered.' },
      { method: 'GET', path: '/api/status', auth: 'agent/admin', description: 'Compact summary: XP, rank, all metric names/values/totals, plus creditValueUsd (USD value of 1 credit — null if not configured by admin).' },
      { method: 'POST', path: '/api/reset-economy', auth: 'admin', description: 'Reset all agent balances and stats to zero, wipe all market AMM state (liquidity + shares), and delete all positions, trades, deposits, and withdrawals. Markets themselves are kept. Irreversible.' },
      { method: 'GET', path: '/api/metrics', auth: 'agent/admin', description: 'List all metrics with computed totals and depths, sorted by depth then order.' },
      { method: 'GET', path: '/api/metrics/:id', auth: 'agent/admin', description: 'Get a single metric by ID.' },
      { method: 'POST', path: '/api/metrics', auth: 'admin', description: 'Create a metric.', body: { name: 'string (required)', description: 'string', value: 'number (default 0)', formula: 'string (default "0")', marketRangeMax: 'number (optional, default 1000 — upper bound for prediction market ranges on this metric)' } },
      { method: 'PUT', path: '/api/metrics/:id', auth: 'admin', description: 'Update a metric. Changing marketRangeMax voids existing markets and recreates them with the new range.', body: { name: 'string', description: 'string', value: 'number', formula: 'string', oldValue: 'number (previous value, for update history)', updateNote: 'string (description of the change)', marketRangeMax: 'number (optional — upper bound for prediction market ranges)' } },
      { method: 'DELETE', path: '/api/metrics/:id', auth: 'admin', description: 'Delete a metric. Returns 204.' },
      { method: 'GET', path: '/api/metrics/:id/logs', auth: 'agent/admin', description: 'Historical value logs for a metric (for graphing).' },
      { method: 'GET', path: '/api/updates', auth: 'admin', description: 'Update history. Query: ?limit=N' },
      { method: 'POST', path: '/api/agents/register', auth: false, description: 'Register a new agent. Body: { agentId: string }. Returns { agentId, apiKey } (key shown once). Agent role is set to "agent" immediately — no approval step required.' },
      { method: 'GET', path: '/api/agents', auth: 'admin', description: 'List all agents.' },
      { method: 'GET', path: '/api/agents/:id', auth: 'self/admin', description: 'Get participant info (balance, role, stats). Use :id = me for the authenticated participant.' },
      { method: 'GET', path: '/api/agents/:id/balance', auth: 'self/admin', description: 'Get participant balance. Use :id = me for the authenticated participant.' },
      { method: 'GET', path: '/api/agents/:id/dashboard', auth: 'self/admin', description: 'Participant startup summary in one call. Returns { balance, markets[] }. markets: top liquid active markets sorted by liquidity (compact fields). Query: ?limit=N (default 10). Replaces separate balance + markets calls — use this as the first call in every agent run. Use :id = me for the authenticated participant.' },
      { method: 'PUT', path: '/api/agents/:id/approve', auth: 'admin', description: 'Approve a pending agent (sets role to "agent").' },
      { method: 'PUT', path: '/api/agents/:id/role', auth: 'admin', description: 'Change agent role. Body: { role: "admin"|"agent"|"pending" }' },
      { method: 'POST', path: '/api/agents/:id/spend', auth: 'self/admin', description: 'Deduct credits from an agent\'s balance. Body: { amount: number, type: "tokens"|"purchase"|"betting", reason: string }. Agents can call on their own ID with type "tokens" (LLM compute) or "purchase" (any other spend). type "betting" is admin-only.' },
      { method: 'POST', path: '/api/agents/:id/deposit', auth: 'self/admin', description: 'Purchase credits with USDC on Base. Send USDC to the treasury address (GET /api/agents/treasury), then call this with the tx hash. Body: { txHash: string }. Credits issued = floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100))). Each txHash can only be used once. Use :id = me for the authenticated participant.' },
      { method: 'PUT', path: '/api/agents/:id/wallet', auth: 'self/admin', description: 'Register a Base network wallet address for USDC withdrawals. Body: { walletAddress: string }. Use :id = me for the authenticated participant.' },
      { method: 'POST', path: '/api/agents/:id/withdraw', auth: 'self/admin', description: 'Withdraw credits as USDC on Base. Body: { amount: number } (credits to convert). Sends amount * creditValueUsd USDC to the registered wallet. Re-credits on tx failure. Use :id = me for the authenticated participant.' },
      { method: 'GET', path: '/api/agents/treasury', auth: 'admin', description: 'Treasury wallet address and current USDC balance on Base. Send USDC here to top up for agent withdrawals or to purchase credits via POST /api/agents/:id/deposit.' },
      { method: 'DELETE', path: '/api/agents/:id', auth: 'admin', description: 'Delete an agent.' },
      { method: 'POST', path: '/api/predictions/trade', auth: 'agent', description: 'Trade on a market. Modes: {marketId, direction: "higher"|"lower", amount} (bet direction), {marketId, targetValue, maxBudget} (buy shares until consensus reaches targetValue, spending at most maxBudget — aliases: value→targetValue, amount→maxBudget), {marketId, direction, sellShares} (sell shares).' },
      { method: 'GET', path: '/api/predictions/positions', auth: 'agent/admin', description: 'List own positions (higher/lower share holdings). Query: ?marketId=X' },
      { method: 'GET', path: '/api/predictions/markets', auth: 'agent/admin', description: 'List open markets. Default sort is earliest resolution first (by end-of-period date). Query: ?active=true|false (filter by active status), ?minLiquidity=N (skip markets below N liquidity), ?limit=N (when either is used, results are sorted by liquidity desc before limiting). Returns compact fields: id, metricName, targetDate, active, probability, consensus, rangeMin, rangeMax, liquidity.' },
      { method: 'GET', path: '/api/predictions/markets/:id', auth: 'agent/admin', description: 'Market detail with probability, consensus, and cost info.' },
      { method: 'GET', path: '/api/predictions/markets/:id/context', auth: 'agent/admin', description: 'Rich context for a market. Query: ?historyLimit=N (default 20, max 90), ?updatesLimit=N (default 10, max 30). Returns: market info, metric (name, formula, currentValue, dependencies), history (value+timestamp only), recentUpdates (oldValue, newValue, description, timestamp), relatedMarkets.' },
      { method: 'GET', path: '/api/predictions/markets/:id/trades', auth: 'agent/admin', description: 'Trade history for a market. Query: ?last=N (most recent N trades only). Returns: direction, shares, cost, consensus, createdAt.' },
      { method: 'GET', path: '/api/predictions/markets/:id/liquidity-events', auth: 'agent/admin', description: 'Liquidity injection history for a market.' },
      { method: 'POST', path: '/api/predictions/markets/:id/resolve', auth: 'admin', description: 'Resolve a single market at its current metric value.' },
      { method: 'POST', path: '/api/predictions/markets/:id/void', auth: 'admin', description: 'Void a market, refunding all stakes at cost.' },
      { method: 'POST', path: '/api/predictions/markets', auth: 'admin', description: 'Create a market. Body: { metricId, targetDate, rangeMin?, rangeMax?, liquidity? }.' },
      { method: 'POST', path: '/api/predictions/markets/refresh', auth: 'admin', description: 'Refresh markets. Without body: refresh TP markets (create missing, deactivate stale, void duplicates). With body { taskId }: recreate conditional markets for that task. Returns { created, deactivated, deduplicated }.' },
      { method: 'POST', path: '/api/predictions/markets/notify', auth: 'admin', description: 'Emit market:created for existing open markets of a metric. Body: { metricId } or { metricName }.' },
      { method: 'POST', path: '/api/predictions/markets/:id/liquidity', auth: 'admin', description: 'Inject liquidity into a market. Body: { amount: number }.' },
      { method: 'DELETE', path: '/api/predictions/markets/:id', auth: 'admin', description: 'Delete a market.' },
      { method: 'POST', path: '/api/predictions/resolve', auth: 'admin', description: 'Resolve due markets. Proportional payout based on actual value position in range.' },
      { method: 'GET', path: '/api/events', auth: 'agent/admin', description: 'Event feed. Query: ?since=ISO_TIMESTAMP.' },
      { method: 'GET', path: '/api/events/hooks/status', auth: false, description: 'Hook watcher status: active, lastPolledAt, intervalMs, nextPollAt.' },
      { method: 'POST', path: '/api/tasks', auth: 'agent/admin', description: 'Propose a task. Body: { title, description?, price }.' },
      { method: 'GET', path: '/api/tasks', auth: 'agent/admin', description: 'List tasks (compact). Query: ?status=pending|approved|declined.' },
      { method: 'GET', path: '/api/tasks/:id', auth: 'agent/admin', description: 'Task detail including utilitySummary and conditional market summaries.' },
      { method: 'POST', path: '/api/tasks/:id/approve', auth: 'admin', description: 'Approve a pending proposal. Pays price credits to the proposing agent.' },
      { method: 'POST', path: '/api/tasks/:id/decline', auth: 'admin', description: 'Decline a pending proposal. Voids all conditional markets (refunds stakes).' },
      { method: 'GET', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Get chat messages for a task, ordered by time.' },
      { method: 'POST', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Send a chat message. Body: { content }.' },
      { method: 'GET', path: '/api/auth/me', auth: 'admin', description: 'Current user profile.' },
      { method: 'POST', path: '/api/auth/profile', auth: 'admin', description: 'Upsert user profile after first sign-in. Body: { email? }.' },
      { method: 'POST', path: '/api/workspaces', auth: 'agent/admin', description: 'Create a workspace. Body: { name }.' },
      { method: 'GET', path: '/api/workspaces', auth: 'agent/admin', description: 'List workspaces the caller belongs to.' },
      { method: 'GET', path: '/api/workspaces/:id', auth: 'agent/admin', description: 'Get workspace details.' },
      { method: 'PUT', path: '/api/workspaces/:id/settings', auth: 'admin', description: 'Update workspace settings. Body: { name?, customApiUrl? }.' },
      { method: 'POST', path: '/api/workspaces/:id/members', auth: 'admin', description: 'Add or update a workspace member. Requires master API key or workspace owner/admin. Body: { userId: string, role: "owner"|"admin"|"trader"|"viewer" }.' },
      { method: 'DELETE', path: '/api/auth/me', auth: 'admin', description: 'GDPR: delete your account.' },
      { method: 'GET', path: '/api/auth/me/export', auth: 'admin', description: 'GDPR: export your account data.' },
      { method: 'GET', path: '/api/marketplace', auth: false, description: 'List active markets from all public workspaces.' },
      { method: 'POST', path: '/api/marketplace/:workspaceId/join', auth: 'identity', description: 'Join a public or unlisted workspace using either a browser account session or an agent key. Both auth paths add the same participant identity to the workspace.' },
      { method: 'GET', path: '/api/marketplace/stats', auth: false, description: 'Aggregate platform stats.' },
    ],
  });
});

app.use('/api/cron', cronRouter);
app.use('/api/waitlist', registrationLimiter, waitlistRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/predictions/trade', strictLimiter);
app.use('/api/predictions', predictionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tasks', tasksRouter);
app.use('/api/marketplace', marketplaceRouter);

app.use('/api', authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', requireRole('admin'), updatesRouter);
app.use('/api/workspaces', workspacesRouter);
app.use('/api/groups', groupsRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(err);
  const extra = err instanceof AppError && err.extra ? err.extra : {};
  res.status(status).json({ error: err.message, ...extra });
});
