/**
 * Participant email notifications (owner ask 2026-08-19; the contract is
 * docs/vision.md, "Participant email notifications").
 *
 * Three switches, all on the participant row: a comment under a contract you
 * posted, a reply in a thread you are in (both on by default), and every new
 * contract on a workspace's ballot (off by default). This module owns who
 * gets mail and what it says; lib/notify.ts owns the transport.
 *
 * Two rules run through everything here:
 *
 * - **Never block the thing that triggered it.** Every entry point is called
 *   with `void`, and every failure inside is logged and swallowed, because a
 *   comment that 500s when Resend is down is a worse product than a comment
 *   that goes unannounced.
 * - **One person, one email per event.** A contract's poster who also
 *   commented in its thread matches two switches; they still get exactly one
 *   message, and it names the closer reason (it is their contract).
 */

import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents, authUser, markets, marketMessages, notificationReads, permissionGroups,
  proposals, proposalMessages, workspaces,
} from '../db/schema';
import { getParticipantDisplayNames } from '../lib/participants';
import { publicOrigin, sendEmail } from '../lib/notify';

/** Which switch produced a given message; also the line the email closes on. */
type Reason = 'my-proposal' | 'reply' | 'new-proposal' | 'decision';

const REASON_LINE: Record<Reason, string> = {
  'my-proposal': 'You are getting this because someone commented on a contract you posted.',
  reply: 'You are getting this because you commented in this thread.',
  'new-proposal': 'You are getting this because you asked to hear about new contracts here.',
  decision: 'You are getting this because you posted this contract. Decisions on your own contracts are always sent.',
};

/**
 * The column each reason reads, so a switch is checked in exactly one place.
 * `null` means the reason has no switch and always sends: a decision on your
 * own contract is the answer to a question you asked, usually with money on
 * it, so the only reason anyone would turn it off is by mistake.
 */
const REASON_COLUMN: Record<Reason, 'notifyCommentOnMyProposal' | 'notifyReplyToMyComment' | 'notifyNewProposal' | null> = {
  'my-proposal': 'notifyCommentOnMyProposal',
  reply: 'notifyReplyToMyComment',
  'new-proposal': 'notifyNewProposal',
  decision: null,
};

interface Recipient {
  participantId: string;
  email: string;
  reason: Reason;
}

/**
 * Turn { participantId -> reason } into addressable recipients: the switch for
 * that reason must be on, and the participant must have a browser account with
 * an address. A key-only bot and a GDPR-detached account both fall out here,
 * which is the intended behaviour and not an error worth logging.
 */
async function resolveRecipients(wanted: Map<string, Reason>): Promise<Recipient[]> {
  const ids = [...wanted.keys()];
  if (ids.length === 0) return [];

  const rows = await db.select({
    id: agents.id,
    email: authUser.email,
    notifyCommentOnMyProposal: agents.notifyCommentOnMyProposal,
    notifyReplyToMyComment: agents.notifyReplyToMyComment,
    notifyNewProposal: agents.notifyNewProposal,
  }).from(agents)
    .innerJoin(authUser, eq(agents.authUserId, authUser.id))
    .where(inArray(agents.id, ids));

  const out: Recipient[] = [];
  for (const row of rows) {
    const reason = wanted.get(row.id);
    if (!reason || !row.email) continue;
    const column = REASON_COLUMN[reason];
    if (column && !row[column]) continue;
    out.push({ participantId: row.id, email: row.email, reason });
  }
  return out;
}

/** Where the floor lives, for the "read and reply" link in every email. */
async function floorUrl(workspaceId: string, hash = ''): Promise<{ url: string; name: string }> {
  const [ws] = await db.select({ name: workspaces.name, slug: workspaces.slug })
    .from(workspaces).where(eq(workspaces.id, workspaceId));
  const origin = publicOrigin();
  const path = ws?.slug ? `/${ws.slug}` : `/marketplace/${workspaceId}`;
  return { url: `${origin}${path}${hash}`, name: ws?.name ?? 'Telarchy' };
}

