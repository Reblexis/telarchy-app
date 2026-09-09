/**
 * The outreach workbench (docs/outreach-workbench.md): the people the owner
 * writes to himself, the message drafted from what is known about each, the
 * argument about it, where to send it, and what came back. Nothing here
 * sends anything; the owner does, and this remembers.
 *
 * Drafting reuses the X workbench's model, effort, fallback and voice
 * profile (docs/x-workbench.md, "Drafting"), so the two surfaces learn from
 * the same samples and cost the same to run.
 */
import { randomUUID } from 'crypto';
import { asc, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { type OutreachTurn, outreachLessons, outreachProspects } from '../db/schema';
import { AppError } from '../lib/errors';
import {
  callProposal,
  type DraftTurn,
  getVoiceProfile,
  type ProposalBody,
  proseOf,
  toolInput,
  withoutDashes,
} from './x-workbench';

export const CHANNELS = ['x', 'email', 'linkedin', 'bluesky', 'hn', 'discord', 'other'] as const;
export type Channel = (typeof CHANNELS)[number];

/**
 * `approved` is the owner saying this exact text may go to this exact
 * person, and it is the only status an agent may send from
 * (docs/outreach-workbench.md, "Who actually sends"). It stamps nothing: an
 * approved message has not been sent and counts as sent nowhere.
 */
export const STATUSES = [
  'draft',
  'ready',
  'approved',
  'sent',
  'replied',
  'call',
  'workspace',
  'activated',
  'no',
] as const;
export type Status = (typeof STATUSES)[number];

/** Every status from `sent` onwards means the message went out. `approved`
 *  is deliberately absent: permission is not delivery. */
const WENT_OUT = new Set<string>(['sent', 'replied', 'call', 'workspace', 'activated', 'no']);
/** Every status after `sent` means the person answered, "no" included. */
const ANSWERED = new Set<string>(['replied', 'call', 'workspace', 'activated', 'no']);

export type Prospect = typeof outreachProspects.$inferSelect;

// --- where to send it --------------------------------------------------------

const trimAt = (h: string) => h.replace(/^@/, '').trim();
const isUrl = (h: string) => /^https?:\/\//i.test(h);

/**
 * The link that opens where the person reads (docs/outreach-workbench.md,
 * "What the owner does", step 5). Empty when nothing usable is on file: an
 * empty link is a missing button, a guessed one is a broken button.
 */
export function channelLink(p: { channel: string; handle: string | null | undefined }, message = ''): string {
  const h = (p.handle ?? '').trim();
  if (!h) return '';
  switch (p.channel) {
    case 'x':
      return isUrl(h) ? h : `https://x.com/${trimAt(h)}`;
    case 'email': {
      return `mailto:${h}?subject=Telarchy&body=${encodeURIComponent(message)}`;
    }
    case 'bluesky':
      return isUrl(h) ? h : `https://bsky.app/profile/${trimAt(h)}`;
    case 'hn':
      return isUrl(h) ? h : `https://news.ycombinator.com/user?id=${encodeURIComponent(trimAt(h))}`;
    case 'linkedin':
      return isUrl(h) ? h : `https://www.linkedin.com/${h.replace(/^\/+/, '')}`;
    default:
      return isUrl(h) ? h : '';
  }
}

// --- what a message is scored on --------------------------------------------

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

const DECISION_WORDS = /\b(decid\w*|call|whether|vs\.?|or keep|before you|next month|this month|open)\b/i;

/** Under 75 words, names a number, names their decision: the three features
 *  the summary compares (docs/outreach-workbench.md, "What it learns"). */
export function messageFeatures(text: string) {
  const words = wordCount(text);
  return {
    short: words > 0 && words <= 75,
    hasNumber: /\d/.test(text),
    namesDecision: DECISION_WORDS.test(text),
    words,
  };
}

// --- the log line for the contract -------------------------------------------

const ANSWER: Record<string, string> = {
  sent: 'none yet',
  replied: 'replied',
  call: 'yes',
  workspace: 'yes',
  activated: 'yes',
  no: 'no',
};
const FLOOR: Record<string, string> = {
  workspace: 'created',
  activated: 'decided and 2nd value posted',
};

/** `NN. NAME (SEG), sent DATE via CHANNEL. Answer: ... Floor: ...`, the shape
 *  the traders were promised, one line per person. */
export function logLine(
  p: {
    name: string;
    segment: string | null;
    channel: string;
    status: string;
    sentAt: Date | null;
    outcome?: string | null;
  },
  n: number,
): string {
  const seg = p.segment ? ` (${p.segment})` : '';
  const when = p.sentAt ? `sent ${p.sentAt.toISOString().slice(0, 10)}` : 'not sent yet';
  return `${n}. ${p.name}${seg}, ${when} via ${p.channel}. Answer: ${ANSWER[p.status] ?? 'none yet'}. Floor: ${FLOOR[p.status] ?? 'none'}.`;
}

// --- the summary -------------------------------------------------------------

type Tally = { key: string; sent: number; replied: number };

function tally(rows: { key: string; replied: boolean }[]): Tally[] {
  const m = new Map<string, Tally>();
  for (const r of rows) {
    const t = m.get(r.key) ?? { key: r.key, sent: 0, replied: 0 };
    t.sent += 1;
    if (r.replied) t.replied += 1;
    m.set(r.key, t);
  }
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export type OutreachSummary =
  | { enough: false; sent: number; replied: number; note: string }
  | {
      enough: true;
      sent: number;
      replied: number;
      bySegment: Tally[];
      byChannel: Tally[];
      /** Reply rate with and without each feature. */
      features: { label: string; on: number; off: number }[];
    };

/**
 * What the record says (docs/outreach-workbench.md, "What it learns"). Below
 * ten sent it says so; a reply rate from three messages is superstition.
 */
export function summariseOutreach(
  rows: { segment: string | null; channel: string; status: string; sentText: string | null }[],
): OutreachSummary {
  const out = rows.filter(r => WENT_OUT.has(r.status));
  const sent = out.length;
  const replied = out.filter(r => ANSWERED.has(r.status)).length;
  if (sent < 10) {
    return {
      enough: false,
      sent,
      replied,
      note: `${sent} sent, ${replied} answered. Ten sent before a pattern is claimed.`,
    };
  }
  const rate = (xs: typeof out) => (xs.length ? xs.filter(r => ANSWERED.has(r.status)).length / xs.length : 0);
  const feature = (label: string, on: (r: (typeof out)[number]) => boolean) => ({
    label,
    on: rate(out.filter(on)),
    off: rate(out.filter(r => !on(r))),
  });
  const f = (r: (typeof out)[number]) => messageFeatures(r.sentText ?? '');
  return {
    enough: true,
    sent,
    replied,
    bySegment: tally(out.map(r => ({ key: r.segment ?? '?', replied: ANSWERED.has(r.status) }))),
    byChannel: tally(out.map(r => ({ key: r.channel, replied: ANSWERED.has(r.status) }))),
    features: [
      feature('under 75 words', r => f(r).short),
      feature('names a number', r => f(r).hasNumber),
      feature('names their decision', r => f(r).namesDecision),
    ],
  };
}

// --- prospects ---------------------------------------------------------------

export interface ProspectInput {
  name?: unknown;
  company?: unknown;
  segment?: unknown;
  channel?: unknown;
  handle?: unknown;
  evidence?: unknown;
  message?: unknown;
  status?: unknown;
  day?: unknown;
  outcome?: unknown;
  position?: unknown;
}

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
};

/** What the form and the import accept: a name, a known channel, a known
 *  status; strings trimmed, empty ones null. Refuses rather than guesses. */
export function normaliseProspect(input: ProspectInput) {
  const name = str(input.name);
  if (!name) throw new AppError('A prospect needs a name.', 400);
  const channel = str(input.channel) ?? 'other';
  if (!(CHANNELS as readonly string[]).includes(channel)) {
    throw new AppError(`Unknown channel "${channel}". One of: ${CHANNELS.join(', ')}.`, 400);
  }
  const status = str(input.status) ?? 'draft';
  if (!(STATUSES as readonly string[]).includes(status)) {
    throw new AppError(`Unknown status "${status}". One of: ${STATUSES.join(', ')}.`, 400);
  }
  return {
    name,
    company: str(input.company),
    segment: str(input.segment),
    channel,
    handle: str(input.handle),
    evidence: str(input.evidence),
    message: str(input.message),
    status,
    day: str(input.day),
    outcome: str(input.outcome),
    position: typeof input.position === 'number' && Number.isFinite(input.position) ? Math.trunc(input.position) : null,
  };
}

async function nextPosition(): Promise<number> {
  const [last] = await db
    .select({ position: outreachProspects.position })
    .from(outreachProspects)
    .orderBy(desc(outreachProspects.position))
    .limit(1);
  return (last?.position ?? 0) + 1;
}

export async function createProspect(input: ProspectInput): Promise<Prospect> {
  const p = normaliseProspect(input);
  const [row] = await db
    .insert(outreachProspects)
    .values({
      id: randomUUID(),
      ...p,
      position: p.position ?? (await nextPosition()),
    })
    .returning();
  return row;
}

/** Many at once, all or none: a bad row in a pasted list is a list to fix,
 *  not a list half in. */
export async function importProspects(inputs: ProspectInput[]): Promise<number> {
  const rows = inputs.map(normaliseProspect);
  if (!rows.length) return 0;
  const start = await nextPosition();
  await db.transaction(async tx => {
    await tx.insert(outreachProspects).values(
      rows.map((p, i) => ({
        id: randomUUID(),
        ...p,
        position: p.position ?? start + i,
      })),
    );
  });
  return rows.length;
}

export async function listProspects(): Promise<{ prospects: Prospect[]; summary: OutreachSummary }> {
  const prospects = await db
    .select()
    .from(outreachProspects)
    .orderBy(asc(outreachProspects.position), asc(outreachProspects.createdAt));
  return { prospects, summary: summariseOutreach(prospects) };
}

async function getProspect(id: string): Promise<Prospect> {
  const [row] = await db.select().from(outreachProspects).where(eq(outreachProspects.id, id));
  if (!row) throw new AppError('No such prospect', 404);
  return row;
}

/**
 * Edit any field. The first move to `sent` freezes the text and the time
 * (docs/outreach-workbench.md, "Storage"): later edits change the draft, the
 * status and the outcome, never what went out.
 */
export async function updateProspect(id: string, input: ProspectInput): Promise<Prospect> {
  const current = await getProspect(id);
  const merged = normaliseProspect({
    name: input.name ?? current.name,
    company: 'company' in input ? input.company : current.company,
    segment: 'segment' in input ? input.segment : current.segment,
    channel: input.channel ?? current.channel,
    handle: 'handle' in input ? input.handle : current.handle,
    evidence: 'evidence' in input ? input.evidence : current.evidence,
    message: 'message' in input ? input.message : current.message,
    status: input.status ?? current.status,
    day: 'day' in input ? input.day : current.day,
    outcome: 'outcome' in input ? input.outcome : current.outcome,
    position: 'position' in input ? input.position : current.position,
  });
  const freeze = !current.sentAt && WENT_OUT.has(merged.status);
  if (freeze && !merged.message) throw new AppError('There is no message to have sent.', 400);
  const [row] = await db
    .update(outreachProspects)
    .set({
      ...merged,
      position: merged.position ?? current.position,
      ...(freeze ? { sentText: merged.message, sentAt: new Date() } : {}),
      updatedAt: new Date(),
    })
    .where(eq(outreachProspects.id, id))
    .returning();
  return row;
}

export async function deleteProspect(id: string): Promise<void> {
  const [row] = await db.delete(outreachProspects).where(eq(outreachProspects.id, id)).returning();
  if (!row) throw new AppError('No such prospect', 404);
}

// --- lessons -----------------------------------------------------------------

export async function getLessons(): Promise<string> {
  const [row] = await db.select().from(outreachLessons).where(eq(outreachLessons.id, 'default'));
  return row?.lessons ?? '';
}

export async function setLessons(lessons: string): Promise<void> {
  await db
    .insert(outreachLessons)
    .values({ id: 'default', lessons, updatedAt: new Date() })
    .onConflictDoUpdate({ target: outreachLessons.id, set: { lessons, updatedAt: new Date() } });
}

// --- drafting ----------------------------------------------------------------

const RULES = `You draft a first direct message to a stranger, for the owner of this workspace (a solo founder), asking them to run the number they are judged on with his product, Telarchy, which he will set up for them himself. He reads every draft and sends it himself, or not. You are one half of an argument about what to say, not a vending machine: when he pushes back or asks something, answer him, and change your position or defend it.

Rules for the message:
- Under 75 words. One ask, at the end, that a yes or no answers.
- His name in the first line ("Viktor here"), and one line of who he is only if the evidence says what he can claim.
- The hook is the decision the evidence says they have open, in their own numbers and words. Quote only the evidence. A fact not in the evidence is not a fact: never invent a number, a date, a product, or an outcome.
- Do not explain the mechanism; the link (telarchy.com/lookpilot, his own number run the same way) does that. Say it is free and that he does the setup.
- Answer first, flat numbers, no flattery, no "love what you're doing", no preamble. Short declaratives that stop rather than resolve. No rhetorical polish, no closing summary. No em-dashes.
- Plain text, the way he would write to a friend. Avoid the words bet, odds and alignment.
- If the evidence gives nothing to hook on, say so in the answer and write the plainest honest version rather than inventing a hook.

Hand the draft back through the draft tool: text (the message), reason (one word: decision|number|asked|door|plain), and answer: what you say to him. A sentence on what you did when nothing was asked; when he pushed back or asked something, as many sentences as the answer needs, in plain words.`;

const ASK_RULES = `You answer the owner's questions about his direct outreach: which segment or channel to push, why a message got nothing, what to change, what to try next. Answer from his record (every message sent and what came back) and his lessons first, and say which one an answer rests on. Do not invent a rule: when neither says, say so. Numbers you quote come from the record. Answer first, plainly, no preamble, no em-dashes. Hand the answer back through the answer tool.`;

const DRAFT_TOOL = {
  name: 'draft',
  description: 'The drafted message, the one-word reason for its shape, and what you say to him about it.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The message.' },
      reason: { type: 'string', description: 'One word.' },
      answer: { type: 'string', description: 'What you say to him.' },
    },
    required: ['text', 'answer'],
  },
};

