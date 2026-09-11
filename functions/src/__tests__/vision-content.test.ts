/**
 * The data room's Vision tab (docs/data-room.md, "Vision"): one markdown
 * document, docs/data-room/vision.md, generated into the backend by
 * scripts/build-vision.mjs the way the guides are, and served at
 * GET /api/data-room/vision as { title, updatedAt, markdown }. This test is
 * what makes "docs govern" true for it: it fails when the generated module
 * and the markdown disagree, and when the route serves anything else.
 */

jest.mock('../db/client', () => require('./harness/test-db'));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { VISION } from '../content/vision';
import { dataRoomRouter } from '../routes/data-room';

const FILE = join(__dirname, '..', '..', '..', 'docs', 'data-room', 'vision.md');

/** Same parse as scripts/build-vision.mjs; kept tiny on purpose. */
function parse(text: string) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error('docs/data-room/vision.md: missing front matter');
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i !== -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { title: meta.title, markdown: text.slice(m[0].length).replace(/^\n+/, '').replace(/\n$/, '') };
}

const fromDisk = parse(readFileSync(FILE, 'utf8'));

const app = express();
app.use('/api/data-room', dataRoomRouter);

describe('docs/data-room/vision.md is the source of the served vision', () => {
  test('the generated module equals the markdown (run: node scripts/build-vision.mjs)', () => {
    expect(VISION.title).toBe(fromDisk.title);
    expect(VISION.markdown).toBe(fromDisk.markdown);
    expect(VISION.title).toBeTruthy();
    expect(VISION.markdown).toBeTruthy();
  });

  test('updatedAt is a calendar day, not in the future', () => {
    expect(VISION.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VISION.updatedAt <= new Date().toISOString().slice(0, 10)).toBe(true);
  });

  test('GET /api/data-room/vision answers anonymously with the title, the date and the markdown', async () => {
    const r = await request(app).get('/api/data-room/vision');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ title: fromDisk.title, updatedAt: VISION.updatedAt, markdown: fromDisk.markdown });
  });
});
