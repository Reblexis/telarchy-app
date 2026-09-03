/**
 * The X workbench: read one post, draft a reply, learn from what was sent.
 * Governing doc: docs/x-workbench.md.
 *
 * Deliberately small: no search, no posting, no scheduling. The owner supplies
 * the post id because he is looking at the post, which is what lets this work
 * with no X credential at all.
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { xReplies, xSearches, xVoiceProfile } from '../db/schema';
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
export async function performanceDigest(kind: 'reply' | 'post' = 'reply'): Promise<string> {
  const rows = await db
    .select()
    .from(xReplies)
    .where(and(isNotNull(xReplies.likes), eq(xReplies.kind, kind)))
    .orderBy(desc(xReplies.likes))
    .limit(50);
  if (rows.length < 5) return '';
  const line = (r: (typeof rows)[number]) =>
    `${r.likes ?? 0} likes, ${r.replies ?? 0} replies, ${r.length} chars` +
    `${r.hasNumber ? ', has a number' : ''}${r.disagrees ? ', disagrees' : ''}: ${r.text}`;
  const best = rows.slice(0, 5).map(line);
  const worst = rows.slice(-5).map(line);
  const noun = kind === 'post' ? 'POSTS' : 'REPLIES';
  return (
    `HIS ${noun} THAT EARNED THE MOST:\n` +
    best.join('\n') +
    `\n\nHIS ${noun} THAT EARNED THE LEAST:\n` +
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

Hand the draft back through the draft tool: text (the reply, empty when skipping), reason (one word: disagree|number|question|counterexample|skip), and answer: what you say to him. A sentence on what you did when nothing was asked; when he pushed back or asked something, as many sentences as the answer needs, in plain words.`;

/**
 * What a post of his own obeys (docs/x-workbench.md, "Writing his own post").
 * The rules are the conclusion of the record of what travels on X for
 * founders in his space; the record itself lives in the umbrella's notes.
 */
export const POST_RULES = `You draft posts on X for the owner of this workspace, from an idea he gives you: a sentence, a number he wants to say, a rough draft. He reads every draft and posts it himself, or not. You are one half of an argument about what to say, not a vending machine: when he pushes back or asks something, answer him, and change your position or defend it.

Rules for a post, from the record of what travels for founders in his space:
- Text only. If a link belongs with it, say so in your answer and keep it out of the body: it goes in the first reply. No hashtags, no @mentions of large accounts, no emoji.
- Two to four lines, 100 to 280 characters. The meaning is in the first line: a reader who stops there has the point.
- A number only when it is real and in the voice profile below, and then early. A market that was right is stated beside the thing it missed; never boast a record without the miss.
- No pitch, no "we are excited", nothing that reads as marketing. Written the way he would say it to a friend. Flat concrete claims, short declaratives. No em-dashes.
- Never bait, never rage, never a fight with a critic. One credible reader muting the account costs more than a hundred likes.
- Avoid the words bet, odds and alignment; "market" is fine.
- One idea per post. If his idea is two posts, say so in your answer and draft the first.

Hand the draft back through the draft tool: text (the post), reason (one word for its shape: called-it|test|milestone|demo|quote|correction|other), and answer: what you say to him. A sentence on what you did when nothing was asked; when he pushed back or asked something, as many sentences as the answer needs, in plain words.`;

export interface DraftTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface Draft {
  reply: string;
  reason: string;
  answer: string;
}

export interface PostDraft {
  post: string;
  reason: string;
  answer: string;
}

/** The shape every draft comes back in, so nothing is scraped out of prose. */
const DRAFT_TOOL = {
  name: 'draft',
  description: 'The drafted text, the one-word reason for its shape, and what you say to him about it.',
  input_schema: {
    type: 'object',
    properties: {
      text: {
        type: 'string',
        description: 'The reply or post. Empty when the reason is skip.',
      },
      reason: { type: 'string', description: 'One word.' },
      answer: {
        type: 'string',
        description: 'What you say to him: what you did, why you hold your ground, or the answer to what he asked.',
      },
    },
    required: ['text', 'reason', 'answer'],
  },
};

type MessageBlock = { type?: string; text?: string; input?: unknown };

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/**
 * The first {...} in a text answer, repaired when the model lost the closing
 * brace or a closing quote, else the named fields pulled out by regex. Null
 * when there is no object at all.
 */
function readObject(raw: string, fields: string[]): Record<string, string> | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  const chunk = raw.slice(start).replace(/```\s*$/, '');
  for (const c of [chunk, chunk.trim() + '}', chunk.trim() + '"}']) {
    const end = c.lastIndexOf('}');
    if (end === -1) continue;
    try {
      const parsed = JSON.parse(c.slice(0, end + 1)) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const f of fields) out[f] = clean(parsed[f]);
      return out;
    } catch {
      /* try the next repair */
    }
  }
  const out: Record<string, string> = {};
  for (const f of fields) {
    const m = chunk.match(new RegExp(`"${f}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`));
    if (!m) continue;
    try {
      out[f] = clean(JSON.parse(`"${m[1]}"`));
    } catch {
      out[f] = clean(m[1]);
    }
  }
  return out;
}

