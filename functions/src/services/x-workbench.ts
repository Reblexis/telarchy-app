/**
 * The X workbench: read one post, draft a reply, learn from what was sent.
 * Governing doc: docs/x-workbench.md.
 *
 * Deliberately small: no search, no posting, no scheduling. The owner supplies
 * the post id because he is looking at the post, which is what lets this work
 * with no X credential at all.
 */
import { randomUUID } from 'crypto';
import { desc, eq, isNotNull } from 'drizzle-orm';
import { db } from '../db/client';
import { xReplies, xVoiceProfile } from '../db/schema';
import { AppError } from '../lib/errors';

export interface XPost {
  id: string;
  author: string;
  authorName: string;
  text: string;
  likes: number;
  replies: number;
  createdAt: string | null;
}

/**
 * X's public single-post read wants a token derived from the id. It is not a
 * secret, it is a deterministic function the embed widget computes client-side,
 * which is exactly why this endpoint needs no credential.
 */
export function syndicationToken(id: string): string {
  return ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

/** Accepts an id, a status URL, or a URL with query junk on the end. */
export function parsePostId(input: string): string {
  const trimmed = (input || '').trim();
  const fromUrl = trimmed.match(/status(?:es)?\/(\d{5,25})/);
  const id = fromUrl ? fromUrl[1] : trimmed;
  if (!/^\d{5,25}$/.test(id)) {
    throw new AppError('Not an X post id or status URL', 400);
  }
  return id;
}

export async function fetchPost(id: string): Promise<XPost> {
  const url = `https://cdn.syndication.twimg.com/tweet-result?id=${id}` + `&token=${syndicationToken(id)}&lang=en`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  } catch {
    throw new AppError('X did not answer. Paste the post text by hand.', 502);
  }
  if (!res.ok) {
    // This endpoint is undocumented and will break one day. Say so, rather
    // than rendering an empty post and letting him draft against nothing.
    throw new AppError(
      `X returned ${res.status} for that post. It may be deleted, protected, or the public read is closed; paste the text by hand.`,
      502,
    );
  }
  const d = (await res.json()) as Record<string, any>;
  if (!d?.text) {
    throw new AppError('X returned no text for that post.', 502);
  }
  return {
    id,
    author: d.user?.screen_name ?? '',
    authorName: d.user?.name ?? '',
    text: d.text,
    likes: d.favorite_count ?? 0,
    replies: d.conversation_count ?? 0,
    createdAt: d.created_at ?? null,
  };
}

// --- features the log correlates against engagement --------------------------

export const hasNumber = (t: string) => /\d/.test(t);
export const disagrees = (t: string) => /\b(not|no|wrong|but|actually|disagree|except|however)\b/i.test(t);

// --- what worked before ------------------------------------------------------

/**
 * A compact digest of his sent replies for the drafting prompt: the ones that
 * earned the most and the ones that earned nothing. The model is asked to
 * notice the pattern, never to copy a winner, because copying a winner is how
 * an account starts repeating itself.
 */
export async function performanceDigest(): Promise<string> {
  const rows = await db
    .select()
    .from(xReplies)
    .where(isNotNull(xReplies.likes))
    .orderBy(desc(xReplies.likes))
    .limit(50);
  if (rows.length < 5) return '';
  const line = (r: (typeof rows)[number]) =>
    `${r.likes ?? 0} likes, ${r.replies ?? 0} replies, ${r.length} chars` +
    `${r.hasNumber ? ', has a number' : ''}${r.disagrees ? ', disagrees' : ''}: ${r.text}`;
  const best = rows.slice(0, 5).map(line);
  const worst = rows.slice(-5).map(line);
  return (
    'HIS REPLIES THAT EARNED THE MOST:\n' +
    best.join('\n') +
    '\n\nHIS REPLIES THAT EARNED THE LEAST:\n' +
    worst.join('\n') +
    '\n\nNotice what separates them. Do not copy the winners.'
  );
}

export async function getVoiceProfile(): Promise<string> {
  const [row] = await db.select().from(xVoiceProfile).where(eq(xVoiceProfile.id, 'default'));
  return row?.profile ?? '';
}

export async function setVoiceProfile(profile: string): Promise<void> {
  await db
    .insert(xVoiceProfile)
    .values({ id: 'default', profile, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: xVoiceProfile.id,
      set: { profile, updatedAt: new Date() },
    });
}

// --- drafting ----------------------------------------------------------------

const RULES = `You draft replies to X posts for the owner of this workspace. He reads every draft and sends it himself, or not. You are one half of an argument about what to say, not a vending machine: when he pushes back, change your position or defend it, briefly.

Rules for a reply:
- One to three sentences. Add something the thread does not have: a number from something he actually runs, a counterexample, a sharper question, a plain disagreement.
- Never pitch, never link, never flatter, never open with "great post".
- Only state facts from the voice profile below. Never invent a number, a date, a customer or an outcome. If the reply needs one that is not there, ask a question instead.
- Answer first, no preamble. Flat concrete claims. Short declaratives that stop rather than resolve. No rhetorical polish, no closing summary. No em-dashes.
- Avoid the words bet, odds and alignment; "market" is fine when the thread is about markets.
- If the post gives him nothing worth saying, say so: reply "" and reason "skip". Skipping is often right.

Return JSON only: {"reply": "...", "reason": "<one word: disagree|number|question|counterexample|skip>", "note": "<optional one sentence to him, e.g. what you changed or why you pushed back>"}`;

