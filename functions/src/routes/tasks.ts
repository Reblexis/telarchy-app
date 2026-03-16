import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { voidTaskMarkets, approveTask, getTaskMarketSummariesForTask, getTaskUtilitySummary } from '../services/tasks';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

// --- Agent or admin: propose a task ---

tasksRouter.post('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { title, description, price } = req.body;
  if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title is required' }); return; }
  if (typeof price !== 'number' || price <= 0) { res.status(400).json({ error: 'price must be a positive number' }); return; }

  const proposedBy = req.auth!.agentId || 'admin';

  const ref = db().collection('tasks').doc();
  await ref.set({
    id: ref.id,
    proposedBy,
    title,
    description: description || '',
    price,
    status: 'pending',
    conditionalMarketIds: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: ref.id });
}));

// --- Agent or admin: list tasks ---

tasksRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;

  let query: FirebaseFirestore.Query = db().collection('tasks').orderBy('createdAt', 'desc');
  if (!isAdmin && agentId) query = query.where('proposedBy', '==', agentId);

  const snap = await query.get();
  res.json(snap.docs.map(d => d.data()));
}));

// --- Agent or admin: get task detail with market summaries ---

tasksRouter.get('/:taskId', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const doc = await db().collection('tasks').doc(req.params.taskId as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = doc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;

  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const markets = await getTaskMarketSummariesForTask(task.id);
  const utilitySummary = await getTaskUtilitySummary(markets);
  res.json({ ...task, markets, utilitySummary });
}));

// --- Admin: approve task ---

tasksRouter.post('/:taskId/approve', requireRole('admin'), wrap(async (req, res) => {
  await approveTask(req.params.taskId as string);
  res.json({ ok: true });
}));

// --- Admin: decline task ---

tasksRouter.post('/:taskId/decline', requireRole('admin'), wrap(async (req, res) => {
  const taskRef = db().collection('tasks').doc(req.params.taskId as string);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  if (task.status !== 'pending') { res.status(400).json({ error: 'Can only decline pending tasks' }); return; }

  await voidTaskMarkets(task.id);
  await taskRef.update({ status: 'declined' });

  res.json({ ok: true });
}));

// --- Agent or admin: get chat messages ---

tasksRouter.get('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const taskDoc = await db().collection('tasks').doc(req.params.taskId as string).get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const snap = await db().collection('tasks').doc(req.params.taskId as string)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get();

  res.json(snap.docs.map(d => d.data()));
}));

// --- Agent or admin: send chat message ---

tasksRouter.post('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }

  const taskDoc = await db().collection('tasks').doc(req.params.taskId as string).get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const from = agentId || 'admin';
  const ref = db().collection('tasks').doc(req.params.taskId as string).collection('messages').doc();
  await ref.set({
    id: ref.id,
    taskId: req.params.taskId,
    from,
    content,
    createdAt: FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: ref.id, from, content });
}));
