/**
 * Data retention runs in the daily maintenance job, not on read paths.
 *
 * Regression guard for the 2026-08-20 changes: page_visits used to be purged
 * inside every GET /api/admin/floor-stats (a DELETE paid by whoever opened
 * the cockpit), floor_questions were scrubbed inside GET /api/admin/questions
 * the same way, and agent_traces had NO retention at all: 426k rows / 2.9 GB
 * on a db-f1-micro, which is what made the leaderboard seq-scan for 40s
 * during the evening outage.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { readFileSync } from 'fs';
import { join } from 'path';
import { agentTraces, floorQuestions, pageVisits } from '../db/schema';
import { runDailyMaintenance, TRACE_RETENTION_DAYS, VISIT_RETENTION_DAYS } from '../services/maintenance';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const DAY = 24 * 3600 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

function visit(id: string, ts: Date) {
  return { id, ts, path: '/', referer: null, userAgent: null, ip: '203.0.113.9', country: 'CZ' };
}

function trace(id: string, startedAt: Date) {
  return {
    id,
    workspaceId: 'ws1',
    agentId: 'ag1',
    strategy: 's',
    startedAt,
    endedAt: startedAt,
    entries: [{ marketId: 'm1', reasoning: 'r' }],
  };
}

describe('runDailyMaintenance', () => {
  it('deletes visits past the window and keeps the rest', async () => {
    await db.insert(pageVisits).values([visit('old', daysAgo(VISIT_RETENTION_DAYS + 1)), visit('fresh', daysAgo(1))]);
    const r = await runDailyMaintenance();
    expect(r.visitsDeleted).toBe(1);
    const left = await db.select().from(pageVisits);
    expect(left.map(v => v.id)).toEqual(['fresh']);
  });

  it('scrubs question IP and country past the window, keeps question and answer', async () => {
    await db.insert(floorQuestions).values([
      {
        id: 'old',
        workspaceId: 'ws1',
        question: 'q',
        answer: 'a',
        ip: '203.0.113.9',
        country: 'CZ',
        createdAt: daysAgo(31),
      },
      {
        id: 'fresh',
        workspaceId: 'ws1',
        question: 'q2',
        answer: 'a2',
        ip: '203.0.113.9',
        country: 'CZ',
        createdAt: daysAgo(1),
      },
    ]);
    const r = await runDailyMaintenance();
    expect(r.questionsScrubbed).toBe(1);
    const rows = await db.select().from(floorQuestions);
    const old = rows.find(x => x.id === 'old')!;
    const fresh = rows.find(x => x.id === 'fresh')!;
    expect(old.ip).toBeNull();
    expect(old.country).toBeNull();
    expect(old.question).toBe('q');
    expect(old.answer).toBe('a');
    expect(fresh.ip).toBe('203.0.113.9');
  });

  it('deletes traces past retention, in chunks, and keeps recent ones', async () => {
    await db
      .insert(agentTraces)
      .values([
        trace('ancient-1', daysAgo(TRACE_RETENTION_DAYS + 10)),
        trace('ancient-2', daysAgo(TRACE_RETENTION_DAYS + 5)),
        trace('recent', daysAgo(5)),
      ]);
    const r = await runDailyMaintenance();
    expect(r.tracesDeleted).toBe(2);
    const left = await db.select({ id: agentTraces.id }).from(agentTraces);
    expect(left.map(t => t.id)).toEqual(['recent']);
  });

  it('is idempotent: a second run finds nothing to do', async () => {
    await db.insert(pageVisits).values([visit('old', daysAgo(40))]);
    await runDailyMaintenance();
    const r2 = await runDailyMaintenance();
    expect(r2).toEqual({ visitsDeleted: 0, questionsScrubbed: 0, tracesDeleted: 0 });
  });
});

describe('read paths no longer write (source pins)', () => {
  const ADMIN_TS = readFileSync(join(__dirname, '../routes/admin.ts'), 'utf8');

  it('floor-stats does not DELETE page_visits on read', () => {
    expect(ADMIN_TS).not.toContain('db.delete(pageVisits)');
  });

  it('questions does not UPDATE floor_questions on read', () => {
    expect(ADMIN_TS).not.toContain('db.update(floorQuestions)');
  });
});
