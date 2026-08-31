/**
 * Participant email notifications (owner ask 2026-08-19; the contract is
 * docs/vision.md, "Participant email notifications").
 *
 * The switches all live on the participant row: a comment under a contract
 * you posted, a reply in a thread you are in, a market you traded settling,
 * a contract you traded or commented on being decided (all on by default),
 * and the two firehoses, every new contract and every comment on a workspace
 * (off by default). This module owns who gets mail and what it says;
 * lib/notify.ts owns the transport.
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

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents,
  authUser,
  marketMessages,
  markets,
  metricLogs,
  notificationReads,
  permissionGroups,
  proposalMessages,
  proposals,
  trades,
  workspaces,
} from '../db/schema';
import { periodEndInstant } from '../lib/date-utils';
import { type ChannelOverrides, channelOn, type NotificationKindId } from '../lib/notification-prefs';
import { publicOrigin, sendEmail } from '../lib/notify';
import { getParticipantDisplayNames } from '../lib/participants';
import { type PushPayload, pushConfigured, sendPushToParticipant } from '../lib/push';
import { readingIsStaleFor, settlingSoon } from '../lib/reading-freshness';

/** Which switch produced a given message; also the line the email closes on. */
type Reason =
  | 'my-proposal'
  | 'reply'
  | 'new-proposal'
  | 'decision'
  | 'decision-involved'
  | 'any-comment'
  | 'market-resolved';

const REASON_LINE: Record<Reason, string> = {
  'my-proposal': 'You are getting this because someone commented on a contract you posted.',
  reply: 'You are getting this because you commented in this thread.',
  'new-proposal': 'You are getting this because you asked to hear about new contracts here.',
  'any-comment': 'You are getting this because you asked to hear about every comment on this workspace.',
  decision: 'You are getting this because you posted this contract. Decisions on your own contracts are always sent.',
  'decision-involved': 'You are getting this because you traded or commented on this contract.',
  'market-resolved': 'You are getting this because you traded this market.',
};

/**
 * The column each reason reads, so a switch is checked in exactly one place.
 * `null` means the reason has no switch and always sends: a decision on your
 * own contract is the answer to a question you asked, usually with money on
 * it, so the only reason anyone would turn it off is by mistake.
 */
const REASON_COLUMN: Record<
  Reason,
  | 'notifyCommentOnMyProposal'
  | 'notifyReplyToMyComment'
  | 'notifyNewProposal'
  | 'notifyAnyComment'
  | 'notifyMarketResolved'
  | 'notifyContractDecided'
  | null
> = {
  'my-proposal': 'notifyCommentOnMyProposal',
  reply: 'notifyReplyToMyComment',
  'new-proposal': 'notifyNewProposal',
  'any-comment': 'notifyAnyComment',
  'market-resolved': 'notifyMarketResolved',
  'decision-involved': 'notifyContractDecided',
  decision: null,
};

/** The matrix kind each reason belongs to, for the web and mobile cells. */
const REASON_KIND: Record<Reason, NotificationKindId> = {
  'my-proposal': 'comment',
  reply: 'reply',
  'new-proposal': 'contract',
  'any-comment': 'anyComment',
  'market-resolved': 'settled',
  decision: 'decision',
  'decision-involved': 'decision',
};

interface Recipient {
  participantId: string;
  email: string;
  reason: Reason;
}

/**
 * The mobile channel's pass over the same wanted map the email pass uses:
 * one event, one recipient set, two transports. Gated per recipient by the
 * mobile cell of the reason's kind; needs no email address, because a push
 * subscription is its own address. Fire-and-forget like everything here.
 */
