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

import { and, asc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/client';
import {
  agents, authUser, markets, marketMessages, permissionGroups,
  proposals, proposalMessages, workspaces,
} from '../db/schema';
import { getParticipantDisplayNames } from '../lib/participants';
import { publicOrigin, sendEmail } from '../lib/notify';

/** Which switch produced a given message; also the line the email closes on. */
type Reason = 'my-proposal' | 'reply' | 'new-proposal';

const REASON_LINE: Record<Reason, string> = {
  'my-proposal': 'You are getting this because someone commented on a contract you posted.',
  reply: 'You are getting this because you commented in this thread.',
  'new-proposal': 'You are getting this because you asked to hear about new contracts here.',
};

/** The column each reason reads, so a switch is checked in exactly one place. */
const REASON_COLUMN: Record<Reason, 'notifyCommentOnMyProposal' | 'notifyReplyToMyComment' | 'notifyNewProposal'> = {
  'my-proposal': 'notifyCommentOnMyProposal',
  reply: 'notifyReplyToMyComment',
  'new-proposal': 'notifyNewProposal',
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
    if (!row[REASON_COLUMN[reason]]) continue;
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
    const settings = await floorUrl(workspaceId, '#account');

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
    const settings = await floorUrl(workspaceId, '#account');

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