/** Trim a comment down to something that reads as a preview in an inbox. */
function preview(content: string, max = 600): string {
  const trimmed = content.trim();
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}…`;
}

async function deliver(recipients: Recipient[], subject: string, body: (r: Recipient) => string): Promise<void> {
  for (const r of recipients) {
    await sendEmail(r.email, subject, body(r));
  }
}

/**
 * Someone posted a comment. Notifies the contract's poster (their contract)
 * and everyone else already in the thread (a reply), minus the author.
 *
 * Called for both comment surfaces: `proposalId` is a contract thread,
 * `marketId` a market thread. A market thread has no poster, so only the
 * reply switch can fire there.
 */
export async function notifyCommentPosted(opts: {
  workspaceId: string;
  from: string;
  content: string;
  proposalId?: string;
  marketId?: string;
}): Promise<void> {
  const { workspaceId, from, content, proposalId, marketId } = opts;
  try {
    // Reason precedence: the contract's poster is claimed first, so a poster
    // who also commented gets the my-proposal line rather than the reply one
    // and, either way, exactly one email.
    const wanted = new Map<string, Reason>();
    let subjectLabel: string;

    if (proposalId) {
      const [proposal] = await db.select({ title: proposals.title, proposedBy: proposals.proposedBy })
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      if (!proposal) return;
      subjectLabel = proposal.title;
      if (proposal.proposedBy !== from) wanted.set(proposal.proposedBy, 'my-proposal');

      const thread = await db.select({ from: proposalMessages.from }).from(proposalMessages)
        .where(and(eq(proposalMessages.workspaceId, workspaceId), eq(proposalMessages.proposalId, proposalId)))
        .orderBy(asc(proposalMessages.createdAt));
      for (const m of thread) {
        if (m.from !== from && !wanted.has(m.from)) wanted.set(m.from, 'reply');
      }
    } else if (marketId) {
      const [market] = await db.select({
        metricName: markets.metricName, targetDate: markets.targetDate, proposalId: markets.proposalId,
      }).from(markets)
        .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      if (!market) return;
      subjectLabel = `${market.metricName} ${market.targetDate}`;

      // A conditional market BELONGS to a contract, so a comment on one is
      // a comment about that contract and its poster is owed it exactly as
      // if it had landed in the contract's own thread. Without this, the
      // half of the conversation that happens on the branch markets is
      // silent to the one person being asked to do the work.
      if (market.proposalId) {
        const [proposal] = await db.select({ title: proposals.title, proposedBy: proposals.proposedBy })
          .from(proposals)
          .where(and(eq(proposals.id, market.proposalId), eq(proposals.workspaceId, workspaceId)));
        if (proposal) {
          subjectLabel = proposal.title;
          if (proposal.proposedBy !== from) wanted.set(proposal.proposedBy, 'my-proposal');
        }
      }

      const thread = await db.select({ from: marketMessages.from }).from(marketMessages)
        .where(and(eq(marketMessages.workspaceId, workspaceId), eq(marketMessages.marketId, marketId)))
        .orderBy(asc(marketMessages.createdAt));
      for (const m of thread) {
        if (m.from !== from && !wanted.has(m.from)) wanted.set(m.from, 'reply');
      }
    } else {
      return;
    }

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0) return;

    const names = await getParticipantDisplayNames([from]);
    const author = names.get(from) ?? from;
    const { url, name } = await floorUrl(workspaceId);
    const settings = await floorUrl(workspaceId, '#emails');

    await deliver(
      recipients,
      `${author} commented on "${subjectLabel}"`,
      r => [
        `${author} wrote under "${subjectLabel}" on ${name}:`,
        '',
        preview(content),
        '',
        `Read it and reply: ${url}`,
        '',
        REASON_LINE[r.reason],
        `Turn it off in account settings: ${settings.url}`,
      ].join('\n'),
    );
  } catch (e) {
    console.error('comment notification failed:', e);
  }
}

/**
 * A contract went on the ballot. Notifies every member of the workspace who
 * asked to hear about new contracts, minus the poster. Membership is the
 * permission groups' member lists, i.e. the same set the workspace itself
 * calls its participants.
 */
export async function notifyProposalCreated(opts: {
  workspaceId: string;
  proposedBy: string;
  title: string;
  description?: string;
}): Promise<void> {
  const { workspaceId, proposedBy, title, description } = opts;
  try {
    const groups = await db.select({ memberIds: permissionGroups.memberIds })
      .from(permissionGroups).where(eq(permissionGroups.workspaceId, workspaceId));

    const wanted = new Map<string, Reason>();
    for (const g of groups) {
      for (const id of (g.memberIds ?? [])) {
        if (id !== proposedBy) wanted.set(id, 'new-proposal');
      }
    }

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0) return;

    const names = await getParticipantDisplayNames([proposedBy]);
    const author = names.get(proposedBy) ?? proposedBy;
    const { url, name } = await floorUrl(workspaceId);
    const settings = await floorUrl(workspaceId, '#emails');

    await deliver(
      recipients,
      `New contract on ${name}: ${title}`,
      r => [
        `${author} put a contract on the ballot for ${name}:`,
        '',
        title,
        ...(description?.trim() ? ['', preview(description)] : []),
        '',
        `Price it: ${url}`,
        '',
        REASON_LINE[r.reason],
        `Turn it off in account settings: ${settings.url}`,
      ].join('\n'),
    );
  } catch (e) {
    console.error('new-contract notification failed:', e);
  }
}

/**
 * The owner decided on a contract: approved, declined, or declined as spam.
 * Mails the proposer, and only the proposer.
 *
 * This one has no switch (owner ask 2026-08-19). Every other email here is
 * news about someone else's activity, which a person is entitled to tune; a
 * decision is the answer to the question they asked by posting the contract,
 * with their ask price on it. Somebody who filed a job and closed the tab has
 * nothing else to bring them back, so the only reason this would ever be off
 * is a mis-click.
 *
 * The row is read back rather than passed in, so the mail can never disagree
 * with the record: call it after the decision is committed.
 */
export async function notifyProposalDecided(opts: {
  workspaceId: string;
  proposalId: string;
}): Promise<void> {
  const { workspaceId, proposalId } = opts;
  try {
    const [proposal] = await db.select({
      title: proposals.title,
      proposedBy: proposals.proposedBy,
      status: proposals.status,
      declineReason: proposals.declineReason,
      askUsd: proposals.askUsd,
    }).from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) return;

    const approved = proposal.status === 'approved';
    const declined = proposal.status === 'declined' || proposal.status === 'declined_spam';
    // Withdrawn is the proposer's own doing and removal is board cleanup for
    // rows that should not have been there; neither is a decision to report.
    if (!approved && !declined) return;

    const recipients = await resolveRecipients(new Map([[proposal.proposedBy, 'decision' as Reason]]));
    if (recipients.length === 0) return;

    const { url, name } = await floorUrl(workspaceId, `#contract=${encodeURIComponent(proposalId)}`);
    const settings = await floorUrl(workspaceId, '#emails');
    const verb = approved ? 'approved' : proposal.status === 'declined_spam' ? 'declined as spam' : 'declined';
    // A decline with no reason is a fact worth stating, not a blank space: it
    // tells the reader there is nothing further to read on the page either.
    const reason = approved ? null : (proposal.declineReason?.trim() || 'No reason was given.');

    await deliver(
      recipients,
      `${approved ? 'Approved' : 'Declined'}: ${proposal.title}`,
      r => [
        `${name} ${verb} your contract:`,
        '',
        proposal.title,
        ...(proposal.askUsd ? ['', `Your ask was $${proposal.askUsd}.`] : []),
        ...(reason ? ['', `Reason: ${preview(reason)}`] : []),
        '',
        `See it: ${url}`,
        '',
        REASON_LINE[r.reason],
        `Your other emails: ${settings.url}`,
      ].join('\n'),
    );
  } catch (e) {
    console.error('decision notification failed:', e);
  }
}

