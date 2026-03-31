import { Router } from 'express';
import { db } from '../db/client';
import { tasks, taskMessages } from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { voidTaskMarkets, approveTask, getTaskMarketSummariesForTask, getTaskUtilitySummary } from '../services/tasks';
import { validateContent } from '../lib/validation';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

tasksRouter.post('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { title, description, price } = req.body;
  if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title is required' }); return; }
  const titleError = validateContent(title, 'title', 200);
  if (titleError) { res.status(400).json({ error: titleError }); return; }
  if (description !== undefined) {
    const descError = validateContent(description, 'description');
    if (descError) { res.status(400).json({ error: descError }); return; }
  }
  if (typeof price !== 'number' || price <= 0) { res.status(400).json({ error: 'price must be a positive number' }); return; }

  const proposedBy = req.auth!.agentId;
  if (!proposedBy) { res.status(403).json({ error: 'Task creation requires a participant identity. Visit your account page to finish setup.' }); return; }
  const id = randomUUID();

  await db.insert(tasks).values({
    id, workspaceId, proposedBy,
    title, description: description || '', price,
    status: 'pending', conditionalMarketIds: [], createdAt: new Date(),
  });

  res.status(201).json({ id });
}));

tasksRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  const { status } = req.query as Record<string, string>;

  let rows = await db.select().from(tasks)
    .where(eq(tasks.workspaceId, workspaceId))
    .orderBy(desc(tasks.createdAt));

  if (status) rows = rows.filter(t => t.status === status);
  if (!isAdmin && agentId) rows = rows.filter(t => t.proposedBy === agentId);

  res.json(rows.map(t => ({
    id: t.id,
    title: t.title,
    description: typeof t.description === 'string' && t.description.length > 150
      ? t.description.slice(0, 150) + '…'
      : (t.description ?? ''),
    price: t.price,
    status: t.status,
    proposedBy: t.proposedBy,
    createdAt: t.createdAt,
  })));
}));

tasksRouter.get('/:taskId', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const taskMarkets = await getTaskMarketSummariesForTask(task.id, workspaceId);
  const utilitySummary = await getTaskUtilitySummary(taskMarkets, workspaceId);
  res.json({ ...task, markets: taskMarkets, utilitySummary });
}));

tasksRouter.post('/:taskId/approve', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await approveTask(req.params.taskId as string, workspaceId);
  res.json({ ok: true });
}));

tasksRouter.post('/:taskId/decline', requireRole('admin'), wrap(async (req, res) => {
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

tasksRouter.get('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const messages = await db.select().from(taskMessages)
    .where(and(eq(taskMessages.workspaceId, workspaceId), eq(taskMessages.taskId, taskId)))
    .orderBy(asc(taskMessages.createdAt));

  res.json(messages);
}));

tasksRouter.post('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskId = req.params.taskId as string;
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
  const contentError = validateContent(content, 'content', 5_000);
  if (contentError) { res.status(400).json({ error: contentError }); return; }

  const [task] = await db.select().from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.workspaceId, workspaceId)));
  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const from = agentId || 'admin';
  const id = randomUUID();
  await db.insert(taskMessages).values({ id, workspaceId, taskId, from, content, createdAt: new Date() });

  res.status(201).json({ id, from, content });
}));
