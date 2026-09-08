/**
 * The outreach workbench's HTTP surface, mounted at /api/admin/outreach.
 * Governing doc: docs/outreach-workbench.md.
 *
 * Platform admin only, on every route: the rows are the owner's own list of
 * strangers and what they wrote back, and the drafting spends his tokens.
 * Nothing here sends anything.
 */
import { Router } from 'express';
import { AppError } from '../lib/errors';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { wrap } from '../lib/wrap';
import {
  askOutreach,
  channelLink,
  createProspect,
  deleteProspect,
  draftMessage,
  getLessons,
  importProspects,
  listProspects,
  logLine,
  setLessons,
  updateProspect,
} from '../services/outreach';
import { type DraftTurn, draftingConfigured } from '../services/x-workbench';

export const outreachRouter = Router();

async function requireOwner(req: Parameters<typeof isPlatformAuthorized>[0]) {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
}

const turnsOf = (v: unknown): DraftTurn[] =>
  Array.isArray(v)
    ? (v as DraftTurn[]).filter(
        m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
      )
    : [];

/** Every prospect with its link and its contract line, plus the summary. */
outreachRouter.get(
  '/prospects',
  wrap(async (req, res) => {
    await requireOwner(req);
    const { prospects, summary } = await listProspects();
    res.json({
      prospects: prospects.map((p, i) => ({
        ...p,
        link: channelLink(p, p.message ?? ''),
        logLine: logLine(p, i + 1),
      })),
      summary,
      draftingConfigured: draftingConfigured(),
    });
  }),
);

outreachRouter.post(
  '/prospects',
  wrap(async (req, res) => {
    await requireOwner(req);
    const p = await createProspect(req.body ?? {});
    res.status(201).json({ prospect: { ...p, link: channelLink(p, p.message ?? '') } });
  }),
);

/** Many at once, the same shape; all or none. */
outreachRouter.post(
  '/prospects/import',
  wrap(async (req, res) => {
    await requireOwner(req);
    const list = Array.isArray(req.body?.prospects) ? req.body.prospects : null;
    if (!list) throw new AppError('prospects must be an array', 400);
    res.status(201).json({ imported: await importProspects(list) });
  }),
);

/** Edit any field. Moving to `sent` freezes what went out. */
outreachRouter.patch(
  '/prospects/:id',
  wrap(async (req, res) => {
    await requireOwner(req);
    const p = await updateProspect(String(req.params.id), req.body ?? {});
    res.json({ prospect: { ...p, link: channelLink(p, p.message ?? '') } });
  }),
);

outreachRouter.delete(
  '/prospects/:id',
  wrap(async (req, res) => {
    await requireOwner(req);
    await deleteProspect(String(req.params.id));
    res.json({ ok: true });
  }),
);

/** A draft from the evidence, or one more turn of the argument about it. */
outreachRouter.post(
  '/prospects/:id/draft',
  wrap(async (req, res) => {
    await requireOwner(req);
    res.json({ draft: await draftMessage(String(req.params.id), turnsOf(req.body?.messages)) });
  }),
);

/** A question about the outreach, from the record and the lessons. */
outreachRouter.post(
  '/ask',
  wrap(async (req, res) => {
    await requireOwner(req);
    res.json(await askOutreach(turnsOf(req.body?.messages)));
  }),
);

outreachRouter.get(
  '/lessons',
  wrap(async (req, res) => {
    await requireOwner(req);
    res.json({ lessons: await getLessons(), draftingConfigured: draftingConfigured() });
  }),
);

outreachRouter.put(
  '/lessons',
  wrap(async (req, res) => {
    await requireOwner(req);
    await setLessons(String(req.body?.lessons ?? ''));
    res.json({ ok: true });
  }),
);
