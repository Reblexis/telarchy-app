/**
 * The data room in the agent brief (docs/data-room.md, "Otto browses it; it
 * is not in his context").
 *
 * `GET /api/marketplace/:id/context` is what an outside agent reads to price
 * a floor, and on Telarchy's own floor it carried no documents at all: the one
 * page that says what moves the number (the funnel, the traffic, what
 * shipped) reached humans and Otto and never reached the agents we most want
 * trading. It is in the brief now.
 *
 * The rule it must not break is the one the data room already states: the
 * document is NOT in Otto's fixed context, because that prefix is identical
 * for every visitor on every floor and stuffing it there charges every
 * visitor for a document almost none of them ask about. He keeps the tool.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  hashKey: (raw: string) => raw,
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = null;
    next();
  },
  optionalAuthMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import express from 'express';
import request from 'supertest';
import { metrics, permissionGroups, workspaces } from '../db/schema';
import { AppError } from '../lib/errors';
import { marketplaceRouter } from '../routes/marketplace';
import { clearDataRoomCache } from '../services/data-room';
import { buildWorkspaceContext } from '../services/workspace-context';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/marketplace', marketplaceRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const OURS = 'ws-telarchy';
const THEIRS = 'ws-other';

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);

beforeEach(async () => {
  await truncateAll();
  clearDataRoomCache();
  process.env.SELF_SYNC_WORKSPACE_ID = OURS;
  await db.insert(workspaces).values([
    { id: OURS, name: 'Telarchy', slug: 'telarchy', createdBy: 'seed', visibility: 'public' },
    { id: THEIRS, name: 'Pinecast', slug: 'pinecast', createdBy: 'seed', visibility: 'public' },
  ]);
  await db.insert(permissionGroups).values([
    { id: 'g1', workspaceId: OURS, name: 'Public', type: 'public', capabilities: ['read'], sourcePermissions: {} },
    { id: 'g2', workspaceId: THEIRS, name: 'Public', type: 'public', capabilities: ['read'], sourcePermissions: {} },
  ]);
  await db.insert(metrics).values([{ id: 'm1', workspaceId: OURS, name: 'Active traders', value: 9, formula: '0' }]);
});

describe('what an outside agent is handed', () => {
  test('the platform’s own brief carries the data room as a document', async () => {
    const res = await request(app).get(`/api/marketplace/${OURS}/context`);
    expect(res.status).toBe(200);
    const doc = res.body.documents.find((d: { name: string }) => d.name === 'Data room');
    expect(doc).toBeTruthy();
    // Not a link to it, the thing itself: the sections and their figures.
    expect(doc.content).toContain('Overview');
    expect(doc.content).toContain('pulse');
  });

  test('somebody else’s floor is not handed Telarchy’s books', async () => {
    const res = await request(app).get(`/api/marketplace/${THEIRS}/context`);
    expect(res.status).toBe(200);
    expect(res.body.documents.find((d: { name: string }) => d.name === 'Data room')).toBeUndefined();
  });

  test('the markdown rendering of the brief carries it too', async () => {
    const res = await request(app).get(`/api/marketplace/${OURS}/context?format=md`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('Data room');
  });
});

describe('it stays out of the fixed context Otto pays for on every question', () => {
  test('the brief the ask route builds does not carry the document', async () => {
    const ctx = await buildWorkspaceContext(OURS);
    expect(ctx?.documents.find(d => d.name === 'Data room')).toBeUndefined();
  });
});
