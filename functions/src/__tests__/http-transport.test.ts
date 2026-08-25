/**
 * Transport-level behavior added 2026-08-20: compression and proxy trust.
 *
 * Before this, NOTHING on telarchy.com was compressed (the 615 KB bundle and
 * every API JSON shipped raw) and `trust proxy` was unset, so express saw the
 * Cloud Run front end as the client: every anonymous visitor shared one
 * rate-limit bucket per instance, and one scanner could starve them all.
 *
 * Mounted on bare express apps configured exactly as app.ts configures the
 * real one (importing the whole app drags in BetterAuth's ESM build; the
 * static SOURCE checks below pin that app.ts actually applies these settings,
 * the behavioral ones pin what the settings do).
 */

import compression from 'compression';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { readFileSync } from 'fs';
import { join } from 'path';
import request from 'supertest';

const APP_TS = readFileSync(join(__dirname, '../app.ts'), 'utf8');

describe('app.ts wiring (source pins)', () => {
  it('sets trust proxy to exactly one hop', () => {
    expect(APP_TS).toContain("app.set('trust proxy', 1)");
  });

  it('registers compression before any route or limiter', () => {
    const compressionAt = APP_TS.indexOf('app.use(compression())');
    expect(compressionAt).toBeGreaterThan(-1);
    for (const later of ['app.use(corsMiddleware)', 'app.use(globalLimiter)', "app.use('/api"]) {
      const at = APP_TS.indexOf(later);
      expect(at).toBeGreaterThan(compressionAt);
    }
  });
});

describe('compression behavior', () => {
  function compressedApp(): express.Express {
    const app = express();
    app.use(compression());
    app.get('/big.json', (_req, res) => {
      res.json({ rows: Array.from({ length: 500 }, (_, i) => ({ i, name: `row-${i}` })) });
    });
    app.get('/tiny.json', (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  it('gzips a large JSON response when the client accepts it', async () => {
    const res = await request(compressedApp()).get('/big.json').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.body.rows).toHaveLength(500); // supertest decodes; body survives intact
  });

  it('leaves sub-threshold responses uncompressed', async () => {
    const res = await request(compressedApp()).get('/tiny.json').set('Accept-Encoding', 'gzip');
    expect(res.headers['content-encoding']).toBeUndefined();
  });

  it('serves identity when the client does not accept gzip', async () => {
    const res = await request(compressedApp()).get('/big.json').set('Accept-Encoding', 'identity');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.body.rows).toHaveLength(500);
  });
});

describe('trust proxy behavior (one hop, Cloud Run shape)', () => {
  function proxiedApp(): express.Express {
    const app = express();
    app.set('trust proxy', 1);
    app.get('/ip', (req, res) => {
      res.json({ ip: req.ip });
    });
    return app;
  }

  it('req.ip is the entry the front end appended, not the socket', async () => {
    const res = await request(proxiedApp()).get('/ip').set('X-Forwarded-For', '203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('a client forging extra X-Forwarded-For entries cannot pick its own identity', async () => {
    // The front end APPENDS the real client last; forged entries sit left of
    // it. With one trusted hop, express must read the rightmost entry.
    const res = await request(proxiedApp()).get('/ip').set('X-Forwarded-For', '10.0.0.1, 198.51.100.7, 203.0.113.9');
    expect(res.body.ip).toBe('203.0.113.9');
  });

  it('rate limiting buckets per client IP, so one noisy IP cannot starve another', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.use(
      rateLimit({
        windowMs: 60_000,
        max: 2,
        standardHeaders: true,
        legacyHeaders: false,
        validate: { forwardedHeader: false },
      }),
    );
    app.get('/x', (_req, res) => {
      res.json({ ok: true });
    });

    const scanner = () => request(app).get('/x').set('X-Forwarded-For', '198.51.100.7');
    const visitor = () => request(app).get('/x').set('X-Forwarded-For', '203.0.113.9');
    await scanner();
    await scanner();
    expect((await scanner()).status).toBe(429); // scanner exhausted its bucket
    expect((await visitor()).status).toBe(200); // visitor unaffected
  });
});
