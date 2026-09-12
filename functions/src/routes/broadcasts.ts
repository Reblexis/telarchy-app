import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, authUser, broadcastSends, broadcasts, emailOptOuts, seasonEntries } from '../db/schema';
import { AppError } from '../lib/errors';
import { publicOrigin, sendEmail } from '../lib/notify';
import { isPlatformAuthorized } from '../lib/platform-admin';
import { normalizeEmail, unsubscribeToken } from '../lib/unsubscribe';
import { wrap } from '../lib/wrap';

/**
 * Announcements by email (docs/announcements-by-email.md).
 *
 * The mail nobody asked for, so the invariants here are about the person
 * receiving it and about being able to answer for the run afterwards. Two
 * routers: the admin one that sends, and the public one that stops it.
 */

/** docs: "Capped at 500 recipients." Above it the send is refused, not run. */
const MAX_RECIPIENTS = 500;
/** docs: "At most two sends a second." */
const GAP_MS = 600;
/** The mailbox a `mailto:` unsubscribe reaches, and the default reply-to. */
const SUPPORT = process.env.SUPPORT_EMAIL || 'support@telarchy.com';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function requirePlatform(req: Parameters<typeof isPlatformAuthorized>[0]) {
  if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin required', 403);
}

export interface Recipient {
  email: string;
  agentId: string | null;
}

/**
 * The audience, resolved (docs: "The audience"). Opted-in entries of the
 * season, at the entry's own address, falling back to the account's. An entry
 * with neither is left out of the list and counted as unreachable by the
 * caller, rather than disappearing.
 */
export async function seasonEntrantRecipients(seasonId: string): Promise<{ to: Recipient[]; unreachable: number }> {
  const entries = await db
    .select({ agentId: seasonEntries.agentId, contactEmail: seasonEntries.contactEmail })
    .from(seasonEntries)
    .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.optedIn, true)));
  if (entries.length === 0) return { to: [], unreachable: 0 };

  // The account address, for an entry that carries none of its own.
  const ids = entries.map(e => e.agentId);
  const accounts = await db
    .select({ agentId: agents.id, email: authUser.email })
    .from(agents)
    .innerJoin(authUser, eq(agents.authUserId, authUser.id))
    .where(inArray(agents.id, ids));
  const accountEmail = new Map(accounts.map(a => [a.agentId, a.email]));

  const seen = new Set<string>();
  const to: Recipient[] = [];
  let unreachable = 0;
  for (const e of entries) {
    const raw = (e.contactEmail ?? '').trim() || (accountEmail.get(e.agentId) ?? '').trim();
    if (!raw) {
      unreachable += 1;
      continue;
    }
    const email = normalizeEmail(raw);
    if (seen.has(email)) continue;
    seen.add(email);
    to.push({ email, agentId: e.agentId });
  }
  return { to, unreachable };
}

/** The message a recipient reads, with the way to stop it inside it. */
export function bodyWithUnsubscribe(body: string, email: string): string {
  const url = `${publicOrigin()}/api/unsubscribe/${unsubscribeToken(email)}`;
  return `${body.trimEnd()}\n\n--\nYou are receiving this because you entered a Telarchy season.\nStop these announcements: ${url}`;
}

