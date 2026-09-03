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

/** A reply from either transport: Anthropic content blocks, or the gateway's
 *  OpenAI-shaped choices. */
export type ProposalBody = {
  content?: MessageBlock[];
  choices?: {
    message?: {
      content?: string | null;
      tool_calls?: { function?: { name?: string; arguments?: string } }[];
    };
  }[];
};

const clean = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

/** The tool call's input, from whichever shape the reply has, or null. */
function toolInput(body: ProposalBody): Record<string, unknown> | null {
  const block = (body.content ?? []).find(b => b.type === 'tool_use' && b.input && typeof b.input === 'object');
  if (block) return block.input as Record<string, unknown>;
  const args = body.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (typeof args === 'string' && args.trim()) {
    try {
      return JSON.parse(args) as Record<string, unknown>;
    } catch {
      return readObject(args, ['text', 'reply', 'post', 'reason', 'answer', 'note', 'query', 'rationale']);
    }
  }
  return null;
}

/** Whatever prose the reply carried, from whichever shape. */
function proseOf(body: ProposalBody): string {
  const blocks = (body.content ?? []).map(b => b.text ?? '').join('');
  return blocks || (body.choices?.[0]?.message?.content ?? '');
}

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
 * A draft out of a reply from either transport: the tool call first, then a
 * text answer read leniently (fenced, prefixed, brace-less), then plain prose
 * taken as what it says to him, so nothing he paid for is thrown away and no
 * prose lands in the draft box.
 */
export function parseDraft(body: ProposalBody): {
  text: string;
  reason: string;
  answer: string;
} {
  const input = toolInput(body);
  if (input) {
    return {
      text: clean(input.text ?? input.reply ?? input.post),
      reason: clean(input.reason) || 'draft',
      answer: clean(input.answer ?? input.note),
    };
  }
  const raw = proseOf(body);
  const obj = readObject(raw, ['text', 'reply', 'post', 'reason', 'answer', 'note']);
  if (!obj) return { text: '', reason: 'draft', answer: raw.trim() };
  return {
    text: obj.text || obj.reply || obj.post || '',
    reason: obj.reason || 'draft',
    answer: obj.answer || obj.note || '',
  };
}

/**
 * Which model proposes, and how hard it thinks (docs/x-workbench.md,
 * "Drafting"). A slug with a provider prefix (openai/gpt-5.6-luna) goes
 * through the Vercel AI Gateway on the floor's key; anything else is a Claude
 * model on the Anthropic key. Both settings change without a deploy.
 */
const DEFAULT_DRAFT_MODEL = 'claude-opus-5';
const DEFAULT_DRAFT_FALLBACK = 'claude-opus-5';
const DEFAULT_DRAFT_EFFORT = 'high';
const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions';

function draftModel(): string {
  return process.env.X_DRAFT_MODEL || DEFAULT_DRAFT_MODEL;
}
function draftEffort(): string {
  return process.env.X_DRAFT_EFFORT || DEFAULT_DRAFT_EFFORT;
}
function viaGateway(model: string): boolean {
  return model.includes('/');
}
function draftFallback(): string {
  return process.env.X_DRAFT_FALLBACK || DEFAULT_DRAFT_FALLBACK;
}
function keyFor(model: string): string | undefined {
  return viaGateway(model) ? process.env.AI_GATEWAY_API_KEY : process.env.ANTHROPIC_API_KEY;
}
function draftKey(): string | undefined {
  return keyFor(draftModel());
}

export function draftingConfigured(): boolean {
  return Boolean(draftKey());
}

function requireDraftKey(): string {
  const key = draftKey();
  if (!key) {
    const name = viaGateway(draftModel()) ? 'AI_GATEWAY_API_KEY' : 'ANTHROPIC_API_KEY';
    throw new AppError(`Drafting is not configured (no ${name}).`, 503);
  }
  return key;
}

/** A draft never carries an em-dash or an en-dash: one the model wrote
 *  anyway becomes a comma before he sees it. Hyphens are left alone, since
 *  search operators and compound words need them. */
export function withoutDashes(text: string): string {
  return text.replace(/\s*[\u2014\u2013]\s*/g, ', ');
}

/** The shape a proposal is asked for, in the vocabulary each transport uses. */
interface ProposalTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/** A reply the model declined to make: a refusal stop, or nothing in it at
 *  all (no tool call, no prose), whatever the stop reason says. */
function refused(body: ProposalBody & { stop_reason?: string }): boolean {
  if (body.stop_reason === 'refusal') return true;
  return !toolInput(body) && !proseOf(body).trim();
}

/**
 * One call to one model. Claude thinks adaptively at the set effort and is
 * offered the tool (Fable refuses a forced choice); the gateway is asked to
 * reason at the same effort and forced onto the tool, which OpenAI models
 * accept.
 */
