import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../lib/db';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireRole } from '../middleware/roles';
import { voidTaskMarkets, approveTask, getTaskMarketSummariesForTask, getTaskUtilitySummary } from '../services/tasks';

export const tasksRouter = Router();

tasksRouter.use(authMiddleware);

// --- Agent or admin: propose a task; admin only: post a bounty ---
// type='proposal' (default): agent proposes, admin approves/declines
// type='bounty': admin posts an executable task that agents can claim

tasksRouter.post('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { title, description, price, type = 'proposal' } = req.body;
  if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title is required' }); return; }
  if (typeof price !== 'number' || price <= 0) { res.status(400).json({ error: 'price must be a positive number' }); return; }
  if (type !== 'proposal' && type !== 'bounty') { res.status(400).json({ error: 'type must be "proposal" or "bounty"' }); return; }
  if (type === 'bounty' && req.auth!.role !== 'admin') { res.status(403).json({ error: 'Only admins can post bounties' }); return; }

  const proposedBy = req.auth!.agentId || 'admin';
  const status = type === 'bounty' ? 'open' : 'pending';

  const ref = db().collection('tasks').doc();
  await ref.set({
    id: ref.id,
    proposedBy,
    type,
    title,
    description: description || '',
    price,
    status,
    conditionalMarketIds: [],
    createdAt: FieldValue.serverTimestamp(),
  });

  res.status(201).json({ id: ref.id });
}));

// --- Agent or admin: list tasks ---
// Query params: ?type=proposal|bounty, ?status=open|claimed|delivered|completed|pending|approved|declined

tasksRouter.get('/', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const isAdmin = req.auth!.role === 'admin';
  const agentId = req.auth!.agentId;
  const { type, status } = req.query as Record<string, string>;

  let query: FirebaseFirestore.Query = db().collection('tasks').orderBy('createdAt', 'desc');

  if (type) query = query.where('type', '==', type);
  if (status) query = query.where('status', '==', status);

  // Non-admin agents: proposals they submitted + any open bounties
  if (!isAdmin && agentId) {
    if (type === 'bounty') {
      // Agents can browse bounties freely
    } else {
      query = query.where('proposedBy', '==', agentId);
    }
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

// --- Agent: claim an open bounty ---

tasksRouter.post('/:taskId/claim', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const taskRef = db().collection('tasks').doc(req.params.taskId as string);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  if (task.type !== 'bounty') { res.status(400).json({ error: 'Only bounty tasks can be claimed' }); return; }
  if (task.status !== 'open') { res.status(400).json({ error: 'Task is not open for claiming' }); return; }

  const agentId = req.auth!.agentId;
  if (!agentId) { res.status(403).json({ error: 'Admin cannot claim bounties' }); return; }

  await taskRef.update({ status: 'claimed', claimedBy: agentId, claimedAt: FieldValue.serverTimestamp() });
  res.json({ ok: true });
}));

// --- Agent: deliver output for a claimed bounty ---

tasksRouter.post('/:taskId/deliver', requireRole('agent', 'admin'), wrap(async (req, res) => {
  const { output } = req.body;
  if (!output || typeof output !== 'string') { res.status(400).json({ error: 'output is required' }); return; }

  const taskRef = db().collection('tasks').doc(req.params.taskId as string);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  if (task.type !== 'bounty') { res.status(400).json({ error: 'Only bounty tasks can be delivered' }); return; }
  if (task.status !== 'claimed') { res.status(400).json({ error: 'Task must be claimed before delivery' }); return; }

  const agentId = req.auth!.agentId;
  if (task.claimedBy !== agentId) { res.status(403).json({ error: 'Only the claiming agent can deliver' }); return; }

  await taskRef.update({ status: 'delivered', output, deliveredAt: FieldValue.serverTimestamp() });
  res.json({ ok: true });
}));

// --- Admin: complete a delivered bounty and pay the agent ---

tasksRouter.post('/:taskId/complete', requireRole('admin'), wrap(async (req, res) => {
  const taskRef = db().collection('tasks').doc(req.params.taskId as string);
  const taskDoc = await taskRef.get();
  if (!taskDoc.exists) { res.status(404).json({ error: 'Task not found' }); return; }

  const task = taskDoc.data()!;
  if (task.type !== 'bounty') { res.status(400).json({ error: 'Only bounty tasks can be completed' }); return; }
  if (task.status !== 'delivered') { res.status(400).json({ error: 'Task must be delivered before completion' }); return; }

  const agentRef = db().collection('agents').doc(task.claimedBy);
  const agentDoc = await agentRef.get();
  if (!agentDoc.exists) { res.status(404).json({ error: 'Claiming agent not found' }); return; }

  await db().runTransaction(async t => {
    t.update(taskRef, { status: 'completed', completedAt: FieldValue.serverTimestamp() });
    t.update(agentRef, {
      balance: FieldValue.increment(task.price),
      earnedTasks: FieldValue.increment(task.price),
    });
  });

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
