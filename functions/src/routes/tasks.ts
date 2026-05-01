import { Router } from 'express';
import { db } from '../db/client';
import { tasks, taskMessages } from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireCapability } from '../middleware/roles';
import { voidTaskMarkets, approveTask, getTaskMarketSummariesForTask, createConditionalMarkets } from '../services/tasks';
import { validateContent } from '../lib/validation';
import { getParticipantDisplayNames } from '../lib/participants';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

tasksRouter.post('/', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { title, description } = req.body;
  if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title is required' }); return; }
  const titleError = validateContent(title, 'title', 200);
  if (titleError) { res.status(400).json({ error: titleError }); return; }
  if (description !== undefined) {
    const descError = validateContent(description, 'description');
    if (descError) { res.status(400).json({ error: descError }); return; }
  }

  const proposedBy = req.auth!.agentId;
  if (!proposedBy) { res.status(403).json({ error: 'Task creation requires a participant identity. Visit your account page to finish setup.' }); return; }
  const id = randomUUID();

  await db.insert(tasks).values({
    id, workspaceId, proposedBy,
    title, description: description || '',
    status: 'pending', conditionalMarketIds: [], createdAt: new Date(),
  });

  // Spawn conditional markets inline so the proposer (and anyone reading
  // /tasks) sees a forecast immediately. Without this the approve flow has
  // nothing to price the proposal against — the chatbot failure mode the
  // product exists to replace. Failure here doesn't block the task; the
  // /predictions/markets/refresh path will retry and a stale empty list is
  // recoverable.
  let conditionalMarketIds: string[] = [];
  try {
    conditionalMarketIds = await createConditionalMarkets(id, workspaceId);
    if (conditionalMarketIds.length > 0) {
      await db.update(tasks).set({ conditionalMarketIds })
        .where(and(eq(tasks.id, id), eq(tasks.workspaceId, workspaceId)));
    }
  } catch (e) {
    console.error(`createConditionalMarkets failed for task ${id}:`, e);
  }

  res.status(201).json({ id, conditionalMarketIds });
}));

tasksRouter.get('/', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { status } = req.query as Record<string, string>;

  let rows = await db.select().from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(tasks.createdAt));

  if (status) rows = rows.filter(t => t.status === status);

  const names = await getParticipantDisplayNames(rows.map(t => t.proposedBy));

  res.json(rows.map(t => ({
    id: t.id,
    title: t.title,
    description: typeof t.description === 'string' && t.description.length > 150
      ? t.description.slice(0, 150) + '…'
      : (t.description ?? ''),
    status: t.status,
    proposedBy: t.proposedBy,
    proposedByName: names.get(t.proposedBy) ?? null,
    createdAt: t.createdAt,
  })));
}));

tasksRouter.get('/:taskId', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const taskMarkets = await getTaskMarketSummariesForTask(task.id, workspaceId);
  const names = await getParticipantDisplayNames([task.proposedBy]);
  res.json({
    ...task,
    proposedByName: names.get(task.proposedBy) ?? null,
    markets: taskMarkets,
  });
}));

tasksRouter.post('/:taskId/approve', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await approveTask(req.params.taskId as string, workspaceId);
  res.json({ ok: true });
}));

tasksRouter.post('/:taskId/decline', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }
  if (task.status !== 'pending') { res.status(400).json({ error: 'Can only decline pending tasks' }); return; }

  await voidTaskMarkets(task.id, workspaceId);
  await db.update(tasks).set({ status: 'declined' })
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));

  res.json({ ok: true });
}));

tasksRouter.get('/:taskId/messages', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const messages = await db.select().from(taskMessages)
    .where(and(eq(taskMessages.workspaceId, workspaceId), eq(taskMessages.taskId, taskId)))
    .orderBy(asc(taskMessages.createdAt));

  const names = await getParticipantDisplayNames(messages.map(m => m.from));
  res.json(messages.map(m => ({ ...m, fromName: names.get(m.from) ?? null })));
}));

tasksRouter.post('/:taskId/messages', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
  const contentError = validateContent(content, 'content', 5_000);
  if (contentError) { res.status(400).json({ error: contentError }); return; }

  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const agentId = req.auth!.agentId;
  const from = agentId || 'admin';
  const id = randomUUID();
  await db.insert(taskMessages).values({ id, workspaceId, taskId, from, content, createdAt: new Date() });

  const names = await getParticipantDisplayNames([from]);
  res.status(201).json({ id, from, fromName: names.get(from) ?? null, content });
}));
