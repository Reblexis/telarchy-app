import { randomUUID } from 'crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, proposalMessages, proposals, workspaces } from '../db/schema';
import { branchIsShown } from '../lib/market-pairs';
import { notifyOwner } from '../lib/notify';
import { publicOrigin } from '../lib/origin';
import { getParticipantDisplayNames } from '../lib/participants';
import { MIN_LIQUIDITY_CONTRIBUTION, validateContent } from '../lib/validation';
import { wrap } from '../lib/wrap';
import { requireCapability } from '../middleware/roles';
import { emitEvent } from '../services/events';
import { notifyCommentPosted, notifyProposalCreated, notifyProposalDecided } from '../services/notifications';
import {
  approveProposal,
  countPendingProposalsByProposer,
  createConditionalMarkets,
  declineProposal,
  declineProposalAsSpam,
  editProposalDefinition,
  getProposalMarketSummariesForProposal,
  proposalRevisionsFor,
  removeProposal,
  withdrawProposal,
} from '../services/proposals';

export const proposalsRouter = Router();

proposalsRouter.post(
  '/',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { title, description, liquiditySubsidy, askUsd, payoutHandle } = req.body;
    if (!title || typeof title !== 'string') {
      res.status(400).json({ error: 'title is required' });
      return;
    }
    // 80 characters: a job title is a task name, not a pitch. It must fit
    // the rail row and the conditional headline without swallowing either
    // (owner direction 2026-08-10); the description field holds the rest.
    const titleError = validateContent(title, 'title', 80);
    if (titleError) {
      res.status(400).json({ error: titleError });
      return;
    }
    if (description !== undefined) {
      const descError = validateContent(description, 'description');
      if (descError) {
        res.status(400).json({ error: descError });
        return;
      }
    }

    // The job's price, stored as a number. Under the paid-jobs charter this
    // feeds burn inside the resolving metric, so it must not reach the metric
    // through prose: a title the parser does not expect makes the metric
    // silently wrong, and titles are mutable in a way the metric must not be.
    let ask: number | null = null;
    if (askUsd !== undefined && askUsd !== null) {
      if (typeof askUsd !== 'number' || !Number.isInteger(askUsd) || askUsd < 0) {
        res.status(400).json({ error: 'askUsd must be a non-negative whole number of USD' });
        return;
      }
      if (askUsd > 1_000_000) {
        res.status(400).json({ error: 'askUsd is implausibly large' });
        return;
      }
      if (askUsd > 0 && typeof payoutHandle === 'string' && payoutHandle.trim().length > 0) {
        if (payoutHandle.trim().length < 5) {
          res
            .status(400)
            .json({ error: 'payoutHandle must be at least 5 characters (a PayPal email, IBAN, or crypto address)' });
          return;
        }
        if (payoutHandle.trim().length > 200) {
          res.status(400).json({ error: 'payoutHandle must be at most 200 characters' });
          return;
        }
      }
      ask = askUsd;
    }

    const proposedBy = req.auth!.agentId;
    if (!proposedBy) {
      res
        .status(403)
        .json({ error: 'Proposal creation requires a participant identity. Visit your account page to finish setup.' });
      return;
    }

    // A non-zero ask is a payment the owner must be able to make the moment
    // they approve; a job with no way to receive it is a stuck promise. The
    // handle lives on the account (owner decision 2026-08-10, set via
    // POST /api/auth/profile { payoutHandle } or the account menu) and is
    // snapshotted onto the proposal here; a handle passed in the body wins
    // for this proposal without touching the account.
    let payout: string | null = typeof payoutHandle === 'string' && payoutHandle.trim() ? payoutHandle.trim() : null;
    if ((ask ?? 0) > 0 && !payout) {
      const [proposerRow] = await db
        .select({ payoutHandle: agents.payoutHandle })
        .from(agents)
        .where(eq(agents.id, proposedBy));
      payout = proposerRow?.payoutHandle ?? null;
      if (!payout) {
        res.status(400).json({
          error:
            'A paid job needs payment details on your account first: where should the money go? Set it in the account menu ("Set payment details") or via POST /api/auth/profile { payoutHandle } (PayPal email, IBAN, or crypto address).',
        });
        return;
      }
    }

    // The pending cap is a brake on what strangers can queue for a reviewer
    // to look at; a reviewer's own queue is theirs to manage, so the cap never
    // applies to anyone holding manage here: the owner, the admins they added,
    // a platform admin acting on this floor (docs/guides/proposals.md, owner
    // ask 2026-09-02). The creator row is not the test: the Telarchy and
    // LookPilot floors were created by the admin account, and the owner posts
    // there as a platform admin.
    const [wsForCap] = await db
      .select({ maxPending: workspaces.maxPendingProposalsPerParticipant })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    const cap = wsForCap?.maxPending ?? 0;
    const canReview = req.auth!.capabilities.has('manage');
    if (cap > 0 && !canReview) {
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
      res
        .status(400)
        .json({ error: `liquiditySubsidy must be at least ${MIN_LIQUIDITY_CONTRIBUTION} credits per market when set` });
      return;
    }

    const id = randomUUID();

    await db.insert(proposals).values({
      id,
      workspaceId,
      proposedBy,
      title,
      description: description || '',
      payoutHandle: payout,
      askUsd: ask,
      status: 'pending',
      conditionalMarketIds: [],
      liquiditySubsidy: subsidy,
      subsidyContributions: subsidy > 0 ? { [proposedBy]: subsidy } : {},
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
        contributions: subsidy > 0 ? { [proposedBy]: subsidy } : {},
        strict: true,
      });
      if (conditionalMarketIds.length > 0) {
        await db
          .update(proposals)
          .set({ conditionalMarketIds })
          .where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));
      }
    } catch (e) {
      console.error(`createConditionalMarkets failed for proposal ${id}:`, e);
      if (subsidy > 0) {
        // The proposal row is inserted before the spawn, so without this
        // delete a failed stake leaves a pending proposal that LOOKS funded
        // (subsidyContributions records the intent) while the hourly
        // reconcile later respawns its markets non-strict, skipping the
        // broke contributor and shipping them at zero liquidity. On a
        // public jobs board that is a proposal displaying a stake it never
        // paid. A 400 must leave nothing behind.
        await db.delete(proposals).where(and(eq(proposals.id, id), eq(proposals.workspaceId, workspaceId)));
        res.status(400).json({ error: e instanceof Error ? e.message : 'Failed to create conditional markets' });
        return;
      }
    }

    emitEvent(
      'proposal:created',
      {
        proposalId: id,
        title,
        proposedBy,
        liquiditySubsidy: subsidy,
        conditionalMarketCount: conditionalMarketIds.length,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));

    // Participants who asked to hear about new proposals here (off by default,
    // docs/vision.md "Participant email notifications").
    void notifyProposalCreated({ workspaceId, proposedBy, title, description });

    // The owner reviews the ballot; a new job they never hear about is a
    // silent decline by accident (owner decision 2026-08-10: notify).
    void notifyOwner(
      `Telarchy: new job proposed - ${title}`,
      `${proposedBy} put a job on the ballot:\n\n${title}\n\n${description || '(no pitch)'}\n\nReview: ${publicOrigin()}/floors`,
    );

    res.status(201).json({ id, conditionalMarketIds, liquiditySubsidy: subsidy });
  }),
);