/**
 * A draft out of a messages response: the forced tool call first, then a
 * text answer read leniently (fenced, prefixed, brace-less), then plain
 * prose taken as the text itself so nothing he paid for is thrown away.
 */
export function parseDraft(body: { content?: MessageBlock[] }): {
  text: string;
  reason: string;
  answer: string;
} {
  const blocks = body.content ?? [];
  const call = blocks.find(b => b.type === 'tool_use' && b.input && typeof b.input === 'object');
  if (call) {
    const input = call.input as Record<string, unknown>;
    return {
      text: clean(input.text ?? input.reply ?? input.post),
      reason: clean(input.reason) || 'draft',
      answer: clean(input.answer ?? input.note),
    };
  }
  const raw = blocks.map(b => b.text ?? '').join('');
  const obj = readObject(raw, ['text', 'reply', 'post', 'reason', 'answer', 'note']);
  if (!obj) return { text: raw.trim(), reason: 'draft', answer: '' };
  return {
    text: obj.text || obj.reply || obj.post || '',
    reason: obj.reason || 'draft',
    answer: obj.answer || obj.note || '',
  };
}

/** One drafting call: the system prompt, the conversation, the forced tool. */
async function callDraft(key: string, system: string, messages: DraftTurn[]) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.X_DRAFT_MODEL ?? 'claude-sonnet-5',
      max_tokens: 800,
      system,
      messages,
      tools: [DRAFT_TOOL],
      tool_choice: { type: 'tool', name: 'draft' },
    }),
  });
  if (!res.ok) throw new AppError(`Drafting failed (${res.status}).`, 502);
  return parseDraft((await res.json()) as { content?: MessageBlock[] });
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

  const d = await callDraft(key, system, messages);
  return { reply: d.text, reason: d.reason, answer: d.answer };
}

/**
 * A post of his own, from an idea, through the same argument. The digest it
 * learns from is his posts' record, not his replies': the two are different
 * games on X and a pattern from one says nothing about the other.
 */
export async function draftPost(idea: string, conversation: DraftTurn[]): Promise<PostDraft> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AppError('Drafting is not configured (no ANTHROPIC_API_KEY).', 503);
  }
  const [profile, digest] = await Promise.all([getVoiceProfile(), performanceDigest('post')]);
  const system =
    POST_RULES +
    (profile
      ? `\n\nVOICE PROFILE AND FACTS HE MAY STATE:\n${profile}`
      : '\n\nNo voice profile is set, so write plainly and state no specific facts or numbers about his companies beyond what his idea says.') +
    (digest ? `\n\n${digest}` : '');
  const messages: DraftTurn[] = [
    {
      role: 'user',
      content: `His idea for a post:\n\n${idea}\n\nDraft the post.`,
    },
    ...conversation.slice(-12),
  ];
  const d = await callDraft(key, system, messages);
  return { post: d.text, reason: d.reason, answer: d.answer };
}

// --- the log -----------------------------------------------------------------

export async function recordReply(input: {
  /** 'reply' (the default) needs sourcePostId; 'post' has none. */
  kind?: 'reply' | 'post';
  sourcePostId?: string | null;
  searchId?: string | null;
  sourceAuthor?: string | null;
  sourceText?: string | null;
  sourceFollowers?: number | null;
  text: string;
  replyId?: string | null;
}) {
  const kind = input.kind ?? 'reply';
  if (kind === 'reply' && !input.sourcePostId) {
    throw new AppError('A reply needs the post it answers.', 400);
  }
  const row = {
    id: randomUUID(),
    kind,
    sourcePostId: kind === 'post' ? null : (input.sourcePostId as string),
    sourceAuthor: input.sourceAuthor ?? null,
    sourceText: input.sourceText ?? null,
    sourceFollowers: input.sourceFollowers ?? null,
    text: input.text,
    replyId: input.replyId ?? null,
    searchId: input.searchId ?? null,
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
export function summarise(
  rows: {
    likes: number | null;
    hasNumber: boolean;
    disagrees: boolean;
    length: number;
  }[],
) {
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
    return {
      label,
      on: Math.round(on * 10) / 10,
      off: Math.round(off * 10) / 10,
    };
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
        .set({
          likes: post.likes,
          replies: post.replies,
          metricsAt: new Date(),
        })
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

// --- search prompts ----------------------------------------------------------

/**
 * What each past query actually produced: posts pasted back, replies sent, and
 * the likes those replies earned. A query that returns a hundred posts he never
 * answers is a worse query than one that returns three he does, which is why
 * the yield is counted in replies rather than in results.
 */
export async function searchYield() {
  const rows = await db
    .select({
      id: xSearches.id,
      query: xSearches.query,
      rationale: xSearches.rationale,
      harvested: xSearches.harvested,
      lastUsedAt: xSearches.lastUsedAt,
      createdAt: xSearches.createdAt,
      replies: sql<number>`count(${xReplies.id})::int`,
      likes: sql<number>`coalesce(sum(${xReplies.likes}), 0)::int`,
    })
    .from(xSearches)
    .leftJoin(xReplies, eq(xReplies.searchId, xSearches.id))
    .groupBy(xSearches.id)
    .orderBy(desc(xSearches.createdAt))
    .limit(50);
  return rows;
}

const SEARCH_RULES = `You propose ONE X (Twitter) search query for the owner to run by hand. He cannot search programmatically, so the query has to be worth the minute it costs him.

What a good query is here:
- Uses X search operators. Useful ones: quoted phrases, OR, parentheses, -filter:replies (thread starters only, which are the ones still gathering readers), min_faves:N (skips dead posts), lang:en, within_time:24h, -filter:links.
- Aimed at conversations he can add a number or a counterexample to, not at news about his subject. A thread of people arguing about whether forecasting works is worth ten headlines about a prediction market company.
- Different from the queries that yielded nothing before. Adjacent to the ones that produced replies people engaged with.
- Narrow enough that the Latest tab is readable. If it would return a wall, add a min_faves or a second required term.

Hand the proposal back through the propose_query tool: the query, and a rationale of one sentence (under 40 words) on what it should surface and why, given what worked before.`;

/** The shape the model is made to answer in, so nothing is scraped out of prose. */
const PROPOSE_QUERY_TOOL = {
  name: 'propose_query',
  description: 'The one X search query to run next, with a one-sentence rationale.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The query, in X search syntax.' },
      rationale: {
        type: 'string',
        description: 'One sentence, under 40 words.',
      },
    },
    required: ['query', 'rationale'],
  },
};