function headersFor(email: string): Record<string, string> {
  const url = `${publicOrigin()}/api/unsubscribe/${unsubscribeToken(email)}`;
  return {
    'List-Unsubscribe': `<${url}>, <mailto:${SUPPORT}?subject=unsubscribe>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
}

export const adminBroadcastsRouter = Router();

adminBroadcastsRouter.get(
  '/',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const rows = await db.select().from(broadcasts).orderBy(desc(broadcasts.createdAt)).limit(50);
    const out = [];
    for (const b of rows) {
      const sends = await db.select().from(broadcastSends).where(eq(broadcastSends.broadcastId, b.id));
      out.push({
        id: b.id,
        subject: b.subject,
        audience: b.audience,
        seasonId: b.seasonId,
        createdAt: b.createdAt,
        sent: sends.filter(s => s.status === 'sent').length,
        failed: sends.filter(s => s.status === 'failed').length,
        suppressed: sends.filter(s => s.status === 'suppressed').length,
      });
    }
    res.json({ broadcasts: out });
  }),
);

adminBroadcastsRouter.post(
  '/',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const { subject, body, audience, seasonId, replyTo, dryRun, broadcastId } = req.body ?? {};

    const subj = typeof subject === 'string' ? subject.trim() : '';
    const text = typeof body === 'string' ? body.trim() : '';
    if (!subj) throw new AppError('A broadcast needs a subject', 400);
    if (!text) throw new AppError('A broadcast needs a body', 400);
    if (audience !== 'season-entrants') throw new AppError('Unknown audience; the only one is season-entrants', 400);
    if (typeof seasonId !== 'string' || !seasonId) throw new AppError('seasonId is required for season-entrants', 400);

    const { to, unreachable } = await seasonEntrantRecipients(seasonId);
    if (to.length > MAX_RECIPIENTS) {
      throw new AppError(
        `A broadcast reaches at most ${MAX_RECIPIENTS} addresses; this one resolves ${to.length}`,
        400,
      );
    }

    // Who has asked us to stop. Read once, before anything is sent.
    const optedOut = new Set(
      (
        await db
          .select({ email: emailOptOuts.email })
          .from(emailOptOuts)
          .where(inArray(emailOptOuts.email, to.length ? to.map(r => r.email) : ['']))
      ).map(r => r.email),
    );

    if (dryRun) {
      res.json({
        dryRun: true,
        audience,
        seasonId,
        recipients: to.filter(r => !optedOut.has(r.email)).map(r => r.email),
        suppressed: to.filter(r => optedOut.has(r.email)).length,
        unreachable,
      });
      return;
    }

    /* A retry names the broadcast it is finishing, so the rows already
       written decide who is left (docs: "Sent at most once per address"). */
    let id: string;
    if (typeof broadcastId === 'string' && broadcastId) {
      const [existing] = await db.select().from(broadcasts).where(eq(broadcasts.id, broadcastId));
      if (!existing) throw new AppError('No such broadcast', 404);
      id = existing.id;
    } else {
      id = randomUUID();
      await db.insert(broadcasts).values({
        id,
        subject: subj,
        body: text,
        audience,
        seasonId,
        replyTo: typeof replyTo === 'string' && replyTo ? replyTo : SUPPORT,
        createdBy: (req as { auth?: { agentId?: string } }).auth?.agentId ?? null,
      });
    }
    const already = new Set(
      (await db.select().from(broadcastSends).where(eq(broadcastSends.broadcastId, id)))
        .filter(r => r.status === 'sent')
        .map(r => r.email),
    );
    const reply = typeof replyTo === 'string' && replyTo ? replyTo : SUPPORT;

    let sent = 0;
    let failed = 0;
    let suppressed = 0;
    let first = true;
    for (const r of to) {
      if (already.has(r.email)) continue;
      if (optedOut.has(r.email)) {
        suppressed += 1;
        await record(id, r, 'suppressed', null);
        continue;
      }
      // Paced: the provider's limit is where an unpaced loop starts losing
      // messages, and a rejected send looks exactly like a delivered one.
      if (!first) await sleep(GAP_MS);
      first = false;
      const ok = await sendEmail(r.email, subj, bodyWithUnsubscribe(text, r.email), {
        headers: headersFor(r.email),
        replyTo: reply,
      });
      if (ok) {
        sent += 1;
        await record(id, r, 'sent', null);
      } else {
        failed += 1;
        await record(id, r, 'failed', 'the mail provider did not accept it');
      }
    }

    res.json({ broadcastId: id, audience, seasonId, sent, failed, suppressed, unreachable });
  }),
);

async function record(broadcastId: string, r: Recipient, status: string, error: string | null) {
  await db
    .insert(broadcastSends)
    .values({ broadcastId, email: r.email, agentId: r.agentId, status, error, at: new Date() })
    .onConflictDoUpdate({
      target: [broadcastSends.broadcastId, broadcastSends.email],
      set: { status, error, at: new Date() },
    });
}
