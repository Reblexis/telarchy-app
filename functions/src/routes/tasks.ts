import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { wsCol } from '../lib/workspace';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { voidTaskMarkets, approveTask, getTaskMarketSummariesForTask, getTaskUtilitySummary } from '../services/tasks';
import { validateContent } from '../lib/validation';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

// --- Agent or admin: propose a task; admin only: post a bounty ---
// type='proposal' (default): agent proposes, admin approves/declines
// type='bounty': admin posts an executable task that agents can claim

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

  const proposedBy = req.auth!.agentId || 'admin';

  const ref = wsCol(workspaceId, 'tasks').doc();
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
// Query params: ?status=pending|approved|declined

tasksRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  const { status } = req.query as Record<string, string>;

  let query: FirebaseFirestore.Query = wsCol(workspaceId, 'tasks').orderBy('createdAt', 'desc');

  if (status) query = query.where('status', '==', status);

  // Non-admin agents only see their own tasks
  if (!isAdmin && agentId) {
    query = query.where('proposedBy', '==', agentId);
  }

  const snap = await query.get();
  res.json(snap.docs.map(d => {
    const t = d.data();
    return {
      id: t.id,
      type: t.type,
      title: t.title,
      description: typeof t.description === 'string' && t.description.length > 150
        ? t.description.slice(0, 150) + '…'
        : (t.description ?? ''),
      price: t.price,
      status: t.status,
      proposedBy: t.proposedBy,
      claimedBy: t.claimedBy ?? null,
      createdAt: t.createdAt,
    };
  }));
}));

// --- Agent or admin: get task detail with market summaries ---

tasksRouter.get('/:taskId', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const doc = await wsCol(workspaceId, 'tasks').doc(req.params.taskId as string).get();
  if (!doc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = doc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;

  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const markets = await getTaskMarketSummariesForTask(task.id, workspaceId);
  const utilitySummary = await getTaskUtilitySummary(markets, workspaceId);
  res.json({ ...task, markets, utilitySummary });
}));

// --- Admin: approve task ---

tasksRouter.post('/:taskId/approve', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await approveTask(req.params.taskId as string, workspaceId);
  res.json({ ok: true });
}));

// --- Admin: decline task ---

tasksRouter.post('/:taskId/decline', requireRole('admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskRef = wsCol(workspaceId, 'tasks').doc(req.params.taskId as string);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  if (task.status !== 'pending') { res.status(400).json({ error: 'Can only decline pending tasks' }); return; }

  await voidTaskMarkets(task.id, workspaceId);
  await taskRef.update({ status: 'declined' });

  res.json({ ok: true });
}));

// --- Agent or admin: get chat messages ---

tasksRouter.get('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const taskDoc = await wsCol(workspaceId, 'tasks').doc(req.params.taskId as string).get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const snap = await wsCol(workspaceId, 'tasks').doc(req.params.taskId as string)
    .collection('messages')
    .orderBy('createdAt', 'asc')
    .get();

  res.json(snap.docs.map(d => d.data()));
}));

// --- Agent or admin: send chat message ---

tasksRouter.post('/:taskId/messages', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
  const contentError = validateContent(content, 'content', 5_000);
  if (contentError) { res.status(400).json({ error: contentError }); return; }

  const taskDoc = await wsCol(workspaceId, 'tasks').doc(req.params.taskId as string).get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  if (!isAdmin && task.proposedBy !== agentId) { res.status(403).json({ error: 'Forbidden' }); return; }

  const from = agentId || 'admin';
  const ref = wsCol(workspaceId, 'tasks').doc(req.params.taskId as string).collection('messages').doc();
  await ref.set({
    id: ref.id,
    taskId: req.params.taskId,
    from,
    content,
    createdAt: FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: ref.id, from, content });
}));
