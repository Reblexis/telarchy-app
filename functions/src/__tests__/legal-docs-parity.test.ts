/**
 * The legal texts exist twice on purpose: `docs/legal/*.md` is the canonical
 * source and `routes/legal.ts` inlines them so the runtime image needs no
 * docs/ directory. Twice means they can drift, and on 2026-08-28 they did:
 * three merged PRs amended the docs (ToS 1.6/1.7, the proportional Season 0
 * rules) and the live site kept serving the old constants, because nothing
 * checked. This test is that check: what the legal endpoints serve must
 * byte-for-byte equal the docs, under the default environment (the doc's
 * literal contact address IS privacyContact()'s default, and the doc's
 * literal version IS CONSENT_VERSION).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { legalRouter } from '../routes/legal';

const DOCS = join(__dirname, '..', '..', '..', 'docs', 'legal');

const app = express();
app.use('/api/legal', legalRouter);

async function served(path: string): Promise<string> {
  const res = await request(app).get(path);
  expect(res.status).toBe(200);
  return res.text;
}

function doc(file: string): string {
  return readFileSync(join(DOCS, file), 'utf8');
}

describe('legal endpoints serve exactly what docs/legal says', () => {
  test('terms of service', async () => {
    expect(await served('/api/legal/terms')).toBe(doc('terms-of-service.md'));
  });

  test('privacy policy', async () => {
    expect(await served('/api/legal/privacy')).toBe(doc('privacy-policy.md'));
  });

  test('season rules (both season aliases)', async () => {
    expect(await served('/api/legal/season-0')).toBe(doc('season-0-rules.md'));
    expect(await served('/api/legal/season-1')).toBe(doc('season-0-rules.md'));
  });
});
