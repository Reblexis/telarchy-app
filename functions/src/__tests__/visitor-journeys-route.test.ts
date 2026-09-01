/**
 * HTTP-level tests for GET /api/admin/journeys, the cockpit block that shows
 * one visitor's ordered path through the site (docs/ui-conventions.md,
 * "Journeys").
 *
 * The rules that decide what the owner concludes are tested here against a
 * real database: the platform gate, the humanish filter, and the 30-day
 * window the privacy policy allows.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../middleware/auth', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.auth = {
      isMasterKey: req.headers['x-master-key'] === '1',
      uid: req.headers['x-user-id'] as string | undefined,
      capabilities: new Set(['read']),
    };
    next();
  },
  optionalAuthMiddleware: (req: any, _res: any, next: any) => {
    req.auth = req.auth ?? null;
    next();
  },
}));

import express from 'express';
import request from 'supertest';
import { pageVisits } from '../db/schema';
import { AppError } from '../lib/errors';
import { adminRouter } from '../routes/admin';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
const { authMiddleware } = require('../middleware/auth');
app.use('/api/admin', authMiddleware, adminRouter);
app.use((err: Error, _req: any, res: any, _next: any) => {
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json({ error: err.message });
});

const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/128.0';

let n = 0;
async function logVisit(over: {
  path: string;
  minutesAgo: number;
  ip?: string;
  userAgent?: string;
  referer?: string | null;
}) {
  await db.insert(pageVisits).values({
    id: `v${n++}`,
    ts: new Date(Date.now() - over.minutesAgo * 60_000),
    path: over.path,
    ip: over.ip ?? '1.1.1.1',
    userAgent: over.userAgent ?? BROWSER,
    referer: over.referer ?? null,
    country: 'CZ',
  });
}

const asOwner = () => request(app).get('/api/admin/journeys').set('x-master-key', '1');

beforeAll(async () => {
  await ensureMigrations();
}, 30_000);
beforeEach(async () => {
  await truncateAll();
  n = 0;
});

describe('GET /api/admin/journeys', () => {
  it('is platform-admin only, like every other cockpit read', async () => {
    await request(app).get('/api/admin/journeys').expect(403);
    await request(app).get('/api/admin/journeys').set('x-user-id', 'someone').expect(403);
  });

  it('replays one visitor path in the order it happened', async () => {
    await logVisit({
      path: '/',
      minutesAgo: 30,
      referer: 'https://manifold.markets/q',
    });
    await logVisit({ path: '/leaderboard', minutesAgo: 29 });
    await logVisit({ path: '/join', minutesAgo: 28 });

    const res = await asOwner().expect(200);
    expect(res.body.journeys).toHaveLength(1);
    const [j] = res.body.journeys;
    expect(j.steps.map((s: any) => s.path)).toEqual(['/', '/leaderboard', '/join']);
    expect(j.entryPath).toBe('/');
    expect(j.exitPath).toBe('/join');
    expect(j.referer).toBe('https://manifold.markets/q');
    expect(j.bounced).toBe(false);
  });

  it('excludes crawlers, so the busiest journey is not a bot walking the site', async () => {
    for (const path of ['/', '/a', '/b', '/c', '/d']) {
      await logVisit({
        path,
        minutesAgo: 10,
        ip: '8.8.8.8',
        userAgent: 'Googlebot/2.1 (+crawl)',
      });
    }
    await logVisit({ path: '/', minutesAgo: 5 });

    const res = await asOwner().expect(200);
    expect(res.body.journeys).toHaveLength(1);
    expect(res.body.journeys[0].steps.map((s: any) => s.path)).toEqual(['/']);
  });

  it('excludes scanner probe paths the same way the counts do', async () => {
    await logVisit({ path: '/wp-admin', minutesAgo: 10, ip: '7.7.7.7' });
    await logVisit({ path: '/.env', minutesAgo: 9, ip: '7.7.7.7' });

    const res = await asOwner().expect(200);
    expect(res.body.journeys).toHaveLength(0);
  });

  it('never shows a visit older than the 30-day retention window', async () => {
    await logVisit({
      path: '/ancient',
      minutesAgo: 31 * 24 * 60,
      ip: '4.4.4.4',
    });
    await logVisit({ path: '/recent', minutesAgo: 60, ip: '5.5.5.5' });

    const res = await asOwner().expect(200);
    expect(res.body.journeys.map((j: any) => j.entryPath)).toEqual(['/recent']);
  });

  it('answers with an empty list rather than an error when nobody has visited', async () => {
    const res = await asOwner().expect(200);
    expect(res.body.journeys).toEqual([]);
    expect(res.body.summary.journeys).toBe(0);
  });

  it('summarises how many journeys bounced, which is the number being improved', async () => {
    await logVisit({ path: '/', minutesAgo: 20, ip: '1.1.1.1' });
    await logVisit({ path: '/', minutesAgo: 19, ip: '2.2.2.2' });
    await logVisit({ path: '/join', minutesAgo: 18, ip: '2.2.2.2' });
    await logVisit({ path: '/', minutesAgo: 17, ip: '3.3.3.3' });

    const res = await asOwner().expect(200);
    expect(res.body.summary.journeys).toBe(3);
    expect(res.body.summary.bounced).toBe(2);
  });

  it('counts where journeys stopped, so the worst exit is visible without reading each one', async () => {
    await logVisit({ path: '/', minutesAgo: 20, ip: '1.1.1.1' });
    await logVisit({ path: '/join', minutesAgo: 19, ip: '1.1.1.1' });
    await logVisit({ path: '/', minutesAgo: 18, ip: '2.2.2.2' });
    await logVisit({ path: '/join', minutesAgo: 17, ip: '2.2.2.2' });
    await logVisit({ path: '/', minutesAgo: 16, ip: '3.3.3.3' });

    const res = await asOwner().expect(200);
    const exits = Object.fromEntries(res.body.topExits.map((e: any) => [e.path, e.journeys]));
    expect(exits['/join']).toBe(2);
    expect(exits['/']).toBe(1);
  });
});
