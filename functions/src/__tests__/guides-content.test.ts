/**
 * The guides served by /api/guides are docs/guides/*.md; the backend reads a
 * generated module (scripts/build-guides.mjs). This test is what makes "docs
 * govern" true for them: it fails when the generated module and the markdown
 * disagree, and when the router serves anything but the file on disk.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { GUIDE_SECTIONS } from '../content/guides';
import { GUIDE_CATEGORIES, guidesRouter } from '../routes/guides';

const DIR = join(__dirname, '..', '..', '..', 'docs', 'guides');

/** Same parse as scripts/build-guides.mjs; kept tiny on purpose. */
function parse(id: string, text: string) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!m) throw new Error(`${id}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i !== -1) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return {
    id,
    title: meta.title,
    description: meta.description,
    category: meta.category,
    order: Number(meta.order),
    content: text.slice(m[0].length).replace(/\n$/, ''),
  };
}

const files = readdirSync(DIR)
  .filter(f => f.endsWith('.md') && f !== 'README.md')
  .sort();
const fromDisk = files.map(f => parse(f.replace(/\.md$/, ''), readFileSync(join(DIR, f), 'utf8')));

const app = express();
app.use('/api/guides', guidesRouter);

describe('docs/guides is the source of the served guides', () => {
  test('the generated module equals the markdown (run: node scripts/build-guides.mjs)', () => {
    expect(GUIDE_SECTIONS).toEqual(fromDisk);
  });

  test('every file has the four front-matter fields and a known category', () => {
    for (const s of fromDisk) {
      expect(s.title).toBeTruthy();
      expect(s.description).toBeTruthy();
      expect(GUIDE_CATEGORIES.map(c => c.id)).toContain(s.category);
      expect(Number.isFinite(s.order)).toBe(true);
    }
  });

  test('GET /api/guides/:section serves the file on disk, as markdown', async () => {
    for (const s of fromDisk) {
      const r = await request(app).get(`/api/guides/${s.id}`);
      expect(r.status).toBe(200);
      expect(r.headers['content-type']).toMatch(/text\/markdown/);
      expect(r.text).toBe(s.content);
    }
  });

  test('the index lists every file once, sorted by category then order', async () => {
    const r = await request(app).get('/api/guides');
    expect(r.status).toBe(200);
    const ids = (r.body as Array<{ id: string }>).map(x => x.id);
    expect([...ids].sort()).toEqual(fromDisk.map(s => s.id).sort());
    const cat = (id: string) => GUIDE_CATEGORIES.findIndex(c => c.id === fromDisk.find(s => s.id === id)!.category);
    for (let i = 1; i < ids.length; i++) {
      const a = fromDisk.find(s => s.id === ids[i - 1])!;
      const b = fromDisk.find(s => s.id === ids[i])!;
      expect(cat(a.id) < cat(b.id) || (cat(a.id) === cat(b.id) && a.order <= b.order)).toBe(true);
    }
  });

  // docs/guides/contracts.md became get-paid.md when the floor stopped calling
  // a proposal a contract (docs/ui-conventions.md). The old address is in
  // llms.txt copies, bookmarks and agent prompts written before that.
  test('a section that was renamed still answers at its old id', async () => {
    const r = await request(app).get('/api/guides/contracts');
    expect(r.status).toBe(200);
    expect(r.text).toBe(GUIDE_SECTIONS.find(s => s.id === 'get-paid')?.content);
  });

  test('an unknown section 404s with the list of valid ids', async () => {
    const r = await request(app).get('/api/guides/no-such-guide');
    expect(r.status).toBe(404);
    expect(r.body.sections).toEqual(GUIDE_SECTIONS.map(s => s.id));
  });
});