// ---------------------------------------------------------------------------
// The inbox
// ---------------------------------------------------------------------------

/**
 * What the bell shows (owner ask 2026-08-19). Deliberately NOT filtered by the
 * email switches: mail is an interruption a person tunes, the inbox is the
 * record, and a record with holes in it is worse than no record. Turning an
 * email off means "stop writing to me", never "hide it from me".
 *
 * Derived from the same tables the floor already keeps rather than written to
 * a feed table on every event. Six sources, one read each, merged and sorted:
 * a feed table would have to be backfilled to be useful on the day it ships
 * and could then drift from the thing it describes.
 */
export type NotificationKind = 'comment' | 'reply' | 'contract' | 'decision';

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  at: Date;
  /** Who caused it, as a display handle. Null for events with no actor. */
  actor: string | null;
  /** What it happened to: a contract title, or a market's name. */
  subject: string;
  /** The comment, the pitch, or the decline reason. May be empty. */
  detail: string;
  /** Where to go: the floor slug, plus the thread when there is one. */
  workspaceSlug: string | null;
  proposalId: string | null;
  marketId: string | null;
  /**
   * The comment this is about, when it is about one. The floor uses it to
   * scroll to that comment and flash it: landing a reader on the right page
   * and leaving them to find the line they were told about is most of the
   * way to not having linked at all.
   */
  commentId: string | null;
  /** Newer than the watermark and not read on its own. Set by the query. */
  unread: boolean;
}

