/**
 * The X workbench's HTTP surface, mounted at /api/admin/x.
 * Governing doc: docs/x-workbench.md.
 *
 * Platform admin only, on every route: the log is the owner's own outreach and
 * the drafting spends his tokens.
 */
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { xReplies } from '../db/schema';
import { AppError } from '../lib/errors';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { wrap } from '../lib/wrap';
import {
  type DraftTurn,
  draftingConfigured,
  draftReply,
  fetchPost,
  getVoiceProfile,
  harvestSearch,
  parsePostId,
  recordReply,
  saveSearch,
  searchYield,
  setVoiceProfile,
  suggestSearch,
  summarise,
} from '../services/x-workbench';

export const xWorkbenchRouter = Router();

async function requireOwner(req: Parameters<typeof isPlatformAuthorized>[0]) {
  if (!(await isPlatformAuthorized(req))) {
    throw new AppError('Platform admin or master key required', 403);
  }
}

/** Read one public post by id or status URL. */
xWorkbenchRouter.post(
  '/lookup',
  wrap(async (req, res) => {
    await requireOwner(req);
    const id = parsePostId(String(req.body?.url ?? req.body?.id ?? ''));
    res.json({ post: await fetchPost(id) });
  }),
);

/**
 * Draft, or argue about a draft. `messages` carries the whole conversation so
 * "shorter" means shorter than the last one; the post text is passed in so a
 * broken X read does not block drafting (he can paste the text by hand).
 */
xWorkbenchRouter.post(
  '/draft',
  wrap(async (req, res) => {
    await requireOwner(req);
    const text = String(req.body?.postText ?? '').trim();
    if (!text) throw new AppError('postText is required', 400);
    const messages = Array.isArray(req.body?.messages)
      ? (req.body.messages as DraftTurn[]).filter(
          m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim(),
        )
      : [];
    const draft = await draftReply(
      { id: String(req.body?.postId ?? ''), author: req.body?.postAuthor, text },
      messages,
    );
    res.json({ draft });
  }),
);

/** Record what he actually sent. The id can come later, or never. */
xWorkbenchRouter.post(
  '/record',
  wrap(async (req, res) => {
    await requireOwner(req);
    const text = String(req.body?.text ?? '').trim();
    if (!text) throw new AppError('text is required', 400);
    const row = await recordReply({
      sourcePostId: parsePostId(String(req.body?.sourcePostId ?? '')),
      sourceAuthor: req.body?.sourceAuthor ?? null,
      sourceText: req.body?.sourceText ?? null,
      sourceFollowers: Number.isFinite(req.body?.sourceFollowers) ? req.body.sourceFollowers : null,
      text,
      replyId: req.body?.replyId ? parsePostId(String(req.body.replyId)) : null,
      searchId: req.body?.searchId ? String(req.body.searchId) : null,
    });
    res.status(201).json({ recorded: row });
  }),
);

/** Attach the reply's own id afterwards, which is what turns on metrics. */
xWorkbenchRouter.patch(
  '/record/:id',
  wrap(async (req, res) => {
    await requireOwner(req);
    const replyId = parsePostId(String(req.body?.replyId ?? ''));
    const [updated] = await db
      .update(xReplies)
      .set({ replyId })
      .where(eq(xReplies.id, String(req.params.id)))
      .returning();
    if (!updated) throw new AppError('No such recorded reply', 404);
    res.json({ recorded: updated });
  }),
);

/** The log, newest first, with the pattern across it (or an honest refusal). */
xWorkbenchRouter.get(
  '/log',
  wrap(async (req, res) => {
    await requireOwner(req);
    const rows = await db.select().from(xReplies).orderBy(desc(xReplies.createdAt)).limit(200);
    res.json({
      replies: rows,
      summary: summarise(rows),
      draftingConfigured: draftingConfigured(),
    });
  }),
);

/**
 * The next query to run by hand. X search needs a credential he has not
 * bought, so the loop is: this proposes, he runs it, he pastes back the ids.
 */
xWorkbenchRouter.post(
  '/searches/suggest',
  wrap(async (req, res) => {
    await requireOwner(req);
    const avoid = Array.isArray(req.body?.avoid) ? req.body.avoid.map(String).slice(0, 20) : [];
    res.json({ suggestion: await suggestSearch(avoid) });
  }),
);

/** Keep a query he decided to run, so its yield can be counted. */
xWorkbenchRouter.post(
  '/searches',
  wrap(async (req, res) => {
    await requireOwner(req);
    const query = String(req.body?.query ?? '').trim();
    if (!query) throw new AppError('query is required', 400);
    res.status(201).json({ search: await saveSearch(query, req.body?.rationale) });
  }),
);

/** Every query tried, with the posts, replies and likes it produced. */
xWorkbenchRouter.get(
  '/searches',
  wrap(async (req, res) => {
    await requireOwner(req);
    res.json({ searches: await searchYield() });
  }),
);

/** The ids he found by running one. Looks each up so he can pick. */
xWorkbenchRouter.post(
  '/searches/:id/harvest',
  wrap(async (req, res) => {
    await requireOwner(req);
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids.map(String).filter((x: string) => x.trim())
      : String(req.body?.ids ?? '')
          .split(/[\s,]+/)
          .filter(Boolean);
    if (!ids.length) throw new AppError('ids are required', 400);
    res.json(await harvestSearch(String(req.params.id), ids.slice(0, 25)));
  }),
);

/** The voice profile: his samples and the facts a draft may state. */
xWorkbenchRouter.get(
  '/profile',
  wrap(async (req, res) => {
    await requireOwner(req);
    res.json({ profile: await getVoiceProfile(), draftingConfigured: draftingConfigured() });
  }),
);

xWorkbenchRouter.put(
  '/profile',
  wrap(async (req, res) => {
    await requireOwner(req);
    await setVoiceProfile(String(req.body?.profile ?? ''));
    res.json({ ok: true });
  }),
);