/**
 * The proposal out of a messages response. The forced tool call is the shape
 * asked for; the text fallbacks exist because a model that answers in prose
 * anyway (a fenced block, a preamble, a rationale long enough to lose its
 * closing brace) still contains the query, and losing it over a brace is what
 * "Search suggestion came back unparseable" was. Only a reply with no query
 * at all fails.
 */
export function parseSuggestion(body: { content?: MessageBlock[] }): {
  query: string;
  rationale: string;
} {
  const blocks = body.content ?? [];
  const fail = () => new AppError('Search suggestion came back with no query.', 502);

  const call = blocks.find(b => b.type === 'tool_use' && b.input && typeof b.input === 'object');
  if (call) {
    const input = call.input as { query?: unknown; rationale?: unknown };
    const query = clean(input.query);
    if (!query) throw fail();
    return { query, rationale: clean(input.rationale) };
  }

  const obj = readObject(blocks.map(b => b.text ?? '').join(''), ['query', 'rationale']);
  if (!obj?.query) throw fail();
  return { query: obj.query, rationale: obj.rationale ?? '' };
}

/**
 * The next query to try, chosen against the record of what past queries
 * produced. With no history it still proposes something, because the first
 * query has to come from somewhere.
 */
export async function suggestSearch(avoid: string[] = []): Promise<{ query: string; rationale: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new AppError('Search suggestions need ANTHROPIC_API_KEY.', 503);
  }
  const [profile, history] = await Promise.all([getVoiceProfile(), searchYield()]);
  const record = history.length
    ? 'QUERIES ALREADY TRIED, with what each produced:\n' +
      history
        .map(
          h => `"${h.query}" -> ${h.harvested} posts pasted back, ${h.replies} replies sent, ${h.likes} likes earned`,
        )
        .join('\n')
    : 'No queries tried yet.';
  const banned = avoid.length ? `\n\nDo not repeat any of these: ${avoid.map(q => `"${q}"`).join(', ')}` : '';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.X_DRAFT_MODEL ?? 'claude-sonnet-5',
      max_tokens: 600,
      system: SEARCH_RULES + (profile ? `\n\nWHO HE IS AND WHAT HE CAN SPEAK TO:\n${profile}` : ''),
      messages: [
        {
          role: 'user',
          content: `${record}${banned}\n\nPropose the next query.`,
        },
      ],
      tools: [PROPOSE_QUERY_TOOL],
      tool_choice: { type: 'tool', name: 'propose_query' },
    }),
  });
  if (!res.ok) throw new AppError(`Search suggestion failed (${res.status}).`, 502);
  return parseSuggestion((await res.json()) as { content?: MessageBlock[] });
}

export async function saveSearch(query: string, rationale?: string) {
  const row = {
    id: randomUUID(),
    query,
    rationale: rationale ?? null,
    harvested: 0,
    lastUsedAt: null as Date | null,
  };
  await db.insert(xSearches).values(row);
  return row;
}

/**
 * The ids he found by running a query. Each is looked up so he can see what he
 * is about to answer; the count is recorded against the search whether or not
 * he ends up replying to any of them, because "this query surfaced nothing
 * usable" is exactly the signal the next suggestion needs.
 */
export async function harvestSearch(searchId: string, ids: string[]) {
  const posts: XPost[] = [];
  const failed: string[] = [];
  for (const raw of ids) {
    try {
      posts.push(await fetchPost(parsePostId(raw)));
    } catch {
      failed.push(raw);
    }
  }
  await db
    .update(xSearches)
    .set({
      harvested: sql`${xSearches.harvested} + ${ids.length}`,
      lastUsedAt: new Date(),
    })
    .where(eq(xSearches.id, searchId));
  return { posts, failed };
}
