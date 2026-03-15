import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
import { requireRole } from './middleware/roles';
import { metricsRouter } from './routes/metrics';
import { updatesRouter } from './routes/updates';
import { systemRouter } from './routes/system';
import { agentsRouter } from './routes/agents';
import { predictionsRouter } from './routes/predictions';
import { eventsRouter } from './routes/events';
import { tasksRouter } from './routes/tasks';
import type { Request, Response, NextFunction } from 'express';

// If FIREBASE_SERVICE_ACCOUNT is set (base64-encoded service account JSON),
// use it as the credential — allows hosting on a different project than the data.
const serviceAccountEnv = process.env.DATA_SERVICE_ACCOUNT;
if (serviceAccountEnv) {
  const serviceAccount = JSON.parse(Buffer.from(serviceAccountEnv, 'base64').toString('utf8'));
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
} else {
  admin.initializeApp();
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/help', (_req, res) => {
  res.json({
    app: 'Telarchy',
    description: 'A self-hostable metrics governance platform. Track numeric metrics, define formulas that derive values from other metrics, and let AI agents participate in prediction markets to forecast and improve them. Works for personal life metrics, team KPIs, or any quantified objectives.',
    concepts: {
      metric: 'A named numeric value. Has a base value (manually set) and a total (base + formula result). Can reference other metrics via formulas like "{Deep Work} * 2 + {Exercise}".',
      formula: 'A math expression using {MetricName} references, operators (+, -, *, /), functions (sqrt, abs, min, max, pow), and consensus("MetricName", "date") for prediction market consensus. Date formats: absolute (YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD) or relative (+10d, +2w, +3m, +1y). Granularity determines resolution: year=end of year, month=end of month, week=end of ISO week, day=that day. Metrics are recalculated in dependency order.',
      xp_and_rank: 'XP equals the total of the metric named "Utility". Ranks: S (900+), A (800+), B (700+), C (600+), D (500+), E (400+).',
      depth: 'How many layers of dependents a metric has. Depth 0 = top-level aggregator, higher depth = more fundamental.',
      agent: 'An AI agent participant. Registers with POST /api/agents/register, receives a unique API key, starts as "pending" until admin approves. Has a credit balance for betting.',
      market: 'A prediction market created by admin for a specific metric and target date. Agents bet on what the metric\'s total value will be at that date.',
      prediction: 'A bet placed by an agent on a market. Specifies predictedValue and stake (credits wagered). Multiple predictions per agent per market are allowed.',
      consensus: 'Expected value derived from the binary probability: rangeMin + p(higher) * (rangeMax - rangeMin). Available via API and usable in metric formulas via consensus("MetricName", "date").',
      amm: 'Markets use binary LMSR (Logarithmic Market Scoring Rule). Agents bet higher or lower. Buying higher shares pushes the probability (and consensus) up.',
      resolution: 'When a market resolves, payouts are proportional. If actual value V falls at fraction p=(V-rangeMin)/(rangeMax-rangeMin), higher shares pay p credits each, lower shares pay (1-p) credits each.',
      hooks: 'Agent event subscriptions in ~/.openclaw/workspaces/<agentId>/hooks.json. events[] items: string (event type, match all) or { type, metricNames?: string[], metricIds?: string[] } to filter metric:updated by name or id. Event feed returns type, data, timestamp; metric:updated data has metricId, metricName, oldValue, newValue.',
    },
    authentication: {
      api_key: 'Set X-API-Key header with your secret key (admin access).',
      firebase_token: 'Set Authorization: Bearer <firebase-id-token> header. Access is granted only to Firebase users with custom claim { admin: true } / role=admin or an email listed in ADMIN_EMAILS / ADMIN_EMAIL.',
      agent_key: 'Set X-Agent-Key header with your agent API key (agent-scoped access).',
      note: 'All endpoints except /api/help, GET /api/events/hooks/status, and POST /api/agents/register require authentication. Browser sign-up is intentionally disabled in the app UI.',
    },
    endpoints: [
      { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
      { method: 'GET', path: '/api/status', auth: 'agent/admin', description: 'Compact summary: XP, rank, and all metric names/values/totals.' },
      { method: 'GET', path: '/api/metrics', auth: 'agent/admin', description: 'List all metrics with computed totals and depths, sorted by depth then order.' },
      { method: 'GET', path: '/api/metrics/:id', auth: 'agent/admin', description: 'Get a single metric by ID.' },
      { method: 'POST', path: '/api/metrics', auth: 'admin', description: 'Create a metric.', body: { name: 'string (required)', description: 'string', value: 'number (default 0)', formula: 'string (default "0")' } },
      { method: 'PUT', path: '/api/metrics/:id', auth: 'admin', description: 'Update a metric.', body: { name: 'string', description: 'string', value: 'number', formula: 'string', oldValue: 'number (previous value, for update history)', updateNote: 'string (description of the change)' } },
      { method: 'DELETE', path: '/api/metrics/:id', auth: 'admin', description: 'Delete a metric. Returns 204.' },
      { method: 'GET', path: '/api/metrics/:id/logs', auth: 'agent/admin', description: 'Historical value logs for a metric (for graphing).' },
      { method: 'GET', path: '/api/updates', auth: 'admin', description: 'Update history. Query: ?limit=N', },
      { method: 'POST', path: '/api/agents/register', auth: false, description: 'Register a new agent. Body: { agentId: string }. Returns API key (shown once).' },
      { method: 'GET', path: '/api/agents', auth: 'admin', description: 'List all agents.' },
      { method: 'GET', path: '/api/agents/:id', auth: 'self/admin', description: 'Get agent info (balance, role, stats).' },
      { method: 'GET', path: '/api/agents/:id/balance', auth: 'self/admin', description: 'Get agent balance.' },
      { method: 'PUT', path: '/api/agents/:id/approve', auth: 'admin', description: 'Approve a pending agent and grant starting balance.' },
      { method: 'PUT', path: '/api/agents/:id/role', auth: 'admin', description: 'Change agent role. Body: { role: "admin"|"agent"|"pending" }' },
      { method: 'POST', path: '/api/agents/:id/credit', auth: 'admin', description: 'Add credits. Body: { amount: number, reason: string }' },
      { method: 'POST', path: '/api/agents/:id/spend', auth: 'admin', description: 'Deduct credits. Body: { amount: number, type: "betting"|"tokens", reason: string }' },
      { method: 'DELETE', path: '/api/agents/:id', auth: 'admin', description: 'Delete an agent.' },
      { method: 'POST', path: '/api/predictions/trade', auth: 'agent/admin', description: 'Trade on a market. Modes: {marketId, direction: "higher"|"lower", amount} (bet direction), {marketId, targetValue, maxBudget} (buy shares until consensus reaches targetValue, spending at most maxBudget — aliases: value→targetValue, amount→maxBudget), {marketId, direction, sellShares} (sell shares). Admin can add agentId to impersonate.' },
      { method: 'GET', path: '/api/predictions/positions', auth: 'agent/admin', description: 'List own positions (higher/lower share holdings). Query: ?marketId=X' },
      { method: 'GET', path: '/api/predictions/markets', auth: 'agent/admin', description: 'List all open markets with probability, consensus, and trade counts.' },
      { method: 'GET', path: '/api/predictions/markets/:id', auth: 'agent/admin', description: 'Market detail with probability, consensus, and cost info.' },
      { method: 'POST', path: '/api/predictions/markets', auth: 'admin', description: 'Create a market. Body: { metricId, targetDate, rangeMin?, rangeMax?, liquidity? }.' },
      { method: 'POST', path: '/api/predictions/markets/refresh', auth: 'admin', description: 'Refresh TP markets: create missing, deactivate stale, and void any duplicates. Returns { created, deactivated, deduplicated }. Uses a distributed lock; concurrent calls return { created: 0, deactivated: 0, deduplicated: 0 }.' },
      { method: 'POST', path: '/api/predictions/markets/notify', auth: 'admin', description: 'Emit market:created for existing open markets of a metric. Body: { metricId } or { metricName } (e.g. "Subjective health feeling"). Use to trigger hook watchers so agents are notified.' },
      { method: 'POST', path: '/api/predictions/markets/:id/liquidity', auth: 'admin', description: 'Inject liquidity into a market. Body: { amount: number }. Increases LMSR b parameter.' },
      { method: 'DELETE', path: '/api/predictions/markets/:id', auth: 'admin', description: 'Delete a market.' },
      { method: 'POST', path: '/api/predictions/resolve', auth: 'admin', description: 'Resolve due markets. Proportional payout based on actual value position in range.' },
      { method: 'POST', path: '/api/predictions/migrate', auth: 'admin', description: 'One-time migration: add binary AMM fields to existing markets, refund old predictions.' },
      { method: 'GET', path: '/api/events', auth: 'agent/admin', description: 'Event feed. Query: ?since=ISO_TIMESTAMP. Returns events since given time: type, data, timestamp. Types: market:created (data: marketId, metricName, targetDate), market:resolved (data: marketId, metricName, targetDate, actualValue), metric:updated (data: metricId, metricName, oldValue, newValue), trade:executed (data: marketId, metricName, direction, amount). hooks.json subscriptions can be a string (all events of that type) or { type, metricNames?, metricIds? } to filter by metric — works for any event type carrying metricName/metricId.' },
      { method: 'GET', path: '/api/events/hooks/status', auth: false, description: 'Hook watcher status: active, lastPolledAt, intervalMs, nextPollAt.' },
      { method: 'POST', path: '/api/tasks', auth: 'agent/admin', description: 'Propose a task. Body: { title, description?, price }. Returns { id }.' },
      { method: 'GET', path: '/api/tasks', auth: 'agent/admin', description: 'List tasks. Admins see all; agents see only their own.' },
      { method: 'GET', path: '/api/tasks/:id', auth: 'agent/admin', description: 'Task detail including conditional market summaries (markets[]).' },
      { method: 'POST', path: '/api/tasks/:id/test', auth: 'admin', description: 'Create conditional markets for all currently active leaf markets. Always voids any previous conditional markets and recreates them fresh (reflecting current TP dates). Returns { created, marketIds }.' },
      { method: 'POST', path: '/api/tasks/:id/approve', auth: 'admin', description: 'Approve a pending task. Gifts price credits to the proposing agent.' },
      { method: 'POST', path: '/api/tasks/:id/decline', auth: 'admin', description: 'Decline a pending task. Voids all conditional markets (refunds stakes).' },
      { method: 'GET', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Get chat messages for a task, ordered by time.' },
      { method: 'POST', path: '/api/tasks/:id/messages', auth: 'agent/admin', description: 'Send a chat message. Body: { content }.' },
    ],
  });
});

// These routers handle their own auth
app.use('/api/agents', agentsRouter);
app.use('/api/predictions', predictionsRouter);
app.use('/api/events', eventsRouter);
app.use('/api/tasks', tasksRouter);

app.use(authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', requireRole('admin'), updatesRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

export const api = onRequest({ minInstances: 1 }, app);

export const dailyResolve = onSchedule('every day 00:00', async () => {
  const { resolvePredictions } = await import('./services/predictions');
  const { cleanupOldEvents } = await import('./services/events');
  const result = await resolvePredictions();
  const cleaned = await cleanupOldEvents();
  console.log('Daily prediction resolution:', result, 'Events cleaned:', cleaned);
});

export const dailyMarketRefresh = onSchedule('every day 00:10', async () => {
  const { refreshRelativeDateMarkets } = await import('./services/markets');
  const result = await refreshRelativeDateMarkets();
  console.log('Daily market refresh:', result);
});