proposalsRouter.get(
  '/',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const { status } = req.query as Record<string, string>;

    let rows = await db
      .select()
      .from(proposals)
      .where(eq(proposals.workspaceId, workspaceId))
      .orderBy(desc(proposals.createdAt));

    // Removed jobs are off the board for everyone; the row survives only so the
    // ledger entries that reference its markets keep resolving. Asking for them
    // explicitly (?status=removed) still works, for an admin auditing a removal.
    if (status) rows = rows.filter(t => t.status === status);
    else rows = rows.filter(t => t.status !== 'removed');

    const names = await getParticipantDisplayNames(rows.map(t => t.proposedBy));
    // Payment information goes to the person who pays, nobody else.
    const canSeePayout = req.auth!.capabilities.has('manage');

    res.json(
      rows.map(t => ({
        id: t.id,
        title: t.title,
        ...(canSeePayout ? { payoutHandle: t.payoutHandle ?? null } : {}),
        description:
          typeof t.description === 'string' && t.description.length > 150
            ? t.description.slice(0, 150) + '…'
            : (t.description ?? ''),
        status: t.status,
        // The job's price. Load-bearing rather than cosmetic: the LookPilot sync
        // computes burn as the sum of ask_usd over approved proposals by reading
        // THIS endpoint, and a consumer that skips null asks silently reports zero
        // burn no matter how much has been paid out.
        askUsd: t.askUsd ?? null,
        proposedBy: t.proposedBy,
        proposedByName: names.get(t.proposedBy) ?? null,
        liquiditySubsidy: t.liquiditySubsidy,
        rewardPaid: t.rewardPaid,
        penaltyCharged: t.penaltyCharged,
        resolvedAt: t.resolvedAt,
        resolvedBy: t.resolvedBy,
        // Not truncated like description: the reason is short by nature and a
        // client showing "why not" needs the whole sentence, not the first 150
        // characters of it.
        declineReason: t.declineReason,
        createdAt: t.createdAt,
      })),
    );
  }),
);