const ANSWER_TOOL = {
  name: 'answer',
  description: 'Your answer to him.',
  input_schema: {
    type: 'object',
    properties: { answer: { type: 'string' } },
    required: ['answer'],
  },
};

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * What was sent and what came back, as the model reads it. The features are
 * spelled out so the pattern is visible; the model is told not to copy a
 * message that worked, because the same words twice is spam.
 */
async function recordDigest(): Promise<string> {
  const rows = await db.select().from(outreachProspects).orderBy(desc(outreachProspects.sentAt)).limit(60);
  const out = rows.filter(r => WENT_OUT.has(r.status) && r.sentText);
  if (!out.length) return 'MESSAGES SENT SO FAR: none yet.';
  const line = (r: Prospect) => {
    const f = messageFeatures(r.sentText ?? '');
    const when = r.sentAt ? r.sentAt.toISOString().slice(0, 10) : '?';
    const came = ANSWERED.has(r.status) ? `${r.status}${r.outcome ? `: ${r.outcome}` : ''}` : 'no answer yet';
    return (
      `${when} to ${r.name}${r.segment ? ` (${r.segment})` : ''} via ${r.channel}, ${f.words} words` +
      `${f.hasNumber ? ', names a number' : ''}${f.namesDecision ? ', names their decision' : ''}` +
      `. Came back: ${came}.\n  ${r.sentText}`
    );
  };
  return (
    'MESSAGES SENT SO FAR, WITH WHAT CAME BACK:\n' +
    out.map(line).join('\n') +
    '\n\nNotice what separates the ones that got an answer. Do not copy a message that worked; the same words to a second person is spam.'
  );
}