async function pushDeliver(wanted: Map<string, Reason>, payload: PushPayload): Promise<void> {
  try {
    if (!pushConfigured() || wanted.size === 0) return;
    const rows = await db
      .select({ id: agents.id, channels: agents.notificationChannels })
      .from(agents)
      .where(inArray(agents.id, [...wanted.keys()]));
    for (const row of rows) {
      const reason = wanted.get(row.id);
      if (!reason) continue;
      if (!channelOn(row.channels as ChannelOverrides | null, REASON_KIND[reason], 'mobile')) continue;
      await sendPushToParticipant(row.id, payload);
    }
  } catch (e) {
    console.error('push notification failed:', e);
  }
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

  const rows = await db
    .select({
      id: agents.id,
      email: authUser.email,
      notifyCommentOnMyProposal: agents.notifyCommentOnMyProposal,
      notifyReplyToMyComment: agents.notifyReplyToMyComment,
      notifyNewProposal: agents.notifyNewProposal,
      notifyAnyComment: agents.notifyAnyComment,
      notifyMarketResolved: agents.notifyMarketResolved,
      notifyContractDecided: agents.notifyContractDecided,
    })
    .from(agents)
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
  const [ws] = await db
    .select({ name: workspaces.name, slug: workspaces.slug })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId));
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
      const [proposal] = await db
        .select({ title: proposals.title, proposedBy: proposals.proposedBy })
        .from(proposals)
        .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
      if (!proposal) return;
      subjectLabel = proposal.title;
      if (proposal.proposedBy !== from) wanted.set(proposal.proposedBy, 'my-proposal');

      const thread = await db
        .select({ from: proposalMessages.from })
        .from(proposalMessages)
        .where(and(eq(proposalMessages.workspaceId, workspaceId), eq(proposalMessages.proposalId, proposalId)))
        .orderBy(asc(proposalMessages.createdAt));
      for (const m of thread) {
        if (m.from !== from && !wanted.has(m.from)) wanted.set(m.from, 'reply');
      }
    } else if (marketId) {
      const [market] = await db
        .select({
          metricName: markets.metricName,
          targetDate: markets.targetDate,
          proposalId: markets.proposalId,
        })
        .from(markets)
        .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
      if (!market) return;
      subjectLabel = `${market.metricName} ${market.targetDate}`;

      // A conditional market BELONGS to a contract, so a comment on one is
      // a comment about that contract and its poster is owed it exactly as
      // if it had landed in the contract's own thread. Without this, the
      // half of the conversation that happens on the branch markets is
      // silent to the one person being asked to do the work.
      if (market.proposalId) {
        const [proposal] = await db
          .select({ title: proposals.title, proposedBy: proposals.proposedBy })
          .from(proposals)
          .where(and(eq(proposals.id, market.proposalId), eq(proposals.workspaceId, workspaceId)));
        if (proposal) {
          subjectLabel = proposal.title;
          if (proposal.proposedBy !== from) wanted.set(proposal.proposedBy, 'my-proposal');
        }
      }

      const thread = await db
        .select({ from: marketMessages.from })
        .from(marketMessages)
        .where(and(eq(marketMessages.workspaceId, workspaceId), eq(marketMessages.marketId, marketId)))
        .orderBy(asc(marketMessages.createdAt));
      for (const m of thread) {
        if (m.from !== from && !wanted.has(m.from)) wanted.set(m.from, 'reply');
      }
    } else {
      return;
    }

    // Anyone watching the whole floor, claimed last so a person who is also
    // the poster or in the thread keeps the closer reason and still gets one
    // email rather than two.
    const watchers = await db
      .select({ memberIds: permissionGroups.memberIds })
      .from(permissionGroups)
      .where(eq(permissionGroups.workspaceId, workspaceId));
    for (const g of watchers) {
      for (const id of g.memberIds ?? []) {
        if (id !== from && !wanted.has(id)) wanted.set(id, 'any-comment');
      }
    }

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0 && wanted.size === 0) return;

    const names = await getParticipantDisplayNames([from]);
    const author = names.get(from) ?? from;
    const { url, name } = await floorUrl(workspaceId);
    const settings = await floorUrl(workspaceId, '#emails');

    await pushDeliver(wanted, {
      title: `${author} commented on "${subjectLabel}"`,
      body: preview(content, 160),
      url,
    });

    await deliver(recipients, `${author} commented on "${subjectLabel}"`, r =>
      [
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
    const groups = await db
      .select({ memberIds: permissionGroups.memberIds })
      .from(permissionGroups)
      .where(eq(permissionGroups.workspaceId, workspaceId));

    const wanted = new Map<string, Reason>();
    for (const g of groups) {
      for (const id of g.memberIds ?? []) {
        if (id !== proposedBy) wanted.set(id, 'new-proposal');
      }
    }

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0 && wanted.size === 0) return;

    const names = await getParticipantDisplayNames([proposedBy]);
    const author = names.get(proposedBy) ?? proposedBy;
    const { url, name } = await floorUrl(workspaceId);
    const settings = await floorUrl(workspaceId, '#emails');

    await pushDeliver(wanted, {
      title: `New contract on ${name}`,
      body: title,
      url,
    });

    await deliver(recipients, `New contract on ${name}: ${title}`, r =>
      [
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
export async function notifyProposalDecided(opts: { workspaceId: string; proposalId: string }): Promise<void> {
  const { workspaceId, proposalId } = opts;
  try {
    const [proposal] = await db
      .select({
        title: proposals.title,
        proposedBy: proposals.proposedBy,
        status: proposals.status,
        declineReason: proposals.declineReason,
        askUsd: proposals.askUsd,
        resolvedBy: proposals.resolvedBy,
      })
      .from(proposals)
      .where(and(eq(proposals.id, proposalId), eq(proposals.workspaceId, workspaceId)));
    if (!proposal) return;

    const approved = proposal.status === 'approved';
    const declined = proposal.status === 'declined' || proposal.status === 'declined_spam';
    // Withdrawn is the proposer's own doing and removal is board cleanup for
    // rows that should not have been there; neither is a decision to report.
    if (!approved && !declined) return;

    // The proposer first (switchless), then everyone else with money or words
    // on the outcome (owner ask 2026-08-24): whoever traded either branch or
    // commented anywhere in the contract's conversation. The decider is never
    // told about their own act.
    const wanted = new Map<string, Reason>([[proposal.proposedBy, 'decision' as Reason]]);
    const pairMarkets = await db
      .select({ id: markets.id })
      .from(markets)
      .where(and(eq(markets.workspaceId, workspaceId), eq(markets.proposalId, proposalId)));
    const pairIds = pairMarkets.map(m => m.id);
    const [pairTraders, threadVoices, branchVoices] = await Promise.all([
      pairIds.length === 0
        ? []
        : db
            .select({ id: trades.agentId })
            .from(trades)
            .where(and(eq(trades.workspaceId, workspaceId), inArray(trades.marketId, pairIds))),
      db
        .select({ id: proposalMessages.from })
        .from(proposalMessages)
        .where(and(eq(proposalMessages.workspaceId, workspaceId), eq(proposalMessages.proposalId, proposalId))),
      pairIds.length === 0
        ? []
        : db
            .select({ id: marketMessages.from })
            .from(marketMessages)
            .where(and(eq(marketMessages.workspaceId, workspaceId), inArray(marketMessages.marketId, pairIds))),
    ]);
    for (const r of [...pairTraders, ...threadVoices, ...branchVoices]) {
      if (r.id !== proposal.resolvedBy && !wanted.has(r.id)) wanted.set(r.id, 'decision-involved');
    }
    if (proposal.resolvedBy) wanted.delete(proposal.resolvedBy);

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0 && wanted.size === 0) return;

    const { url, name } = await floorUrl(workspaceId, `#contract=${encodeURIComponent(proposalId)}`);
    const settings = await floorUrl(workspaceId, '#emails');
    const verb = approved ? 'approved' : proposal.status === 'declined_spam' ? 'declined as spam' : 'declined';
    // A decline with no reason is a fact worth stating, not a blank space: it
    // tells the reader there is nothing further to read on the page either.
    const reason = approved ? null : proposal.declineReason?.trim() || 'No reason was given.';

    await pushDeliver(wanted, {
      title: `${approved ? 'Approved' : 'Declined'}: ${proposal.title}`,
      body: reason ? `Reason: ${preview(reason, 140)}` : `${name} ${verb} this contract.`,
      url,
    });

    await deliver(recipients, `${approved ? 'Approved' : 'Declined'}: ${proposal.title}`, r =>
      [
        // "your contract" is the proposer's sentence; everyone else hears
        // about a contract they took a side on, not one they own.
        r.reason === 'decision' ? `${name} ${verb} your contract:` : `${name} ${verb} this contract:`,
        '',
        proposal.title,
        ...(proposal.askUsd
          ? ['', r.reason === 'decision' ? `Your ask was $${proposal.askUsd}.` : `The ask was $${proposal.askUsd}.`]
          : []),
        ...(reason ? ['', `Reason: ${preview(reason)}`] : []),
        '',
        `See it: ${url}`,
        '',
        REASON_LINE[r.reason],
        r.reason === 'decision'
          ? `Your other emails: ${settings.url}`
          : `Turn it off in account settings: ${settings.url}`,
      ].join('\n'),
    );
  } catch (e) {
    console.error('decision notification failed:', e);
  }
}

/**
 * A market settled (owner ask 2026-08-24). Mails everyone who traded it, with
 * the value it settled at: the settlement is the answer to a bet they placed.
 *
 * Called after the resolution is committed, and reads the row back so the
 * mail can never state a value the record does not. A voided market never
 * reaches here (it did not settle; its refund is the message), and only real
 * trades count: an LP's stake is not a bet on a side.
 */
export async function notifyMarketResolved(opts: { workspaceId: string; marketId: string }): Promise<void> {
  const { workspaceId, marketId } = opts;
  try {
    const [market] = await db
      .select({
        metricName: markets.metricName,
        targetDate: markets.targetDate,
        actualValue: markets.actualValue,
        resolved: markets.resolved,
        voided: markets.voided,
        proposalId: markets.proposalId,
      })
      .from(markets)
      .where(and(eq(markets.id, marketId), eq(markets.workspaceId, workspaceId)));
    if (!market || !market.resolved || market.voided || market.actualValue === null) return;

    const traders = await db
      .select({ id: trades.agentId })
      .from(trades)
      .where(and(eq(trades.workspaceId, workspaceId), eq(trades.marketId, marketId)));
    const wanted = new Map<string, Reason>();
    for (const t of traders) wanted.set(t.id, 'market-resolved');

    const recipients = await resolveRecipients(wanted);
    if (recipients.length === 0 && wanted.size === 0) return;

    // A branch market settles a contract's question, so the subject names the
    // contract when there is one; the bare label is a metric and its period.
    let subjectLabel = `${market.metricName} ${market.targetDate}`;
    if (market.proposalId) {
      const [proposal] = await db
        .select({ title: proposals.title })
        .from(proposals)
        .where(and(eq(proposals.id, market.proposalId), eq(proposals.workspaceId, workspaceId)));
      if (proposal) subjectLabel = proposal.title;
    }

    const { url, name } = await floorUrl(workspaceId);
    const settings = await floorUrl(workspaceId, '#emails');

    await pushDeliver(wanted, {
      title: `Settled at ${market.actualValue}: ${subjectLabel}`,
      body: `${market.metricName} ${market.targetDate} settled at ${market.actualValue}.`,
      url,
    });

    await deliver(recipients, `Settled at ${market.actualValue}: ${subjectLabel}`, r =>
      [
        `${market.metricName} ${market.targetDate} on ${name} settled at ${market.actualValue}.`,
        '',
        `Your positions on it have been paid out at that value.`,
        '',
        `See the market: ${url}`,
        '',
        REASON_LINE[r.reason],
        `Turn it off in account settings: ${settings.url}`,
      ].join('\n'),
    );
  } catch (e) {
    console.error('market-resolved notification failed:', e);
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
export type NotificationKind = 'comment' | 'reply' | 'contract' | 'anyComment' | 'settled' | 'decision' | 'stale';

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
export async function listNotifications(
  participantId: string,
  limit = 30,
): Promise<{
  items: NotificationItem[];
  unread: number;
  seenAt: Date | null;
}> {
  const [me] = await db
    .select({ seenAt: agents.notificationsSeenAt, channels: agents.notificationChannels })
    .from(agents)
    .where(eq(agents.id, participantId));
  const seenAt = me?.seenAt ?? null;
  // One clock for the whole derivation, so a market cannot be "settling soon"
  // in one line and settled in the next.
  const now = new Date();
  // The web cells of the matrix decide which kinds this inbox derives at all
  // (revised 2026-08-24, owner: the bell is tunable per kind, like the other
  // two channels; until then it was deliberately unfiltered).
  // Only the kinds the matrix governs are tunable; `stale` is not one of them
  // (see where it is derived below), so this takes the narrower type.
  const webOn = (kind: NotificationKindId) => channelOn(me?.channels as ChannelOverrides | null, kind, 'web');

  // Items read one at a time, on top of the watermark (owner ask: the count
  // goes down by one per click, not only all at once).
  const readRows = await db
    .select({ itemId: notificationReads.itemId })
    .from(notificationReads)
    .where(eq(notificationReads.agentId, participantId));
  const readIds = new Set(readRows.map(r => r.itemId));

  // Where this participant is a member: the scope of "a new contract".
  const groups = await db
    .select({
      workspaceId: permissionGroups.workspaceId,
      memberIds: permissionGroups.memberIds,
      capabilities: permissionGroups.capabilities,
    })
    .from(permissionGroups);
  const myWorkspaces = [
    ...new Set(groups.filter(g => (g.memberIds ?? []).includes(participantId)).map(g => g.workspaceId)),
  ];
  // Where this participant can actually fix a number, which is the only place
  // "your market is about to settle on an old reading" is worth saying.
  const myManaged = [
    ...new Set(
      groups
        .filter(g => (g.memberIds ?? []).includes(participantId) && (g.capabilities ?? []).includes('manage'))
        .map(g => g.workspaceId),
    ),
  ];

  // Threads this participant is in, so a reply can be recognised as a reply.
  // WHEN they first spoke matters as much as where: a thread only owes them
  // what was said after they arrived. Without that cutoff, a first reply in
  // an old thread backfilled every earlier comment into the inbox as unread
  // news from the past (reported 2026-08-22).
  const [myProposalThreads, myMarketThreads, myProposals, myTradeRows] = await Promise.all([
    db
      .select({ proposalId: proposalMessages.proposalId, createdAt: proposalMessages.createdAt })
      .from(proposalMessages)
      .where(eq(proposalMessages.from, participantId)),
    db
      .select({ marketId: marketMessages.marketId, createdAt: marketMessages.createdAt })
      .from(marketMessages)
      .where(eq(marketMessages.from, participantId)),
    db
      .select({
        id: proposals.id,
        title: proposals.title,
        workspaceId: proposals.workspaceId,
        status: proposals.status,
        resolvedAt: proposals.resolvedAt,
        declineReason: proposals.declineReason,
      })
      .from(proposals)
      .where(eq(proposals.proposedBy, participantId)),
    // Markets this participant traded: the scope of "a market I traded
    // settled" and half the scope of "a contract I am involved in".
    db.select({ marketId: trades.marketId }).from(trades).where(eq(trades.agentId, participantId)),
  ]);
  const myTradedMarketIds = [...new Set(myTradeRows.map(t => t.marketId))];

  const myProposalIds = [...new Set(myProposals.map(p => p.id))];
  const joinedProposalThreadAt = new Map<string, number>();
  for (const t of myProposalThreads) {
    const at = t.createdAt.getTime();
    const cur = joinedProposalThreadAt.get(t.proposalId);
    if (cur === undefined || at < cur) joinedProposalThreadAt.set(t.proposalId, at);
  }
  const joinedMarketThreadAt = new Map<string, number>();
  for (const t of myMarketThreads) {
    const at = t.createdAt.getTime();
    const cur = joinedMarketThreadAt.get(t.marketId);
    if (cur === undefined || at < cur) joinedMarketThreadAt.set(t.marketId, at);
  }
  const inProposalThreads = [...joinedProposalThreadAt.keys()];
  const inMarketThreads = [...joinedMarketThreadAt.keys()];
  const titleOf = new Map(myProposals.map(p => [p.id, p.title]));

  // Conditional markets belong to a contract, so their threads are part of
  // that contract's conversation (see notifyCommentPosted).
  const myBranchMarkets =
    myProposalIds.length === 0
      ? []
      : await db
          .select({
            id: markets.id,
            proposalId: markets.proposalId,
            metricName: markets.metricName,
          })
          .from(markets)
          .where(inArray(markets.proposalId, myProposalIds));
  const branchOwner = new Map(myBranchMarkets.map(m => [m.id, m.proposalId!]));

  const watchedProposalIds = [...new Set([...myProposalIds, ...inProposalThreads])];
  const watchedMarketIds = [...new Set([...inMarketThreads, ...myBranchMarkets.map(m => m.id)])];

  const [proposalComments, marketComments, newContracts] = await Promise.all([
    watchedProposalIds.length === 0
      ? []
      : db
          .select({
            id: proposalMessages.id,
            proposalId: proposalMessages.proposalId,
            from: proposalMessages.from,
            content: proposalMessages.content,
            createdAt: proposalMessages.createdAt,
            workspaceId: proposalMessages.workspaceId,
          })
          .from(proposalMessages)
          .where(inArray(proposalMessages.proposalId, watchedProposalIds))
          .orderBy(desc(proposalMessages.createdAt))
          .limit(limit * 2),
    watchedMarketIds.length === 0
      ? []
      : db
          .select({
            id: marketMessages.id,
            marketId: marketMessages.marketId,
            from: marketMessages.from,
            content: marketMessages.content,
            createdAt: marketMessages.createdAt,
            workspaceId: marketMessages.workspaceId,
          })
          .from(marketMessages)
          .where(inArray(marketMessages.marketId, watchedMarketIds))
          .orderBy(desc(marketMessages.createdAt))
          .limit(limit * 2),
    myWorkspaces.length === 0
      ? []
      : db
          .select({
            id: proposals.id,
            title: proposals.title,
            description: proposals.description,
            proposedBy: proposals.proposedBy,
            createdAt: proposals.createdAt,
            workspaceId: proposals.workspaceId,
          })
          .from(proposals)
          .where(inArray(proposals.workspaceId, myWorkspaces))
          .orderBy(desc(proposals.createdAt))
          .limit(limit * 2),
  ]);

  // Settled markets I traded, and decided contracts I am involved in
  // (traded either branch, or commented in the conversation). Owner ask
  // 2026-08-24: the bell carries these, not only the mail.
  const tradedMarkets =
    myTradedMarketIds.length === 0
      ? []
      : await db
          .select({
            id: markets.id,
            metricName: markets.metricName,
            targetDate: markets.targetDate,
            resolved: markets.resolved,
            voided: markets.voided,
            resolvedAt: markets.resolvedAt,
            actualValue: markets.actualValue,
            proposalId: markets.proposalId,
            workspaceId: markets.workspaceId,
          })
          .from(markets)
          .where(inArray(markets.id, myTradedMarketIds));
  const settledMarkets = tradedMarkets.filter(m => m.resolved && !m.voided && m.actualValue !== null && m.resolvedAt);

  /**
   * The nudge (owner decision 2026-08-31): a market of mine settles soon, and
   * the reading it would settle on predates the period it settles FOR, so
   * nobody has measured the thing being priced. Derived at read time like
   * everything else in this feed, so there is no job to run and nothing to
   * dedupe: it appears while it is true and goes when a reading lands.
   */
  const staleSoon: Array<{
    marketId: string;
    metricName: string;
    targetDate: string;
    workspaceId: string;
    readingAt: Date | null;
  }> = [];
  // Deliberately outside the preference matrix: every other kind is news
  // about other people, which is a taste, while this one says a market of
  // yours is about to settle on a number nobody measured. It has one channel,
  // the bell, and an owner who does not want it can fix the reading.
  if (myManaged.length > 0) {
    const open = await db
      .select({
        id: markets.id,
        metricId: markets.metricId,
        metricName: markets.metricName,
        targetDate: markets.targetDate,
        workspaceId: markets.workspaceId,
      })
      .from(markets)
      .where(and(inArray(markets.workspaceId, myManaged), eq(markets.resolved, false), eq(markets.active, true)));
    const soon = open.filter(m => settlingSoon(m.targetDate, now));
    if (soon.length > 0) {
      const readingRows = await db
        .select({ metricId: metricLogs.metricId, at: sql<Date>`max(${metricLogs.timestamp})` })
        .from(metricLogs)
        .where(inArray(metricLogs.metricId, [...new Set(soon.map(m => m.metricId))]))
        .groupBy(metricLogs.metricId);
      const lastReading = new Map(readingRows.map(r => [r.metricId, r.at ? new Date(r.at) : null]));
      for (const m of soon) {
        const at = lastReading.get(m.metricId) ?? null;
        if (readingIsStaleFor(m.targetDate, at, now)) {
          staleSoon.push({
            marketId: m.id,
            metricName: m.metricName,
            targetDate: m.targetDate,
            workspaceId: m.workspaceId,
            readingAt: at,
          });
        }
      }
    }
  }

  const involvedThreadMarketIds = inMarketThreads.filter(id => !branchOwner.has(id));
  const involvedThreadMarkets =
    involvedThreadMarketIds.length === 0
      ? []
      : await db
          .select({
            id: markets.id,
            proposalId: markets.proposalId,
          })
          .from(markets)
          .where(inArray(markets.id, involvedThreadMarketIds));
  const involvedProposalIds = [
    ...new Set([
      ...(tradedMarkets.map(m => m.proposalId).filter(Boolean) as string[]),
      ...inProposalThreads,
      ...(involvedThreadMarkets.map(m => m.proposalId).filter(Boolean) as string[]),
    ]),
  ].filter(id => !myProposalIds.includes(id));
  const involvedDecided =
    involvedProposalIds.length === 0
      ? []
      : (
          await db
            .select({
              id: proposals.id,
              title: proposals.title,
              workspaceId: proposals.workspaceId,
              status: proposals.status,
              resolvedAt: proposals.resolvedAt,
              declineReason: proposals.declineReason,
            })
            .from(proposals)
            .where(inArray(proposals.id, involvedProposalIds))
        ).filter(
          p => !!p.resolvedAt && (p.status === 'approved' || p.status === 'declined' || p.status === 'declined_spam'),
        );

  // Every comment on my workspaces, only when that firehose's web cell is on.
  const [floorProposalComments, floorMarketComments] =
    !webOn('anyComment') || myWorkspaces.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({
              id: proposalMessages.id,
              proposalId: proposalMessages.proposalId,
              from: proposalMessages.from,
              content: proposalMessages.content,
              createdAt: proposalMessages.createdAt,
              workspaceId: proposalMessages.workspaceId,
            })
            .from(proposalMessages)
            .where(inArray(proposalMessages.workspaceId, myWorkspaces))
            .orderBy(desc(proposalMessages.createdAt))
            .limit(limit * 2),
          db
            .select({
              id: marketMessages.id,
              marketId: marketMessages.marketId,
              from: marketMessages.from,
              content: marketMessages.content,
              createdAt: marketMessages.createdAt,
              workspaceId: marketMessages.workspaceId,
            })
            .from(marketMessages)
            .where(inArray(marketMessages.workspaceId, myWorkspaces))
            .orderBy(desc(marketMessages.createdAt))
            .limit(limit * 2),
        ]);

  // Market names for threads this participant joined but does not own.
  const namedMarketIds = [
    ...new Set([...marketComments.map(c => c.marketId), ...floorMarketComments.map(c => c.marketId)]),
  ];
  const marketNames =
    namedMarketIds.length === 0
      ? []
      : await db
          .select({
            id: markets.id,
            metricName: markets.metricName,
            targetDate: markets.targetDate,
            proposalId: markets.proposalId,
          })
          .from(markets)
          .where(inArray(markets.id, namedMarketIds));
  const marketLabel = new Map(marketNames.map(m => [m.id, `${m.metricName} ${m.targetDate}`]));

  const slugs = await workspaceSlugs([
    ...proposalComments.map(c => c.workspaceId),
    ...marketComments.map(c => c.workspaceId),
    ...newContracts.map(c => c.workspaceId),
    ...myProposals.map(p => p.workspaceId),
    ...settledMarkets.map(m => m.workspaceId),
    ...involvedDecided.map(p => p.workspaceId),
    ...floorProposalComments.map(c => c.workspaceId),
    ...floorMarketComments.map(c => c.workspaceId),
  ]);

  const actorIds = [
    ...proposalComments.map(c => c.from),
    ...marketComments.map(c => c.from),
    ...newContracts.map(c => c.proposedBy),
    ...floorProposalComments.map(c => c.from),
    ...floorMarketComments.map(c => c.from),
  ];
  const names = await getParticipantDisplayNames(actorIds);
  const handle = (id: string) => names.get(id) ?? id;

  const items: NotificationItem[] = [];

  for (const c of proposalComments) {
    if (c.from === participantId) continue;
    const mine = myProposalIds.includes(c.proposalId);
    // A thread I merely joined owes me nothing older than my first message
    // in it; my own contract's thread owes me everything.
    if (!mine && c.createdAt.getTime() < (joinedProposalThreadAt.get(c.proposalId) ?? Infinity)) continue;
    items.push({
      id: `pm-${c.id}`,
      kind: mine ? 'comment' : 'reply',
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
    // Same cutoff as contract threads: a branch market of my own contract
    // owes me everything, a thread I joined only what came after I spoke.
    if (!owned && c.createdAt.getTime() < (joinedMarketThreadAt.get(c.marketId) ?? Infinity)) continue;
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
  // Withdrawing is your own doing and removing is admin cleanup, not a
  // decision, so neither produces a row (docs/vision.md, "Two neighbouring
  // events stay silent on purpose"); a removed contract still carries a
  // resolvedAt, which is why the status is checked and not only the date.
  for (const p of myProposals) {
    if (!p.resolvedAt || p.status === 'pending' || p.status === 'withdrawn' || p.status === 'removed') continue;
    items.push({
      id: `dec-${p.id}`,
      kind: 'decision',
      at: p.resolvedAt,
      actor: null,
      subject: p.title,
      detail: p.status === 'approved' ? 'Approved.' : p.declineReason || 'Declined.',
      workspaceSlug: slugs.get(p.workspaceId) ?? null,
      proposalId: p.id,
      marketId: null,
      commentId: null,
      unread: true,
    });
  }

  for (const s of staleSoon) {
    const days = s.readingAt ? Math.floor((now.getTime() - s.readingAt.getTime()) / 86400000) : null;
    items.push({
      // Stable id per market, so reading it once keeps it read until the
      // market changes state and the item stops being derived at all.
      id: `stale-${s.marketId}`,
      kind: 'stale',
      at: periodEndInstant(s.targetDate),
      actor: null,
      subject: `${s.metricName} ${s.targetDate}`,
      detail:
        days === null
          ? 'Settles soon, and has never been reported. Report the number before it settles.'
          : `Settles soon on a reading from ${days === 0 ? 'earlier today' : `${days} ${days === 1 ? 'day' : 'days'} ago`}, taken before the period it settles for. Report the number.`,
      workspaceSlug: slugs.get(s.workspaceId) ?? null,
      proposalId: null,
      marketId: s.marketId,
      commentId: null,
      unread: true,
    });
  }

  for (const m of settledMarkets) {
    items.push({
      id: `res-${m.id}`,
      kind: 'settled',
      at: m.resolvedAt as Date,
      actor: null,
      subject: `${m.metricName} ${m.targetDate}`,
      detail: `Settled at ${m.actualValue}.`,
      workspaceSlug: slugs.get(m.workspaceId) ?? null,
      proposalId: m.proposalId ?? null,
      marketId: m.id,
      commentId: null,
      unread: true,
    });
  }

  // A verdict on a contract I traded or commented on. Same `dec-` id space as
  // my own contracts' decisions: the sets are disjoint (mine are filtered out
  // of involvedDecided), so one id never means two rows.
  for (const p of involvedDecided) {
    items.push({
      id: `dec-${p.id}`,
      kind: 'decision',
      at: p.resolvedAt as Date,
      actor: null,
      subject: p.title,
      detail: p.status === 'approved' ? 'Approved.' : p.declineReason || 'Declined.',
      workspaceSlug: slugs.get(p.workspaceId) ?? null,
      proposalId: p.id,
      marketId: null,
      commentId: null,
      unread: true,
    });
  }

  // The firehose, when its web cell is on. Same id space as the watched-thread
  // rows above, so a comment already carried as `comment` or `reply` keeps the
  // closer kind and never appears twice.
  const carried = new Set(items.map(i => i.id));
  for (const c of floorProposalComments) {
    if (c.from === participantId || carried.has(`pm-${c.id}`)) continue;
    items.push({
      id: `pm-${c.id}`,
      kind: 'anyComment',
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
  for (const c of floorMarketComments) {
    if (c.from === participantId || carried.has(`mm-${c.id}`)) continue;
    items.push({
      id: `mm-${c.id}`,
      kind: 'anyComment',
      at: c.createdAt,
      actor: handle(c.from),
      subject: marketLabel.get(c.marketId) ?? 'a market',
      detail: c.content,
      workspaceSlug: slugs.get(c.workspaceId) ?? null,
      proposalId: null,
      marketId: c.marketId,
      commentId: c.id,
      unread: true,
    });
  }

  // The web cells decide what this inbox shows at all (owner revision
  // 2026-08-24); a kind switched off is not derived as read, it is not there.
  // `stale` is the one kind the matrix does not govern, so it passes through:
  // it is derived only for people who can fix the number, and it stops being
  // derived the moment they do.
  const shown = items.filter(i => i.kind === 'stale' || webOn(i.kind));

  shown.sort((a, b) => b.at.getTime() - a.at.getTime());
  for (const i of shown) {
    i.unread = !readIds.has(i.id) && (seenAt === null || i.at.getTime() > seenAt.getTime());
  }
  // Unread counts the WHOLE list, not the page: a badge that stops at the
  // page size tells you less the more there is to tell.
  const unread = shown.filter(i => i.unread).length;
  return { items: shown.slice(0, limit), unread, seenAt };
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
  await db
    .insert(notificationReads)
    .values({ agentId: participantId, itemId, readAt: new Date() })
    .onConflictDoNothing();
}

/** Slug per workspace id, for the links a notification row points at. */
async function workspaceSlugs(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: workspaces.id, slug: workspaces.slug })
    .from(workspaces)
    .where(inArray(workspaces.id, unique));
  return new Map(rows.filter(r => r.slug).map(r => [r.id, r.slug as string]));
}
