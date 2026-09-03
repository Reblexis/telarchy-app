/**
 * The Manifold update (docs/manifold-update.md): the standings comment the
 * owner posts on the recruiting market, assembled from the season standings
 * and the linked count, never recomputed.
 */

jest.mock('../db/client', () => require('./harness/test-db'));
jest.mock('../middleware/auth', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
  optionalAuthMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
jest.mock('../services/platform-stats', () => ({ linkedManifoldCount: jest.fn() }));
jest.mock('../routes/leaderboard', () => ({ seasonStandingsPayload: jest.fn() }));
jest.mock('../lib/seasons-current', () => ({ currentSeasonId: jest.fn() }));

import express from 'express';
import request from 'supertest';
import { AppError } from '../lib/errors';
import { renderManifoldUpdate, type UpdateEntrant } from '../lib/manifold-update';
import { currentSeasonId } from '../lib/seasons-current';
import { seasonStandingsPayload } from '../routes/leaderboard';
import { manifoldUpdateRouter } from '../routes/manifold-update';
import { linkedManifoldCount } from '../services/platform-stats';

const entrant = (o: Partial<UpdateEntrant> & { nickname: string }): UpdateEntrant => ({
  manifoldUsername: null,
  score: 0,
  markedScore: 0,
  projectedPrizeUsd: 0,
  markedProjectedPrizeUsd: 0,
  ...o,
});

const season = { id: 's0', name: 'Season 0', status: 'running' };

const live: UpdateEntrant[] = [
  entrant({
    nickname: 'vi0',
    score: 933.11,
    markedScore: 1268.12,
    projectedPrizeUsd: 773.2,
    markedProjectedPrizeUsd: 298.81,
  }),
  entrant({
    nickname: 'philipp-gl',
    manifoldUsername: 'CharlyBone',
    score: 232.91,
    markedScore: 946.64,
    projectedPrizeUsd: 192.99,
    markedProjectedPrizeUsd: 223.06,
  }),
  entrant({
    nickname: 'the-big-boss',
    score: 40.8,
    markedScore: 100.76,
    projectedPrizeUsd: 33.81,
    markedProjectedPrizeUsd: 23.74,
  }),
  entrant({ nickname: 'elonmusk', markedScore: 1.56 }),
  entrant({ nickname: 'pokos', markedScore: -1.77 }),
  entrant({ nickname: 'Quroe', manifoldUsername: 'Quroe', markedScore: 1172.61, markedProjectedPrizeUsd: 276.3 }),
  entrant({ nickname: 'vi1' }),
  entrant({ nickname: 'ert', markedScore: 3.59 }),
  entrant({ nickname: 'vire', manifoldUsername: 'spacedroplet', markedScore: 750.68, markedProjectedPrizeUsd: 176.88 }),
];

describe('the text', () => {
  const text = renderManifoldUpdate({ linked: 12, season, participants: live });

  test('opens with UPDATE and the linked count the market resolves on', () => {
    expect(text.startsWith('UPDATE:\n\nStatus: 12 linked Manifolders.\n')).toBe(true);
  });

  test('lists settled winners in standings order with prize and settled score', () => {
    expect(text).toContain(
      'By settled profit:\n\n1. vi0 ($773.20 | +933.11cr settled)\n\n2. @CharlyBone ($192.99 | +232.91cr settled)\n\n3. the-big-boss ($33.81 | +40.80cr settled)\n',
    );
  });

  test('groups the zero-settled entrants on one ranked line, in standings order', () => {
    expect(text).toContain('\n4.-9. elonmusk, pokos, @Quroe, vi1, ert, @spacedroplet ($0 | +0cr settled so far)\n');
  });

  test('a Manifold handle is an @mention, a Telarchy nickname is plain', () => {
    expect(text).toContain('@CharlyBone');
    expect(text).not.toContain('philipp-gl');
    expect(text).not.toContain('@vi0');
  });

  test('the top five by mark, whole dollars, with the marked score', () => {
    const tail = text.slice(text.indexOf('Total if prices hold:'));
    expect(tail).toBe(
      'Total if prices hold:\n\n1. vi0 ($299 | +1268.12cr total)\n\n2. @Quroe ($276 | +1172.61cr total)\n\n3. @CharlyBone ($223 | +946.64cr total)\n\n4. @spacedroplet ($177 | +750.68cr total)\n\n5. the-big-boss ($24 | +100.76cr total)\n',
    );
  });

  test('the section heading and rule sit between status and standings', () => {
    expect(text).toContain(
      'Status: 12 linked Manifolders.\n\nCurrent season leaderboard standings and prizes\n\n===================================\n\nBy settled profit:',
    );
  });

  test('a negative settled score gets its own line, never hidden in the group', () => {
    const t = renderManifoldUpdate({
      linked: 3,
      season,
      participants: [
        entrant({ nickname: 'a', score: 5, projectedPrizeUsd: 100 }),
        entrant({ nickname: 'b', score: -2.5 }),
        entrant({ nickname: 'c' }),
      ],
    });
    expect(t).toContain(
      '1. a ($100.00 | +5.00cr settled)\n\n2. b ($0.00 | -2.50cr settled)\n\n3. c ($0 | +0cr settled so far)\n',
    );
  });

  test('one zero entrant is a single rank, not a range', () => {
    const t = renderManifoldUpdate({
      linked: 3,
      season,
      participants: [entrant({ nickname: 'a', score: 5, projectedPrizeUsd: 100 }), entrant({ nickname: 'c' })],
    });
    expect(t).toContain('\n2. c ($0 | +0cr settled so far)\n');
    expect(t).not.toContain('2.-2.');
  });

  test('nobody settled yet: only the group line', () => {
    const t = renderManifoldUpdate({
      linked: 1,
      season,
      participants: [entrant({ nickname: 'a' }), entrant({ nickname: 'b' })],
    });
    expect(t).toContain('By settled profit:\n\n1.-2. a, b ($0 | +0cr settled so far)\n');
  });

  test('fewer than five marked entrants lists only those above zero', () => {
    const t = renderManifoldUpdate({
      linked: 1,
      season,
      participants: [
        entrant({ nickname: 'a', markedScore: 10, markedProjectedPrizeUsd: 1000 }),
        entrant({ nickname: 'b', markedScore: -1 }),
        entrant({ nickname: 'c' }),
      ],
    });
    expect(t.slice(t.indexOf('Total if prices hold:'))).toBe(
      'Total if prices hold:\n\n1. a ($1000 | +10.00cr total)\n',
    );
  });

  test('marked order is by mark, not by settled rank', () => {
    const t = renderManifoldUpdate({
      linked: 1,
      season,
      participants: [entrant({ nickname: 'a', score: 9, markedScore: 1 }), entrant({ nickname: 'b', markedScore: 50 })],
    });
    expect(t.slice(t.indexOf('Total if prices hold:'))).toMatch(/1\. b .*\n\n2\. a /);
  });

  test('no season: status line and a plain sentence, no standings', () => {
    const t = renderManifoldUpdate({ linked: 7, season: null, participants: [] });
    expect(t).toBe('UPDATE:\n\nStatus: 7 linked Manifolders.\n\nNo season is running.\n');
  });

  test('no entrants in a running season: headings and an honest line', () => {
    const t = renderManifoldUpdate({ linked: 7, season, participants: [] });
    expect(t).toContain('By settled profit:\n\nNobody has entered yet.\n');
    expect(t).not.toContain('Total if prices hold');
  });

  test('never a dash character, per the owner rule', () => {
    expect(text).not.toMatch(/[–—]/);
  });
});

describe('GET /api/admin/manifold-update', () => {
  let caller: { uid?: string; agentId?: string; isMasterKey?: boolean } = {};
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { auth: typeof caller }).auth = caller;
    next();
  });
  app.use('/api/admin/manifold-update', manifoldUpdateRouter);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: any, res: any, _next: any) => {
    const status = err instanceof AppError ? err.status : 500;
    res.status(status).json({ error: err.message });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    caller = { isMasterKey: true };
    jest.mocked(linkedManifoldCount).mockResolvedValue(12);
    jest.mocked(currentSeasonId).mockResolvedValue('s0');
    jest.mocked(seasonStandingsPayload).mockResolvedValue({
      status: 200,
      body: {
        season,
        participants: live.map((p, i) => ({ ...p, id: `id${i}`, rank: i + 1, image: null, enteredAt: null })),
      },
    });
  });

  test('platform admin only: an agent key is refused', async () => {
    caller = { agentId: 'a1' };
    const r = await request(app).get('/api/admin/manifold-update');
    expect(r.status).toBe(403);
  });

  test('the text is the standings and the linked count, passed through as read', async () => {
    const r = await request(app).get('/api/admin/manifold-update');
    expect(r.status).toBe(200);
    expect(r.body.linked).toBe(12);
    expect(r.body.seasonId).toBe('s0');
    expect(typeof r.body.generatedAt).toBe('string');
    expect(r.body.text).toBe(renderManifoldUpdate({ linked: 12, season, participants: live }));
    expect(jest.mocked(seasonStandingsPayload)).toHaveBeenCalledWith('s0', 500);
  });

  test('no season at all still answers with the status line', async () => {
    jest.mocked(currentSeasonId).mockResolvedValue(null);
    const r = await request(app).get('/api/admin/manifold-update');
    expect(r.status).toBe(200);
    expect(r.body.seasonId).toBeNull();
    expect(r.body.text).toContain('No season is running.');
    expect(jest.mocked(seasonStandingsPayload)).not.toHaveBeenCalled();
  });

  test('a standings failure is an error, not an update with made-up numbers', async () => {
    jest.mocked(seasonStandingsPayload).mockResolvedValue({ status: 404, body: { error: 'Season not found' } });
    const r = await request(app).get('/api/admin/manifold-update');
    expect(r.status).toBe(502);
    expect(r.body.text).toBeUndefined();
  });
});
