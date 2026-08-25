import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, authUser, feedback } from '../db/schema';
import { AppError } from '../lib/errors';
import {
  FEEDBACK_KINDS,
  FEEDBACK_LIMITS,
  FEEDBACK_STATUSES,
  isValidFeedbackKind,
  isValidFeedbackStatus,
  trimWithLimit,
} from '../lib/feedback-validation';
import { hasScope } from '../lib/scopes';
import { wrap } from '../lib/wrap';
import { optionalAuthMiddleware } from '../middleware/auth';

export const feedbackRouter = Router();

async function isPlatformAuthorized(req: {
  auth?: { isMasterKey?: boolean; uid?: string; agentId?: string };
}): Promise<boolean> {
  if (!req.auth) return false;
  if (req.auth.isMasterKey) return true;
  const agentId = req.auth.agentId;
  if (!agentId) return false;
  const [row] = await db.select({ platformAdmin: agents.platformAdmin }).from(agents).where(eq(agents.id, agentId));
  return row?.platformAdmin === true;
}

// Submit a bug report or help request. Anonymous submissions ARE allowed
// (the public floor has a report-a-bug button, and a visitor who hit a bug
// should be able to tell us without first making an account). Abuse is
// bounded by the dedicated per-IP feedback limiter in app.ts (anonymous
// callers only) plus the kind/length validation below; admin views render
// the stored text through React, so it is escaped. Signed-in and agent-key
// submissions are still attributed to their identity and workspace.
feedbackRouter.post(
  '/',
  optionalAuthMiddleware,
  wrap(async (req, res) => {
    // Agent-key callers still need the account:feedback scope. Browser
    // sessions, the master key, and anonymous callers have no scopes set.
    if (req.auth?.scopes && !hasScope(req.auth.scopes, 'account:feedback')) {
      throw new AppError('Forbidden: this API key is missing the "account:feedback" scope', 403);
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const kindRaw = typeof body.kind === 'string' ? body.kind.toLowerCase() : 'bug';
    if (!isValidFeedbackKind(kindRaw)) {
      throw new AppError(`kind must be one of: ${FEEDBACK_KINDS.join(', ')}`, 400);
    }
    const subject = trimWithLimit(body.subject, FEEDBACK_LIMITS.subject);
    if (!subject) throw new AppError('subject is required', 400);
    const message = trimWithLimit(body.body ?? body.message ?? body.description, FEEDBACK_LIMITS.body);
    if (!message) throw new AppError('body is required', 400);

    const url = trimWithLimit(body.url, FEEDBACK_LIMITS.url);
    const userAgent =
      trimWithLimit(req.headers['user-agent'], FEEDBACK_LIMITS.userAgent) ??
      trimWithLimit(body.userAgent, FEEDBACK_LIMITS.userAgent);

    let email = trimWithLimit(body.email, FEEDBACK_LIMITS.email);
    if (!email && req.auth?.uid) {
      const [u] = await db.select({ email: authUser.email }).from(authUser).where(eq(authUser.id, req.auth.uid));
      email = u?.email ?? null;
    }

    const id = randomUUID();
    const now = new Date();
    await db.insert(feedback).values({
      id,
      kind: kindRaw,
      subject,
      body: message,
      workspaceId: req.auth?.workspaceId || null,
      agentId: req.auth?.agentId ?? null,
      authUserId: req.auth?.uid ?? null,
      email,
      url,
      userAgent,
      status: 'open',
      adminNotes: '',
      createdAt: now,
      updatedAt: now,
    });

    res.status(201).json({ id, kind: kindRaw, status: 'open', createdAt: now.toISOString() });
  }),
);

// List feedback (platform admin / master key only). Default newest first.
feedbackRouter.get(
  '/',
  optionalAuthMiddleware,
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Forbidden', 403);
    }
    const { kind, status, limit: limitRaw } = req.query;
    const conds = [];
    if (typeof kind === 'string' && isValidFeedbackKind(kind)) conds.push(eq(feedback.kind, kind));
    if (typeof status === 'string' && isValidFeedbackStatus(status)) conds.push(eq(feedback.status, status));
    const limit = Math.min(typeof limitRaw === 'string' ? Math.max(1, parseInt(limitRaw, 10) || 0) : 100, 500);
    const where = conds.length === 0 ? undefined : conds.length === 1 ? conds[0] : and(...conds);

    const rows = await (where ? db.select().from(feedback).where(where) : db.select().from(feedback))
      .orderBy(desc(feedback.createdAt))
      .limit(limit);

    res.json({
      items: rows.map(r => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    });
  }),
);

// Stats: counts by kind/status. Useful for the admin badge in the UI.
feedbackRouter.get(
  '/stats',
  optionalAuthMiddleware,
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Forbidden', 403);
    }
    const rows = await db
      .select({
        kind: feedback.kind,
        status: feedback.status,
        count: sql<number>`count(*)::int`,
      })
      .from(feedback)
      .groupBy(feedback.kind, feedback.status);
    res.json({ groups: rows });
  }),
);

// Update feedback status / admin notes (platform admin / master key only).
feedbackRouter.patch(
  '/:id',
  optionalAuthMiddleware,
  wrap(async (req, res) => {
    if (!(await isPlatformAuthorized(req))) {
      throw new AppError('Forbidden', 403);
    }
    const id = req.params.id as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const update: { status?: string; adminNotes?: string; updatedAt: Date } = { updatedAt: new Date() };
    if (typeof body.status === 'string') {
      if (!isValidFeedbackStatus(body.status)) {
        throw new AppError(`status must be one of: ${FEEDBACK_STATUSES.join(', ')}`, 400);
      }
      update.status = body.status;
    }
    if (typeof body.adminNotes === 'string') {
      update.adminNotes = body.adminNotes.slice(0, FEEDBACK_LIMITS.notes);
    }
    if (update.status === undefined && update.adminNotes === undefined) {
      throw new AppError('Provide status and/or adminNotes', 400);
    }

    const [updated] = await db.update(feedback).set(update).where(eq(feedback.id, id)).returning();
    if (!updated) throw new AppError('Not found', 404);
    res.json({
      ...updated,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    });
  }),
);
