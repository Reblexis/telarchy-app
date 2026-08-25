/**
 * Where a waitlist signup came from.
 *
 * Both doors post to the same endpoint: the marketplace's "List your own
 * number" tile and each floor's own email box. Without recording which, every
 * signup reads identically on /admin and the owner cannot tell which surface
 * converts (owner ask 2026-08-15). The column is nullable, so rows written
 * before it existed stay valid and read as unknown.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import express from 'express';
import request from 'supertest';
import { waitlist } from '../db/schema';
import { waitlistRouter } from '../routes/waitlist';
import { db, ensureMigrations, truncateAll } from './harness/test-db';

const app = express();
app.use(express.json());
app.use('/api/waitlist', waitlistRouter);

beforeAll(async () => {
  await ensureMigrations();
});
beforeEach(async () => {
  await truncateAll();
});

const join = (body: Record<string, unknown>) =>
  request(app).post('/api/waitlist').set('Content-Type', 'application/json').send(body);

const rows = () => db.select().from(waitlist);

describe('waitlist source', () => {
  test('records the marketplace tile', async () => {
    expect((await join({ email: 'a@example.com', source: 'marketplace' })).status).toBe(201);
    const [row] = await rows();
    expect(row.source).toBe('marketplace');
  });

  test('records the floor a visitor was standing on', async () => {
    expect((await join({ email: 'b@example.com', source: 'lookpilot' })).status).toBe(201);
    const [row] = await rows();
    expect(row.source).toBe('lookpilot');
  });

  test('a signup with no source is still accepted, and reads as unknown', async () => {
    expect((await join({ email: 'c@example.com' })).status).toBe(201);
    const [row] = await rows();
    expect(row.source).toBeNull();
  });

  test('the source is clamped, never trusted', async () => {
    // Untrusted free text from a public unauthenticated endpoint.
    await join({ email: 'd@example.com', source: 'x'.repeat(500) });
    const [row] = await rows();
    expect(row.source).toHaveLength(60);

    await join({ email: 'e@example.com', source: '   ' });
    const blank = (await rows()).find(r => r.email === 'e@example.com')!;
    expect(blank.source).toBeNull();

    await join({ email: 'f@example.com', source: { not: 'a string' } });
    const wrongType = (await rows()).find(r => r.email === 'f@example.com')!;
    expect(wrongType.source).toBeNull();
  });

  test('the email is still what makes a signup unique', async () => {
    expect((await join({ email: 'dup@example.com', source: 'marketplace' })).status).toBe(201);
    // Same person, other door: one row, not two.
    expect((await join({ email: 'dup@example.com', source: 'lookpilot' })).status).toBe(409);
    expect(await rows()).toHaveLength(1);
  });

  test('a malformed email is refused whatever the source says', async () => {
    expect((await join({ email: 'not-an-email', source: 'marketplace' })).status).toBe(400);
    expect(await rows()).toHaveLength(0);
  });
});
