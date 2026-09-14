/**
 * POST /api/cron/agent-watchdog (docs/infra/deploy.md, "Cron schedule"): the
 * master key only, and one run at a time under the agent-watchdog lock.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

const run = jest.fn(async () => [{ agentId: 'reference-astra', status: 'ok', reasons: [], mailed: null }]);
jest.mock('../services/agent-watchdog', () => ({ runAgentWatchdog: (...a: unknown[]) => run(...(a as [])) }));

let lock: 'ran' | 'skipped' = 'ran';
jest.mock('../lib/singleton-jobs', () => ({
  withSingletonLock: jest.fn(async (_name: string, fn: () => Promise<void>) => {
    if (lock === 'skipped') return 'skipped';
    await fn();
    return 'ran';
  }),
}));

import express from 'express';
import request from 'supertest';
import { withSingletonLock } from '../lib/singleton-jobs';
import { cronRouter } from '../routes/cron';

const app = express();
app.use(express.json());
app.use('/api/cron', cronRouter);

beforeEach(() => {
  process.env.API_KEY = 'master-test-key';
  run.mockClear();
  lock = 'ran';
});

test('without the master key it is refused and nothing runs', async () => {
  expect((await request(app).post('/api/cron/agent-watchdog').send({})).status).toBe(401);
  expect((await request(app).post('/api/cron/agent-watchdog').set('X-API-Key', 'wrong').send({})).status).toBe(401);
  expect(run).not.toHaveBeenCalled();
});

test('with the master key it runs under the agent-watchdog lock and returns the results', async () => {
  const res = await request(app).post('/api/cron/agent-watchdog').set('X-API-Key', 'master-test-key').send({});
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, lock: 'ran', agents: [{ agentId: 'reference-astra', status: 'ok' }] });
  expect(withSingletonLock).toHaveBeenCalledWith('agentWatchdog', expect.any(Function));
});

test('a second run while one holds the lock skips and runs nothing', async () => {
  lock = 'skipped';
  const res = await request(app).post('/api/cron/agent-watchdog').set('X-API-Key', 'master-test-key').send({});
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ ok: true, lock: 'skipped', agents: [] });
  expect(run).not.toHaveBeenCalled();
});
