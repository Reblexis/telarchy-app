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
app.use(authMiddleware);

app.use('/api/metrics', metricsRouter);
app.use('/api/updates', updatesRouter);
app.use('/api', systemRouter);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(400).json({ error: err.message });
});

export const api = onRequest(app);
