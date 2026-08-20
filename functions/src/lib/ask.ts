/**
 * The floor's answer service (owner ask 2026-08-20: "reduce friction for
 * traders").
 *
 * A visitor who cannot tell what a company sells does not price its markets,
 * and the fix is not more panels: it is being able to ask. This is one model
 * call over the workspace brief (services/workspace-context.ts).
 *
 * Transport is the Vercel AI Gateway (owner direction 2026-08-20), the same
 * aggregator the agent economy's llm-router already routes through, on a key
 * whose hard dollar budget IS the ceiling: Vercel refuses the request with a
 * 402 once it is spent, so the worst case is the feature going quiet rather
 * than a bill. The default model is `openai/gpt-5.6-luna` at $0.20/$1.20 per
 * million tokens, roughly a tenth of a cent per question, because this task is
 * reading a supplied document rather than reasoning from scratch. ASK_MODEL
 * overrides it without a deploy.
 *
 * Three rules the prompt enforces, because an answer that invents a number on
 * a page full of real ones is worse than no answer:
 *   1. Everything comes from the brief. No outside knowledge, no guessing.
 *   2. Not in the brief means saying so, in one line.
 *   3. Prices are quoted as what the market says, never as fact about the
 *      future, because that distinction is the entire product.
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

const SYSTEM = `You answer questions about one company's public Telarchy floor, for a visitor deciding whether to trade its markets or to do one of its contracts.

Answer ONLY from the brief in the user message. It contains the company's own description, its metrics and their history, the open markets and what they currently predict, every contract with the market's priced impact, the owner's announcements, and any documents the owner published.

Rules:
- If the brief does not contain the answer, say so in one sentence and name what would answer it (a metric, a document, a contract). Never guess, never use outside knowledge about the company, never invent a number.
- A market price is a prediction, not a fact: write "the market says X" or "traders price it at X", never "X will happen".
- Quote real numbers from the brief when they answer the question, with their date or horizon.
- Be brief: two to five sentences, or a short list when the question asks for several things. No preamble, no restating the question, no sign-off.
- Plain words. The reader may be new to prediction markets.
- Plain sentences, no markdown: no **bold**, no bullet syntax, no headings. The floor prints your answer as written, so an asterisk is an asterisk on the page.
- Never use an em dash or an en dash. Use a comma, a colon, parentheses, or two sentences. This is the site's house style and a dash is the one thing its owner will notice.`;

export interface AskResult {
  answer: string;
  /** What the call cost, so the operator can see it in the logs. */
  usage: { input: number; cachedInput: number; output: number; costUsd: number | null };
}

export async function askAboutWorkspace(brief: string, question: string): Promise<AskResult> {
  const key = apiKey();
  if (!key) throw new Error('AI_GATEWAY_API_KEY is not set');

  const res = await fetch(GATEWAY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.ASK_MODEL || DEFAULT_MODEL,
      max_completion_tokens: MAX_TOKENS,
      messages: [
        // The brief goes in the system turn, ahead of the question: it is
        // identical for every visitor asking about the same floor, so it is
        // the prefix an upstream cache can actually hit.
        { role: 'system', content: `${SYSTEM}\n\n---\n\nThe brief:\n\n${brief}` },
        { role: 'user', content: question },
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