async function proposeWith(
  model: string,
  key: string,
  system: string,
  messages: DraftTurn[],
  tool: ProposalTool,
  what: string,
): Promise<ProposalBody & { stop_reason?: string }> {
  const effort = draftEffort();
  const res = viaGateway(model)
    ? await fetch(GATEWAY, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          max_completion_tokens: 4000,
          reasoning_effort: effort,
          messages: [{ role: 'system', content: system }, ...messages],
          tools: [
            {
              type: 'function',
              function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.input_schema,
              },
            },
          ],
          tool_choice: { type: 'function', function: { name: tool.name } },
        }),
      })
    : await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model,
          max_tokens: 4000,
          system,
          messages,
          tools: [tool],
          thinking: { type: 'adaptive' },
          output_config: { effort },
        }),
      });
  if (!res.ok) throw new AppError(`${what} failed (${res.status}).`, 502);
  return (await res.json()) as ProposalBody & { stop_reason?: string };
}

/**
 * One proposing call: the system prompt, the conversation, the tool to
 * answer through. A refusal from the set model is retried once on the
 * fallback (skipped when it is the same model, or its key is missing), and a
 * refusal from both is an error he sees, never an empty draft
 * (docs/x-workbench.md, "Drafting").
 */
async function callProposal(system: string, messages: DraftTurn[], tool: ProposalTool, what: string): Promise<unknown> {
  requireDraftKey();
  const primary = draftModel();
  const fallback = draftFallback();
  const models = [primary, ...(fallback !== primary && keyFor(fallback) ? [fallback] : [])];
  for (const model of models) {
    const body = await proposeWith(model, keyFor(model) as string, system, messages, tool, what);
    if (!refused(body)) return body;
    console.warn(`x workbench: ${model} declined to draft (${what.toLowerCase()})`);
  }
  throw new AppError(`${what}: the model declined to draft this one. Try other words, or another model.`, 502);
}

export async function draftReply(
  post: { id: string; author?: string; text: string },
  conversation: DraftTurn[],
): Promise<Draft> {
  requireDraftKey();
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

  const d = parseDraft((await callProposal(system, messages, DRAFT_TOOL, 'Drafting')) as ProposalBody);
  return { reply: withoutDashes(d.text), reason: d.reason, answer: d.answer };
}

/**
 * A post of his own, from an idea, through the same argument. The digest it
 * learns from is his posts' record, not his replies': the two are different
 * games on X and a pattern from one says nothing about the other.
 */
export async function draftPost(idea: string, conversation: DraftTurn[]): Promise<PostDraft> {
  requireDraftKey();
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
  const d = parseDraft((await callProposal(system, messages, DRAFT_TOOL, 'Drafting')) as ProposalBody);
  return { post: withoutDashes(d.text), reason: d.reason, answer: d.answer };
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

He can argue with the proposal ("narrower", "not about Polymarket", "why this one?"): answer him, and propose again or defend the query.

Hand the proposal back through the propose_query tool: the query, a rationale of one sentence (under 40 words) on what it should surface and why, given what worked before, and answer: what you say to him. A sentence when nothing was asked; when he pushed back or asked something, as many sentences as the answer needs.`;

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
      answer: {
        type: 'string',
        description: 'What you say to him: what you did, or the answer to what he asked.',
      },
    },
    required: ['query', 'rationale', 'answer'],
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
export function parseSuggestion(body: ProposalBody): {
  query: string;
  rationale: string;
  answer: string;
} {
  const fail = () => new AppError('Search suggestion came back with no query.', 502);
  const input = toolInput(body);
  if (input) {
    const query = clean(input.query);
    if (!query) throw fail();
    return {
      query,
      rationale: clean(input.rationale),
      answer: clean(input.answer),
    };
  }
  const obj = readObject(proseOf(body), ['query', 'rationale', 'answer']);
  if (!obj?.query) throw fail();
  return {
    query: obj.query,
    rationale: obj.rationale ?? '',
    answer: obj.answer ?? '',
  };
}

/**
 * The next query to try, chosen against the record of what past queries
 * produced. With no history it still proposes something, because the first
 * query has to come from somewhere.
 */
export async function suggestSearch(
  avoid: string[] = [],
  conversation: DraftTurn[] = [],
): Promise<{ query: string; rationale: string; answer: string }> {
  requireDraftKey();
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
  const system = SEARCH_RULES + (profile ? `\n\nWHO HE IS AND WHAT HE CAN SPEAK TO:\n${profile}` : '');
  const messages: DraftTurn[] = [
    { role: 'user', content: `${record}${banned}\n\nPropose the next query.` },
    ...conversation.slice(-12),
  ];
  return parseSuggestion(
    (await callProposal(system, messages, PROPOSE_QUERY_TOOL, 'Search suggestion')) as ProposalBody,
  );
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
