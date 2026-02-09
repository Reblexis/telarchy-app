import { onRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import { authMiddleware } from './middleware/auth';
import { metricsRouter } from './routes/metrics';
import { updatesRouter } from './routes/updates';
import { systemRouter } from './routes/system';
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
      api_key: 'Set X-API-Key header with your secret key.',
      firebase_token: 'Set Authorization: Bearer <firebase-id-token> header.',
      note: 'All endpoints except /api/help require authentication.',
    },
    endpoints: [
      { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
      { method: 'GET', path: '/api/status', auth: true, description: 'Compact summary: XP, rank, and all metric names/values/totals.' },
      { method: 'GET', path: '/api/metrics', auth: true, description: 'List all metrics with computed totals and depths, sorted by depth then order.' },
      { method: 'GET', path: '/api/metrics/:id', auth: true, description: 'Get a single metric by ID.' },
      { method: 'POST', path: '/api/metrics', auth: true, description: 'Create a metric.', body: { name: 'string (required)', description: 'string', value: 'number (default 0)', formula: 'string (default "0")', decay: 'boolean (default false)' } },
      { method: 'PUT', path: '/api/metrics/:id', auth: true, description: 'Update a metric.', body: { name: 'string', description: 'string', value: 'number', formula: 'string', decay: 'boolean', oldValue: 'number (previous value, for update history)', updateNote: 'string (description of the change)' } },
      { method: 'DELETE', path: '/api/metrics/:id', auth: true, description: 'Delete a metric. Returns 204.' },
      { method: 'GET', path: '/api/metrics/:id/logs', auth: true, description: 'Historical value logs for a metric (for graphing).' },
      { method: 'GET', path: '/api/updates', auth: true, description: 'Update history. Query: ?limit=N', },
      { method: 'POST', path: '/api/decay', auth: true, description: 'Manually trigger daily decay. Returns count of affected metrics and days passed.' },
    ],
  });
});

app.use(authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', updatesRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

export const api = onRequest({ minInstances: 1 }, app);