proposalsRouter.get(
  '/:proposalId',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    const allMarkets = await getProposalMarketSummariesForProposal(proposal.id, workspaceId);
    // Each pair currently contains up to two LMSR markets (approved + declined).
    // branchMarketCount is the count of actually-spawned markets, used by the
    // frontend to display the real upfront subsidy cost, so it counts what was
    // spawned rather than what is still worth reading.
    const branchMarketCount = allMarkets.reduce((n, p) => n + (p.approved ? 1 : 0) + (p.declined ? 1 : 0), 0);
    // What is worth reading is the ballot's rule: a voided pair is the record
    // of a decided proposal and dead weight on a pending one
    // (lib/market-pairs.ts). This endpoint is the one Otto is told to fetch a
    // proposal's pricing from, so a retired horizon returned here would put
    // back exactly what the brief stopped doing.
    const proposalMarkets = allMarkets
      .map(pair => ({
        ...pair,
        approved: pair.approved && branchIsShown(proposal.status, pair.approved.voided) ? pair.approved : null,
        declined: pair.declined && branchIsShown(proposal.status, pair.declined.voided) ? pair.declined : null,
      }))
      .filter(pair => pair.approved || pair.declined)
      .map(pair => ({
        ...pair,
        delta:
          pair.approved?.consensus != null && pair.declined?.consensus != null
            ? pair.approved.consensus - pair.declined.consensus
            : null,
      }));
    const names = await getParticipantDisplayNames([proposal.proposedBy]);
    // Payment information goes to the person who pays (and its owner),
    // nobody else: strip the handle from the spread for plain members.
    const canSeePayout = req.auth!.capabilities.has('manage') || req.auth!.agentId === proposal.proposedBy;
    const { payoutHandle: rawHandle, ...publicRow } = proposal;
    res.json({
      ...publicRow,
      ...(canSeePayout ? { payoutHandle: rawHandle ?? null } : {}),
      proposedByName: names.get(proposal.proposedBy) ?? null,
      markets: proposalMarkets,
      marketCount: proposalMarkets.length,
      branchMarketCount,
    });
  }),
);

proposalsRouter.post(
  '/:proposalId/approve',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const result = await approveProposal(proposalId, workspaceId, agentId ?? null);
    emitEvent(
      'proposal:status_changed',
      {
        proposalId,
        fromStatus: 'pending',
        toStatus: 'approved',
        decidedBy: agentId ?? null,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
    // The person who filed it is owed the answer, whichever way it went.
    void notifyProposalDecided({ workspaceId, proposalId });
    res.json({ ok: true, rewardPaid: result.rewardPaid });
  }),
);

proposalsRouter.post(
  '/:proposalId/decline',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const { declineReason, refund } = req.body ?? {};
    if (declineReason !== undefined && declineReason !== null && typeof declineReason !== 'string') {
      res.status(400).json({ error: 'declineReason must be a string' });
      return;
    }
    // refund=true voids both branches so the proposer's stake comes fully back
    // (a genuine idea the owner is not taking), rather than keeping the declined
    // branch live for calibration.
    await declineProposal(proposalId, workspaceId, agentId ?? null, declineReason ?? null, refund === true);
    emitEvent(
      'proposal:status_changed',
      {
        proposalId,
        fromStatus: 'pending',
        toStatus: 'declined',
        decidedBy: agentId ?? null,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
    // The person who filed it is owed the answer, whichever way it went.
    void notifyProposalDecided({ workspaceId, proposalId });
    res.json({ ok: true });
  }),
);

proposalsRouter.post(
  '/:proposalId/decline-spam',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const result = await declineProposalAsSpam(proposalId, workspaceId, agentId ?? null);
    emitEvent(
      'proposal:status_changed',
      {
        proposalId,
        fromStatus: 'pending',
        toStatus: 'declined-spam',
        decidedBy: agentId ?? null,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
    // The person who filed it is owed the answer, whichever way it went.
    void notifyProposalDecided({ workspaceId, proposalId });
    res.json({ ok: true, penaltyCharged: result.penaltyCharged });
  }),
);

