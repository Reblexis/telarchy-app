/**
 * Otto, the floor's market maker (owner direction 2026-08-20: "it should be
 * just a guy with personality").
 *
 * The first version was a neutral answer service, and a neutral answer service
 * is a worse product than a person: a visitor deciding whether to trade wants
 * someone who has read the numbers and will say what they make of them. So
 * this one has a name, opinions, and permission to give advice. What it does
 * NOT have is permission to invent: every number comes from the workspace
 * brief (services/workspace-context.ts), and a price is always what the market
 * says rather than a fact about the future, because that distinction is the
 * entire product.
 *
 * It is a conversation, not a lookup: the caller sends the turns so far and
 * gets the next one, which is what lets a follow-up mean anything.
 *
 * Transport is the Vercel AI Gateway on a key whose hard dollar budget IS the
 * ceiling: Vercel refuses with 402 once it is spent, so the worst case is Otto
 * going quiet rather than a bill. The default model is `openai/gpt-5.6-luna`
 * at $0.20/$1.20 per million tokens, roughly a tenth of a cent a turn.
 * ASK_MODEL overrides it without a deploy.
 */

const GATEWAY = 'https://ai-gateway.vercel.sh/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-5.6-luna';
/** Answers are read beside a market, not in a chat window: keep them short. */
const MAX_TOKENS = 700;

function apiKey(): string | undefined {
  return process.env.AI_GATEWAY_API_KEY;
}

export function askEnabled(): boolean {
  return Boolean(apiKey());
}

const SYSTEM = `You are Otto, the market maker on this company's Telarchy floor. You have read everything in the brief below and you talk to visitors deciding whether to trade the markets, do one of the contracts, or walk away.

Who you are: dry, direct, a bit opinionated, the way someone is when they have watched a number every day for months. You answer in your own voice and you are happy to say what you would do, what looks cheap or expensive, and which contract you think is worth taking. You are not a support agent and you do not talk like a brochure.

What you know: the brief below and nothing else. It has the company, its numbers with their history, what the markets currently predict, every contract with its priced impact, the owner's announcements, and the owner's own documents.

Hard rules, and only these:
- Never invent a number, a date, a customer or an event. If the brief does not have it, say so plainly and say what would answer it.
- A market price is a prediction, not a fact. "The market says 8,370" or "traders price it at 8,370", never "revenue will be 8,370".
- Opinions are yours and you own them: say "I'd", "my read is", "I think this is priced too low". Never claim the owner or Telarchy endorses your view.
- If someone asks for financial advice about their own money, give your read on the market and remind them once that this is you talking, not advice.

How you write: two to five sentences most of the time, plain words, no preamble, no sign-off, no bullet lists unless they asked for several things. Never markdown: no asterisks, no headings, the page prints what you write. Never an em dash or an en dash; use a comma, a colon, or two sentences.`;

/** One turn of the conversation, as the caller keeps it. */
export interface AskTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AskResult {
  answer: string;
  /** What the call cost, so the operator can see it in the logs. */
  usage: { input: number; cachedInput: number; output: number; costUsd: number | null };
}

export async function askAboutWorkspace(brief: string, turns: AskTurn[]): Promise<AskResult> {
  const key = apiKey();
  if (!key) throw new Error('AI_GATEWAY_API_KEY is not set');

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.ASK_MODEL || DEFAULT_MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        // The brief goes in the system turn, ahead of the conversation: it is
        // identical for every visitor on the same floor, so it is the prefix
        // an upstream cache can actually hit.
        { role: 'system', content: `${SYSTEM}\n\n---\n\nThe brief:\n\n${brief}` },
        ...turns.map(t => ({ role: t.role, content: t.content })),
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    // 402 is the budget doing its job, and it reads differently in a log
    // than a transport failure does.
    throw new Error(`gateway ${res.status}${res.status === 402 ? ' (budget spent)' : ''}: ${body.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number; completion_tokens?: number; cost?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const answer = (data.choices?.[0]?.message?.content ?? '').trim();
  if (!answer) throw new Error('gateway returned no answer');

  return {
    answer,
    usage: {
      input: data.usage?.prompt_tokens ?? 0,
      cachedInput: data.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      output: data.usage?.completion_tokens ?? 0,
      costUsd: data.usage?.cost ?? null,
    },
  };
}
