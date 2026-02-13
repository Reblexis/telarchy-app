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
import type { Request, Response, NextFunction } from 'express';

admin.initializeApp();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get('/api/help', (_req, res) => {
  res.json({
    app: 'Metrics Tracker',
    description: 'A self-hostable personal metrics tracking system. Track numeric metrics, define formulas that derive values from other metrics, visualize progress over time, and maintain consistency with automatic daily decay. Designed for quantified-self workflows and AI-agent automation.',
    concepts: {
      metric: 'A named numeric value. Has a base value (manually set) and a total (base + formula result). Can reference other metrics via formulas like "{Deep Work} * 2 + {Exercise}".',
      formula: 'A math expression using {MetricName} references, operators (+, -, *, /), and functions (sqrt, abs, min, max, pow). Metrics are recalculated in dependency order.',
      decay: 'Metrics with decay enabled lose 1 point per day since the last visit. Useful for streaks and consistency tracking.',
      xp_and_rank: 'XP equals the total of the metric named "Utility". Ranks: S (900+), A (800+), B (700+), C (600+), D (500+), E (400+).',
      depth: 'How many layers of dependents a metric has. Depth 0 = top-level aggregator, higher depth = more fundamental.',
    },
    authentication: {
      api_key: 'Set X-API-Key header with your secret key (admin access).',
      firebase_token: 'Set Authorization: Bearer <firebase-id-token> header (admin access).',
      agent_key: 'Set X-Agent-Key header with your agent API key (agent-scoped access).',
      note: 'All endpoints except /api/help and POST /api/agents/register require authentication.',
    },
    endpoints: [
      { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
      { method: 'GET', path: '/api/status', auth: 'agent/admin', description: 'Compact summary: XP, rank, and all metric names/values/totals.' },
      { method: 'GET', path: '/api/metrics', auth: 'agent/admin', description: 'List all metrics with computed totals and depths, sorted by depth then order.' },
      { method: 'GET', path: '/api/metrics/:id', auth: 'agent/admin', description: 'Get a single metric by ID.' },
      { method: 'POST', path: '/api/metrics', auth: 'admin', description: 'Create a metric.', body: { name: 'string (required)', description: 'string', value: 'number (default 0)', formula: 'string (default "0")', decay: 'boolean (default false)' } },
      { method: 'PUT', path: '/api/metrics/:id', auth: 'admin', description: 'Update a metric.', body: { name: 'string', description: 'string', value: 'number', formula: 'string', decay: 'boolean', oldValue: 'number (previous value, for update history)', updateNote: 'string (description of the change)' } },
      { method: 'DELETE', path: '/api/metrics/:id', auth: 'admin', description: 'Delete a metric. Returns 204.' },
      { method: 'GET', path: '/api/metrics/:id/logs', auth: 'agent/admin', description: 'Historical value logs for a metric (for graphing).' },
      { method: 'GET', path: '/api/updates', auth: 'admin', description: 'Update history. Query: ?limit=N', },
      { method: 'POST', path: '/api/decay', auth: 'admin', description: 'Manually trigger daily decay. Returns count of affected metrics and days passed.' },
      { method: 'POST', path: '/api/agents/register', auth: false, description: 'Register a new agent. Body: { agentId: string }. Returns API key (shown once).' },
      { method: 'GET', path: '/api/agents', auth: 'admin', description: 'List all agents.' },
      { method: 'GET', path: '/api/agents/:id', auth: 'self/admin', description: 'Get agent info (balance, role, stats).' },
      { method: 'GET', path: '/api/agents/:id/balance', auth: 'self/admin', description: 'Get agent balance.' },
      { method: 'PUT', path: '/api/agents/:id/approve', auth: 'admin', description: 'Approve a pending agent and grant starting balance.' },
      { method: 'PUT', path: '/api/agents/:id/role', auth: 'admin', description: 'Change agent role. Body: { role: "admin"|"agent"|"pending" }' },
      { method: 'POST', path: '/api/agents/:id/credit', auth: 'admin', description: 'Add credits. Body: { amount: number, reason: string }' },
      { method: 'POST', path: '/api/agents/:id/spend', auth: 'admin', description: 'Deduct credits. Body: { amount: number, type: "betting"|"tokens", reason: string }' },
      { method: 'DELETE', path: '/api/agents/:id', auth: 'admin', description: 'Delete an agent.' },
      { method: 'POST', path: '/api/predictions', auth: 'agent/admin', description: 'Place a prediction on an existing market. Body: { metricId, targetDate, predictedValue, stake }. Market must exist.' },
      { method: 'GET', path: '/api/predictions/mine', auth: 'agent/admin', description: 'List own predictions. Query: ?metricId=X&resolved=true/false' },
      { method: 'GET', path: '/api/predictions/consensus', auth: 'agent/admin', description: 'Market consensus. Query: ?metricId=X&targetDate=Y. Returns stake-weighted average.' },
      { method: 'GET', path: '/api/predictions/markets', auth: 'agent/admin', description: 'List all open markets with consensus, total stake, prediction count.' },
      { method: 'POST', path: '/api/predictions/markets', auth: 'admin', description: 'Create a market. Body: { metricId, targetDate (YYYY-MM-DD) }. Only admin can create markets.' },
      { method: 'DELETE', path: '/api/predictions/markets/:id', auth: 'admin', description: 'Delete a market.' },
      { method: 'GET', path: '/api/predictions', auth: 'admin', description: 'List all predictions. Query: ?agentId=X&metricId=Y&targetDate=Z&resolved=true/false' },
      { method: 'POST', path: '/api/predictions/resolve', auth: 'admin', description: 'Resolve due predictions. Body: { targetDate?: "YYYY-MM-DD" }. Defaults to today.' },
    ],
  });
});

// These routers handle their own auth
app.use('/api/agents', agentsRouter);
app.use('/api/predictions', predictionsRouter);

app.use(authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', requireRole('admin'), updatesRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

export const api = onRequest(app);

export const dailyResolve = onSchedule('every day 00:00', async () => {
  const { resolvePredictions } = await import('./services/predictions');
  const result = await resolvePredictions();
  console.log('Daily prediction resolution:', result);
});