// Take a job off the board entirely. Admin-only, and separate from decline:
// declining is a decision that stays on the record, this is for entries that
// should never have been on the board (spam, duplicates, test rows).
proposalsRouter.delete(
  '/:proposalId',
  requireCapability('manage'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    await removeProposal(proposalId, workspaceId, agentId ?? null);
    emitEvent(
      'proposal:status_changed',
      {
        proposalId,
        fromStatus: 'any',
        toStatus: 'removed',
        decidedBy: agentId ?? null,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
    res.json({ ok: true, status: 'removed' });
  }),
);

/**
 * Edit a proposal: its title, its description, its price.
 *
 * `trade` is the capability floor because the proposer is a trader, not a
 * manager; who may actually edit THIS proposal (its proposer, or anyone with
 * manage) is decided in the service, next to the rest of the rules. See
 * docs/market-integrity.md I1b for why the words edit in place and the price
 * only moves while the pair is untraded.
 */
proposalsRouter.patch(
  '/:proposalId',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const { title, description, askUsd } = req.body ?? {};

    if (title === undefined && description === undefined && askUsd === undefined) {
      res.status(400).json({ error: 'Pass at least one of title, description, askUsd' });
      return;
    }
    if (title !== undefined) {
      if (typeof title !== 'string') {
        res.status(400).json({ error: 'title must be a string' });
        return;
      }
      // Same 80 characters as creation: a proposal title is a task name that has
      // to fit the rail row and the conditional headline.
      const err = validateContent(title, 'title', 80);
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    if (description !== undefined) {
      if (typeof description !== 'string') {
        res.status(400).json({ error: 'description must be a string' });
        return;
      }
      const err = validateContent(description, 'description');
      if (err) {
        res.status(400).json({ error: err });
        return;
      }
    }
    if (askUsd !== undefined && askUsd !== null) {
      if (typeof askUsd !== 'number' || !Number.isInteger(askUsd) || askUsd < 0) {
        res.status(400).json({ error: 'askUsd must be a non-negative whole number of USD' });
        return;
      }
      if (askUsd > 1_000_000) {
        res.status(400).json({ error: 'askUsd is implausibly large' });
        return;
      }
    }

    const result = await editProposalDefinition(
      proposalId,
      workspaceId,
      { title, description, askUsd },
      { agentId, canManage: req.auth!.capabilities.has('manage') },
    );
    res.json({ ok: true, ...result });
  }),
);

/** What changed on a proposal, and when: the log the floor renders beside it. */
proposalsRouter.get(
  '/:proposalId/revisions',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const rows = await proposalRevisionsFor(req.params.proposalId as string, workspaceId);
    res.json({
      revisions: rows.map(r => ({
        field: r.field,
        oldValue: r.oldValue,
        newValue: r.newValue,
        at: r.createdAt,
      })),
    });
  }),
);

proposalsRouter.post(
  '/:proposalId/withdraw',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId, agentId } = req.auth!;
    if (!agentId) {
      res.status(403).json({ error: 'Withdraw requires a participant identity.' });
      return;
    }
    const proposalId = req.params.proposalId as string;
    await withdrawProposal(proposalId, workspaceId, agentId);
    emitEvent(
      'proposal:status_changed',
      {
        proposalId,
        fromStatus: 'pending',
        toStatus: 'withdrawn',
        decidedBy: agentId,
      },
      workspaceId,
    ).catch(e => console.error('emitEvent failed:', e));
    res.json({ ok: true });
  }),
);

proposalsRouter.get(
  '/:proposalId/messages',
  requireCapability('read'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const [proposal] = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    const messages = await db
      .select()
      .from(proposalMessages)
      .where(and(eq(proposalMessages.workspaceId, workspaceId), eq(proposalMessages.proposalId, proposalId)))
      .orderBy(asc(proposalMessages.createdAt));

    const names = await getParticipantDisplayNames(messages.map(m => m.from));
    res.json(messages.map(m => ({ ...m, fromName: names.get(m.from) ?? null })));
  }),
);

proposalsRouter.post(
  '/:proposalId/messages',
  requireCapability('trade'),
  wrap(async (req, res) => {
    const { workspaceId } = req.auth!;
    const proposalId = req.params.proposalId as string;
    const { content } = req.body;
    if (!content || typeof content !== 'string') {
      res.status(400).json({ error: 'content is required' });
      return;
    }
    const contentError = validateContent(content, 'content', 5_000);
    if (contentError) {
      res.status(400).json({ error: contentError });
      return;
    }

    const [proposal] = await db
      .select()
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) {
      res.status(404).json({ error: 'Proposal not found' });
      return;
    }

    const agentId = req.auth!.agentId;
    const from = agentId || 'admin';
    const id = randomUUID();
    await db.insert(proposalMessages).values({ id, workspaceId, proposalId, from, content, createdAt: new Date() });

    // Tell the people this comment is addressed to (docs/vision.md,
    // "Participant email notifications"): the proposal's poster and anyone
    // already in the thread. Fire-and-forget: posting must not wait on mail.
    void notifyCommentPosted({ workspaceId, from, content, proposalId });

    const names = await getParticipantDisplayNames([from]);
    res.status(201).json({ id, from, fromName: names.get(from) ?? null, content });
  }),
);
