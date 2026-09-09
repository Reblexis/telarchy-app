/**
 * The cockpit may never take the site down (docs/ui-conventions.md).
 *
 * On 2026-09-09 `/admin` was left open overnight and telarchy.com answered
 * 503 for two hours: the page polls every twenty seconds and `journeys` read
 * thirty days of `page_visits` into the process on every call, 18,390 rows
 * and 2.3 seconds, on a service that runs one instance. These tests pin the
 * server half of the fix: both expensive reads are cached, so a poll cannot
 * reach the database more than once a minute.
 */
jest.mock('../db/client', () => require('./harness/test-db'));

jest.mock('../lib/platform-admin', () => ({
  isPlatformAuthorized: async () => true,
}));

import express from 'express';
import request from 'supertest';
import { pageVisits } from '../db/schema';
import { AppError } from '../lib/errors';
import { adminRouter } from '../routes/admin';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/admin', adminRouter);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.use((err: Error, _req: any, res: any, _next: any) => {
  res.status(err instanceof AppError ? err.status : 500).json({ error: err.message });
});

let n = 0;
async function visit(over: Partial<{ ip: string; path: string; ts: Date; userAgent: string }> = {}) {
  n += 1;
  await db.insert(pageVisits).values({
    id: `v-${n}`,
    ts: over.ts ?? new Date(),
    path: over.path ?? '/',
    ip: over.ip ?? '1.2.3.4',
    // The human filter drops crawlers, so these have to look like a browser.
    userAgent: over.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/146.0',
    referer: null,
    country: 'CZ',
  });
}

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
  n = 0;
});

describe('journeys is cached, so polling cannot pound the visitor log', () => {
  test('a second call inside the window does not see a visit written after the first', async () => {
    await visit({ ip: '9.9.9.9', path: '/a' });
    const first = await request(app).get('/api/admin/journeys');
    expect(first.status).toBe(200);
    expect(first.body.summary.journeys).toBe(1);

    await visit({ ip: '8.8.8.8', path: '/b' });
    const second = await request(app).get('/api/admin/journeys');
    expect(second.status).toBe(200);
    // Served from the cache: the same answer, not a fresh read.
    expect(second.body.summary.journeys).toBe(1);
    expect(second.body).toEqual(first.body);
  });

  test('the cache is per-route, so floor-stats does not serve the journeys payload', async () => {
    await visit();
    const journeys = await request(app).get('/api/admin/journeys');
    const stats = await request(app).get('/api/admin/floor-stats');
    expect(journeys.status).toBe(200);
    expect(stats.status).toBe(200);
    expect(stats.body).not.toHaveProperty('topExits');
  });
});

describe('floor-stats is cached too, for the same reason', () => {
  test('a second call inside the window does not see a visit written after the first', async () => {
    await visit({ ip: '5.5.5.5' });
    const first = await request(app).get('/api/admin/floor-stats');
    expect(first.status).toBe(200);
    const firstVisits = JSON.stringify(first.body.visitsByDay ?? first.body);

    await visit({ ip: '6.6.6.6' });
    await visit({ ip: '7.7.7.7' });
    const second = await request(app).get('/api/admin/floor-stats');
    expect(JSON.stringify(second.body.visitsByDay ?? second.body)).toBe(firstVisits);
  });
});

describe('the visitor log is indexed on time', () => {
  test('page_visits has an index on ts, because every read of it is a time range', async () => {
    const rows = await db.execute(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "select indexdef from pg_indexes where tablename = 'page_visits'" as any,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const defs = ((rows as any).rows ?? rows).map((r: any) => String(r.indexdef));
    expect(defs.some((d: string) => /\(ts\b/.test(d) || /\(ts /.test(d))).toBe(true);
  });
});