/** One participant's inbox, newest first, with how many are unread. */
export async function listNotifications(participantId: string, limit = 30): Promise<{
  items: NotificationItem[];
  unread: number;
  seenAt: Date | null;
}> {
  const [me] = await db.select({ seenAt: agents.notificationsSeenAt })
    .from(agents).where(eq(agents.id, participantId));
  const seenAt = me?.seenAt ?? null;

  // Items read one at a time, on top of the watermark (owner ask: the count
  // goes down by one per click, not only all at once).
  const readRows = await db.select({ itemId: notificationReads.itemId })
    .from(notificationReads).where(eq(notificationReads.agentId, participantId));
  const readIds = new Set(readRows.map(r => r.itemId));

  // Where this participant is a member: the scope of "a new contract".
  const groups = await db.select({ workspaceId: permissionGroups.workspaceId, memberIds: permissionGroups.memberIds })
    .from(permissionGroups);
  const myWorkspaces = [...new Set(groups
    .filter(g => (g.memberIds ?? []).includes(participantId))
    .map(g => g.workspaceId))];

  // Threads this participant is in, so a reply can be recognised as a reply.
  const [myProposalThreads, myMarketThreads, myProposals] = await Promise.all([
    db.select({ proposalId: proposalMessages.proposalId }).from(proposalMessages)
      .where(eq(proposalMessages.from, participantId)),
    db.select({ marketId: marketMessages.marketId }).from(marketMessages)
      .where(eq(marketMessages.from, participantId)),
    db.select({ id: proposals.id, title: proposals.title, workspaceId: proposals.workspaceId,
      status: proposals.status, resolvedAt: proposals.resolvedAt, declineReason: proposals.declineReason })
      .from(proposals).where(eq(proposals.proposedBy, participantId)),
  ]);

  const myProposalIds = [...new Set(myProposals.map(p => p.id))];
  const inProposalThreads = [...new Set(myProposalThreads.map(t => t.proposalId))];
  const inMarketThreads = [...new Set(myMarketThreads.map(t => t.marketId))];
  const titleOf = new Map(myProposals.map(p => [p.id, p.title]));

  // Conditional markets belong to a contract, so their threads are part of
  // that contract's conversation (see notifyCommentPosted).
  const myBranchMarkets = myProposalIds.length === 0 ? [] : await db.select({
    id: markets.id, proposalId: markets.proposalId, metricName: markets.metricName,
  }).from(markets).where(inArray(markets.proposalId, myProposalIds));
  const branchOwner = new Map(myBranchMarkets.map(m => [m.id, m.proposalId!]));

  const watchedProposalIds = [...new Set([...myProposalIds, ...inProposalThreads])];
  const watchedMarketIds = [...new Set([...inMarketThreads, ...myBranchMarkets.map(m => m.id)])];

  const [proposalComments, marketComments, newContracts] = await Promise.all([
    watchedProposalIds.length === 0 ? [] : db.select({
      id: proposalMessages.id, proposalId: proposalMessages.proposalId, from: proposalMessages.from,
      content: proposalMessages.content, createdAt: proposalMessages.createdAt,
      workspaceId: proposalMessages.workspaceId,
    }).from(proposalMessages)
      .where(inArray(proposalMessages.proposalId, watchedProposalIds))
      .orderBy(desc(proposalMessages.createdAt)).limit(limit * 2),
    watchedMarketIds.length === 0 ? [] : db.select({
      id: marketMessages.id, marketId: marketMessages.marketId, from: marketMessages.from,
      content: marketMessages.content, createdAt: marketMessages.createdAt,
      workspaceId: marketMessages.workspaceId,
    }).from(marketMessages)
      .where(inArray(marketMessages.marketId, watchedMarketIds))
      .orderBy(desc(marketMessages.createdAt)).limit(limit * 2),
    myWorkspaces.length === 0 ? [] : db.select({
      id: proposals.id, title: proposals.title, description: proposals.description,
      proposedBy: proposals.proposedBy, createdAt: proposals.createdAt, workspaceId: proposals.workspaceId,
    }).from(proposals)
      .where(inArray(proposals.workspaceId, myWorkspaces))
      .orderBy(desc(proposals.createdAt)).limit(limit * 2),
  ]);

  // Market names for threads this participant joined but does not own.
  const namedMarketIds = [...new Set(marketComments.map(c => c.marketId))];
  const marketNames = namedMarketIds.length === 0 ? [] : await db.select({
    id: markets.id, metricName: markets.metricName, targetDate: markets.targetDate, proposalId: markets.proposalId,
  }).from(markets).where(inArray(markets.id, namedMarketIds));
  const marketLabel = new Map(marketNames.map(m => [m.id, `${m.metricName} ${m.targetDate}`]));

  const slugs = await workspaceSlugs([
    ...proposalComments.map(c => c.workspaceId),
    ...marketComments.map(c => c.workspaceId),
    ...newContracts.map(c => c.workspaceId),
    ...myProposals.map(p => p.workspaceId),
  ]);

  const actorIds = [
    ...proposalComments.map(c => c.from),
    ...marketComments.map(c => c.from),
    ...newContracts.map(c => c.proposedBy),
  ];
  const names = await getParticipantDisplayNames(actorIds);
  const handle = (id: string) => names.get(id) ?? id;

  const items: NotificationItem[] = [];

  for (const c of proposalComments) {
    if (c.from === participantId) continue;
    items.push({
      id: `pm-${c.id}`,
      kind: myProposalIds.includes(c.proposalId) ? 'comment' : 'reply',
      at: c.createdAt,
      actor: handle(c.from),
      subject: titleOf.get(c.proposalId) ?? 'a contract',
      detail: c.content,
      workspaceSlug: slugs.get(c.workspaceId) ?? null,
      proposalId: c.proposalId,
      marketId: null,
      commentId: c.id,
      unread: true,
    });
  }

  for (const c of marketComments) {
    if (c.from === participantId) continue;
    const owned = branchOwner.get(c.marketId);
    items.push({
      id: `mm-${c.id}`,
      kind: owned ? 'comment' : 'reply',
      at: c.createdAt,
      actor: handle(c.from),
      subject: owned ? (titleOf.get(owned) ?? 'a contract') : (marketLabel.get(c.marketId) ?? 'a market'),
      detail: c.content,
      workspaceSlug: slugs.get(c.workspaceId) ?? null,
      proposalId: owned ?? null,
      marketId: c.marketId,
      commentId: c.id,
      unread: true,
    });
  }

  for (const p of newContracts) {
    if (p.proposedBy === participantId) continue;
    items.push({
      id: `np-${p.id}`,
      kind: 'contract',
      at: p.createdAt,
      actor: handle(p.proposedBy),
      subject: p.title,
      detail: p.description ?? '',
      workspaceSlug: slugs.get(p.workspaceId) ?? null,
      proposalId: p.id,
      marketId: null,
      commentId: null,
      unread: true,
    });
  }

  // A decision on your own contract is the one thing here you were actually
  // waiting for, so it is in the inbox even though no email switch covers it.
  for (const p of myProposals) {
    if (!p.resolvedAt || p.status === 'pending' || p.status === 'withdrawn') continue;
    items.push({
      id: `dec-${p.id}`,
      kind: 'decision',
      at: p.resolvedAt,
      actor: null,
      subject: p.title,
      detail: p.status === 'approved' ? 'Approved.' : (p.declineReason || 'Declined.'),
      workspaceSlug: slugs.get(p.workspaceId) ?? null,
      proposalId: p.id,
      marketId: null,
      commentId: null,
      unread: true,
    });
  }

  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const i of items) {
    i.unread = !readIds.has(i.id) && (seenAt === null || i.at.getTime() > seenAt.getTime());
  }
  // Unread counts the WHOLE list, not the page: a badge that stops at the
  // page size tells you less the more there is to tell.
  const unread = items.filter(i => i.unread).length;
  return { items: items.slice(0, limit), unread, seenAt };
}

/**
 * Mark everything up to now as read. Returns the new watermark, and drops the
 * participant's per-item rows: the watermark now covers them, so keeping them
 * would only grow a table nobody reads.
 */
export async function markNotificationsSeen(participantId: string): Promise<Date> {
  const now = new Date();
  await db.update(agents).set({ notificationsSeenAt: now }).where(eq(agents.id, participantId));
  await db.delete(notificationReads).where(eq(notificationReads.agentId, participantId));
  return now;
}

/**
 * Mark ONE item read, which is what clicking a row does. Idempotent: a second
 * click on the same row is not a second decrement.
 */
export async function markNotificationRead(participantId: string, itemId: string): Promise<void> {
  await db.insert(notificationReads)
    .values({ agentId: participantId, itemId, readAt: new Date() })
    .onConflictDoNothing();
}

/** Slug per workspace id, for the links a notification row points at. */
async function workspaceSlugs(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces).where(inArray(workspaces.id, unique));
  return new Map(rows.filter(r => r.slug).map(r => [r.id, r.slug as string]));
}
