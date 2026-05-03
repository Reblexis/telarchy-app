import { Router } from 'express';
import { db } from '../db/client';
import { proposals, proposalMessages } from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireCapability } from '../middleware/roles';
import { voidProposalMarkets, approveProposal, getProposalMarketSummariesForProposal, createConditionalMarkets } from '../services/proposals';
import { validateContent } from '../lib/validation';
import { getParticipantDisplayNames } from '../lib/participants';

export const proposalsRouter = Router();

proposalsRouter.use(authMiddleware);

proposalsRouter.post('/', requireCapability('trade'), wrap(async (req, res) => {
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
  if (!proposedBy) { res.status(403).json({ error: 'Proposal creation requires a participant identity. Visit your account page to finish setup.' }); return; }
  const id = randomUUID();

  await db.insert(proposals).values({
    id, workspaceId, proposedBy,
    title, description: description || '',
    status: 'pending', conditionalMarketIds: [], createdAt: new Date(),
  });

  // Spawn conditional markets inline so the proposer (and anyone reading
  // /proposals) sees a forecast immediately. Without this the approve flow has
  // nothing to price the proposal against — the chatbot failure mode the
  // product exists to replace. Failure here doesn't block the proposal; the
  // /predictions/markets/refresh path will retry and a stale empty list is
  // recoverable.
  let conditionalMarketIds: string[] = [];
  try {
    conditionalMarketIds = await createConditionalMarkets(id, workspaceId);
    if (conditionalMarketIds.length > 0) {
      await db.update(proposals).set({ conditionalMarketIds })
        .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));
    }
  } catch (e) {
    console.error(`createConditionalMarkets failed for proposal ${id}:`, e);
  }

  res.status(201).json({ id, conditionalMarketIds });
}));

proposalsRouter.get('/', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { status } = req.query as Record<string, string>;

  let rows = await db.select().from(proposals)
    .where(eq(proposals.workspaceId, workspaceId))
    .orderBy(desc(proposals.createdAt));

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

proposalsRouter.get('/:proposalId', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

  const proposalMarkets = await getProposalMarketSummariesForProposal(proposal.id, workspaceId);
  const names = await getParticipantDisplayNames([proposal.proposedBy]);
  res.json({
    ...proposal,
    proposedByName: names.get(proposal.proposedBy) ?? null,
    markets: proposalMarkets,
  });
}));

proposalsRouter.post('/:proposalId/approve', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  await approveProposal(req.params.proposalId as string, workspaceId);
  res.json({ ok: true });
}));

proposalsRouter.post('/:proposalId/decline', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }
  if (proposal.status !== 'pending') { res.status(400).json({ error: 'Can only decline pending proposals' }); return; }

  await voidProposalMarkets(proposal.id, workspaceId);
  await db.update(proposals).set({ status: 'declined' })
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));

  res.json({ ok: true });
}));

proposalsRouter.get('/:proposalId/messages', requireCapability('read'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

  const messages = await db.select().from(proposalMessages)
    .where(and(eq(proposalMessages.workspaceId, workspaceId), eq(proposalMessages.proposalId, proposalId)))
    .orderBy(asc(proposalMessages.createdAt));

  const names = await getParticipantDisplayNames(messages.map(m => m.from));
  res.json(messages.map(m => ({ ...m, fromName: names.get(m.from) ?? null })));
}));

proposalsRouter.post('/:proposalId/messages', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const { content } = req.body;
  if (!content || typeof content !== 'string') { res.status(400).json({ error: 'content is required' }); return; }
  const contentError = validateContent(content, 'content', 5_000);
  if (contentError) { res.status(400).json({ error: contentError }); return; }

  const [proposal] = await db.select().from(proposals)
    .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
  if (!proposal) { res.status(404).json({ error: 'Proposal not found' }); return; }

  const agentId = req.auth!.agentId;
  const from = agentId || 'admin';
  const id = randomUUID();
  await db.insert(proposalMessages).values({ id, workspaceId, proposalId, from, content, createdAt: new Date() });

  const names = await getParticipantDisplayNames([from]);
  res.status(201).json({ id, from, fromName: names.get(from) ?? null, content });
}));