export interface DraftTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Draft {
  reply: string;
  reason: string;
  note?: string;
}

export function draftingConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export async function draftReply(
  post: { id: string; author?: string; text: string },
  conversation: DraftTurn[],
): Promise<Draft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AppError('Drafting is not configured (no ANTHROPIC_API_KEY).', 503);
  }
  const [profile, digest] = await Promise.all([getVoiceProfile(), performanceDigest()]);
  const system =
    RULES +
    (profile
      ? `\n\nVOICE PROFILE AND FACTS HE MAY STATE:\n${profile}`
      : '\n\nNo voice profile is set, so write plainly and state no specific facts about his companies.') +
    (digest ? `\n\n${digest}` : '');

  const opening = `The post he is answering, by @${post.author ?? 'unknown'}:\n\n${post.text}\n\n` + `Draft his reply.`;
  const messages: DraftTurn[] = [
    { role: 'user', content: opening },
    ...conversation.slice(-12), // the argument, bounded
  ];

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.X_DRAFT_MODEL ?? 'claude-sonnet-5',
      max_tokens: 400,
      system,
      messages,
    }),
  });
  if (!res.ok) {
    throw new AppError(`Drafting failed (${res.status}).`, 502);
  }
  const body = (await res.json()) as { content?: { text?: string }[] };
  const raw = (body.content ?? []).map(c => c.text ?? '').join('');
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return { reply: raw.trim(), reason: 'draft' };
  try {
    const parsed = JSON.parse(match[0]) as Draft;
    return {
      reply: (parsed.reply ?? '').trim(),
      reason: (parsed.reason ?? 'draft').trim(),
      note: parsed.note?.trim(),
    };
  } catch {
    return { reply: raw.trim(), reason: 'draft' };
  }
}

// --- the log -----------------------------------------------------------------

export async function recordReply(input: {
  sourcePostId: string;
  sourceAuthor?: string | null;
  sourceText?: string | null;
  sourceFollowers?: number | null;
  text: string;
  replyId?: string | null;
}) {
  const row = {
    id: randomUUID(),
    sourcePostId: input.sourcePostId,
    sourceAuthor: input.sourceAuthor ?? null,
    sourceText: input.sourceText ?? null,
    sourceFollowers: input.sourceFollowers ?? null,
    text: input.text,
    replyId: input.replyId ?? null,
    hasNumber: hasNumber(input.text),
    disagrees: disagrees(input.text),
    length: input.text.length,
  };
  await db.insert(xReplies).values(row);
  return row;
}

/**
 * The pattern across his replies, or an honest refusal to claim one. Three
 * data points are not a finding, and copy advice from three data points is
 * how superstition starts.
 */
export function summarise(rows: { likes: number | null; hasNumber: boolean; disagrees: boolean; length: number }[]) {
  const scored = rows.filter(r => r.likes !== null) as {
    likes: number;
    hasNumber: boolean;
    disagrees: boolean;
    length: number;
  }[];
  if (scored.length < 10) {
    return {
      enough: false,
      note: `${scored.length} replies with numbers so far. Ten is where a pattern starts meaning anything.`,
    };
  }
  const likes = scored.map(r => r.likes).sort((a, b) => a - b);
  const median = likes[Math.floor(likes.length / 2)];
  const anyEngagement = scored.filter(r => r.likes > 0).length / scored.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const feature = (pick: (r: (typeof scored)[number]) => boolean, label: string) => {
    const on = mean(scored.filter(pick).map(r => r.likes));
    const off = mean(scored.filter(r => !pick(r)).map(r => r.likes));
    return { label, on: Math.round(on * 10) / 10, off: Math.round(off * 10) / 10 };
  };
  return {
    enough: true,
    median,
    anyEngagement: Math.round(anyEngagement * 100),
    features: [
      feature(r => r.hasNumber, 'carries a number'),
      feature(r => r.disagrees, 'disagrees'),
      feature(r => r.length < 200, 'under 200 characters'),
    ],
  };
}

/** Refresh metrics for recorded replies that have an id, oldest-refreshed first. */
export async function refreshMetrics(limit = 25) {
  const rows = await db
    .select()
    .from(xReplies)
    .where(isNotNull(xReplies.replyId))
    .orderBy(xReplies.metricsAt)
    .limit(limit);
  let updated = 0;
  for (const row of rows) {
    try {
      const post = await fetchPost(row.replyId as string);
      await db
        .update(xReplies)
        .set({ likes: post.likes, replies: post.replies, metricsAt: new Date() })
        .where(eq(xReplies.id, row.id));
      updated++;
    } catch {
      // A deleted or unreadable reply must not stop the pass; stamp it so the
      // queue moves on rather than retrying the same dead id every six hours.
      await db.update(xReplies).set({ metricsAt: new Date() }).where(eq(xReplies.id, row.id));
    }
  }
  return { checked: rows.length, updated };
}