async function systemPrompt(rules: string): Promise<string> {
  const [profile, lessons, record] = await Promise.all([getVoiceProfile(), getLessons(), recordDigest()]);
  return (
    rules +
    (profile
      ? `\n\nVOICE PROFILE AND FACTS HE MAY STATE:\n${profile}`
      : '\n\nNo voice profile is set, so write plainly and state no specific facts about his companies.') +
    (lessons ? `\n\nWHAT HE HAS LEARNED SENDING THESE, IN HIS WORDS:\n${lessons}` : '') +
    `\n\n${record}`
  );
}

const asTurns = (turns: DraftTurn[]) =>
  turns.filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim());

/**
 * A message for one prospect from the evidence, or one more turn of the
 * argument about it. The turns and the result are kept on the row, so the
 * next open shows the argument where he left it.
 */
export async function draftMessage(
  id: string,
  conversation: DraftTurn[],
): Promise<{ message: string; answer: string }> {
  const p = await getProspect(id);
  const system = await systemPrompt(RULES);
  const opening =
    `The person: ${p.name}${p.company ? `, ${p.company}` : ''}${p.segment ? ` (segment ${p.segment})` : ''}.\n` +
    `Channel: ${p.channel}${p.handle ? ` ${p.handle}` : ''}.\n\n` +
    `EVIDENCE (the only facts you may use):\n${p.evidence ?? '(none on file)'}\n\n` +
    (p.message ? `THE CURRENT DRAFT, which he may have edited by hand:\n${p.message}\n\n` : '') +
    'Draft the message.';
  const turns = asTurns(conversation).slice(-12);
  const messages: DraftTurn[] = [{ role: 'user', content: opening }, ...turns];
  const body = (await callProposal(system, messages, DRAFT_TOOL, 'Drafting')) as ProposalBody;
  const input = toolInput(body);
  const text = withoutDashes(clean(input?.text) || proseOf(body).trim());
  if (!text) throw new AppError('Drafting: it came back with nothing.', 502);
  const draft = { message: text, answer: withoutDashes(clean(input?.answer)) };
  await db
    .update(outreachProspects)
    .set({
      message: text,
      conversation: [...turns, { role: 'assistant', content: JSON.stringify(draft) }] as OutreachTurn[],
      updatedAt: new Date(),
    })
    .where(eq(outreachProspects.id, id));
  return draft;
}

/** A question about the outreach, answered from the record and the lessons. */
export async function askOutreach(turns: DraftTurn[]): Promise<{ answer: string }> {
  const kept = asTurns(turns).slice(-20);
  if (!kept.some(t => t.role === 'user')) throw new AppError('Ask something first.', 400);
  const system = await systemPrompt(ASK_RULES);
  const body = (await callProposal(system, kept, ANSWER_TOOL, 'Asking')) as ProposalBody;
  const answer = withoutDashes(clean(toolInput(body)?.answer) || proseOf(body).trim());
  if (!answer) throw new AppError('Asking: it came back with nothing.', 502);
  return { answer };
}
