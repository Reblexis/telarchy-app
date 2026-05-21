import { Router } from 'express';
import { db } from '../db/client';
import { proposals, proposalMessages, workspaces } from '../db/schema';
import { eq, and, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { wrap } from '../lib/wrap';
import { authMiddleware } from '../middleware/auth';
import { requireCapability } from '../middleware/roles';
import {
  approveProposal,
  declineProposal,
  declineProposalAsSpam,
  withdrawProposal,
  countPendingProposalsByProposer,
  getProposalMarketSummariesForProposal,
  createConditionalMarkets,
} from '../services/proposals';
import { validateContent, MIN_LIQUIDITY_CONTRIBUTION } from '../lib/validation';
import { getParticipantDisplayNames } from '../lib/participants';
import { emitEvent } from '../services/events';

export const proposalsRouter = Router();

proposalsRouter.use(authMiddleware);

proposalsRouter.post('/', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId } = req.auth!;
  const { title, description, liquiditySubsidy } = req.body;
  if (!title || typeof title !== 'string') { res.status(400).json({ error: 'title is required' }); return; }
  const titleError = validateContent(title, 'title', 200);
  if (titleError) { res.status(400).json({ error: titleError }); return; }
  if (description !== undefined) {
    const descError = validateContent(description, 'description');
    if (descError) { res.status(400).json({ error: descError }); return; }
  }

  const proposedBy = req.auth!.agentId;
  if (!proposedBy) { res.status(403).json({ error: 'Proposal creation requires a participant identity. Visit your account page to finish setup.' }); return; }

  const [wsForCap] = await db.select({
    maxPending: workspaces.maxPendingProposalsPerParticipant,
  }).from(workspaces).where(eq(workspaces.id, workspaceId));
  const cap = wsForCap?.maxPending ?? 0;
  if (cap > 0) {
    const pending = await countPendingProposalsByProposer(workspaceId, proposedBy);
    if (pending >= cap) {
      res.status(429).json({
        error: `You have ${pending} pending proposals; this workspace allows at most ${cap} per participant. Wait for one to be reviewed, or withdraw it.`,
        pending,
        cap,
      });
      return;
    }
  }

  let subsidy: number;
  if (liquiditySubsidy === undefined || liquiditySubsidy === null) {
    subsidy = 0;
  } else if (typeof liquiditySubsidy !== 'number' || !Number.isFinite(liquiditySubsidy) || liquiditySubsidy < 0) {
    res.status(400).json({ error: 'liquiditySubsidy must be a non-negative number' });
    return;
  } else {
    subsidy = liquiditySubsidy;
  }
  if (subsidy > 0 && subsidy < MIN_LIQUIDITY_CONTRIBUTION) {
    res.status(400).json({ error: `liquiditySubsidy must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per market when set` });
    return;
  }

  const id = randomUUID();

  await db.insert(proposals).values({
    id, workspaceId, proposedBy,
    title, description: description || '',
    status: 'pending', conditionalMarketIds: [],
    liquiditySubsidy: subsidy,
    createdAt: new Date(),
  });

  // Spawn conditional markets inline so the proposer (and anyone reading
  // /proposals) sees a forecast immediately. With subsidy > 0, the
  // proposer is debited and each conditional market gets a real LP row;
  // with subsidy = 0, markets ship at zero liquidity and the UI shows a
  // "no signal" warning the proposer can correct via Add liquidity.
  let conditionalMarketIds: string[] = [];
  try {
    conditionalMarketIds = await createConditionalMarkets(id, workspaceId, {
      subsidyPerMarket: subsidy,
      proposerAgentId: subsidy > 0 ? proposedBy : null,
    });
    if (conditionalMarketIds.length > 0) {
      await db.update(proposals).set({ conditionalMarketIds })
        .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));
    }
  } catch (e) {
    console.error(`createConditionalMarkets failed for proposal ${id}:`, e);
    if (subsidy > 0) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to create conditional markets' });
      return;
    }
  }

  emitEvent('proposal:created', {
    proposalId: id, title, proposedBy, liquiditySubsidy: subsidy,
    conditionalMarketCount: conditionalMarketIds.length,
  }, workspaceId).catch(e => console.error('emitEvent failed:', e));

  res.status(201).json({ id, conditionalMarketIds, liquiditySubsidy: subsidy });
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
    liquiditySubsidy: t.liquiditySubsidy,
    rewardPaid: t.rewardPaid,
    penaltyCharged: t.penaltyCharged,
    resolvedAt: t.resolvedAt,
    resolvedBy: t.resolvedBy,
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
  // Each pair currently contains up to two LMSR markets (approved + declined).
  // branchMarketCount is the count of actually-spawned markets, used by the
  // frontend to display the real upfront subsidy cost.
  const branchMarketCount = proposalMarkets.reduce((n, p) => n + (p.approved ? 1 : 0) + (p.declined ? 1 : 0), 0);
  const names = await getParticipantDisplayNames([proposal.proposedBy]);
  res.json({
    ...proposal,
    proposedByName: names.get(proposal.proposedBy) ?? null,
    markets: proposalMarkets,
    marketCount: proposalMarkets.length,
    branchMarketCount,
  });
}));

proposalsRouter.post('/:proposalId/approve', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId, agentId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const result = await approveProposal(proposalId, workspaceId, agentId ?? null);
  emitEvent('proposal:status_changed', {
    proposalId, fromStatus: 'pending', toStatus: 'approved', decidedBy: agentId ?? null,
  }, workspaceId).catch(e => console.error('emitEvent failed:', e));
  res.json({ ok: true, rewardPaid: result.rewardPaid });
}));

proposalsRouter.post('/:proposalId/decline', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId, agentId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  await declineProposal(proposalId, workspaceId, agentId ?? null);
  emitEvent('proposal:status_changed', {
    proposalId, fromStatus: 'pending', toStatus: 'declined', decidedBy: agentId ?? null,
  }, workspaceId).catch(e => console.error('emitEvent failed:', e));
  res.json({ ok: true });
}));

proposalsRouter.post('/:proposalId/decline-spam', requireCapability('manage'), wrap(async (req, res) => {
  const { workspaceId, agentId } = req.auth!;
  const proposalId = req.params.proposalId as string;
  const result = await declineProposalAsSpam(proposalId, workspaceId, agentId ?? null);
  emitEvent('proposal:status_changed', {
    proposalId, fromStatus: 'pending', toStatus: 'declined-spam', decidedBy: agentId ?? null,
  }, workspaceId).catch(e => console.error('emitEvent failed:', e));
  res.json({ ok: true, penaltyCharged: result.penaltyCharged });
}));

proposalsRouter.post('/:proposalId/withdraw', requireCapability('trade'), wrap(async (req, res) => {
  const { workspaceId, agentId } = req.auth!;
  if (!agentId) { res.status(403).json({ error: 'Withdraw requires a participant identity.' }); return; }
  const proposalId = req.params.proposalId as string;
  await withdrawProposal(proposalId, workspaceId, agentId);
  emitEvent('proposal:status_changed', {
    proposalId, fromStatus: 'pending', toStatus: 'withdrawn', decidedBy: agentId,
  }, workspaceId).catch(e => console.error('emitEvent failed:', e));
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
