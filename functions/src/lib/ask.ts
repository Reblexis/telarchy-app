/**
 * The floor's answer service (owner ask 2026-08-20: "reduce friction for
 * traders").
 *
 * A visitor who cannot tell what a company sells does not price its markets,
 * and the fix is not more panels: it is being able to ask. This wraps one
 * Claude call over the workspace brief (services/workspace-context.ts).
 *
 * Three rules the prompt enforces, because an answer that invents a number on
 * a page full of real ones is worse than no answer:
 *   1. Everything comes from the brief. No outside knowledge, no guessing.
 *   2. Not in the brief means saying so, in one line.
 *   3. Prices are quoted as what the market says, never as fact about the
 *      future, because that distinction is the entire product.
 *
 * ANTHROPIC_API_KEY unset means the feature is off and the route says so;
 * local dev and tests never reach the network.
 */

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-opus-5';
/** Answers are read beside a market, not in a chat window: keep them short. */
const MAX_TOKENS = 1200;

export function askEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

const SYSTEM = `You answer questions about one company's public Telarchy floor, for a visitor deciding whether to trade its markets or to do one of its contracts.

Answer ONLY from the brief in the first user message. It contains the company's own description, its metrics and their history, the open markets and what they currently predict, every contract with the market's priced impact, the owner's announcements, and any documents the owner published.

Rules:
- If the brief does not contain the answer, say so in one sentence and name what would answer it (a metric, a document, a contract). Never guess, never use outside knowledge about the company, never invent a number.
- A market price is a prediction, not a fact: write "the market says X" or "traders price it at X", never "X will happen".
- Quote real numbers from the brief when they answer the question, with their date or horizon.
- Be brief: two to five sentences, or a short list when the question asks for several things. No preamble, no restating the question, no sign-off.
- Plain words. The reader may be new to prediction markets.
- If the question is about how Telarchy itself works rather than this company, answer in one or two sentences from what the brief shows.`;

export interface AskResult {
  answer: string;
  /** Input tokens billed, so the operator can see what this costs. */
  usage: { input: number; cachedInput: number; output: number };
}

export async function askAboutWorkspace(brief: string, question: string): Promise<AskResult> {
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    // Low effort: this is a read-and-answer task over a supplied document,
    // and a floor question should come back while the reader is still
    // looking at the market.
    output_config: { effort: 'low' },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Here is the brief.\n\n${brief}`,
            // The brief is identical for every visitor asking about the same
            // floor, so it is the cache prefix; the question goes after it.
            cache_control: { type: 'ephemeral' },
          },
          { type: 'text', text: `Question: ${question}` },
        ],
      },
    ],
  });

  const answer = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();

  return {
    answer,
    usage: {
      input: response.usage.input_tokens,
      cachedInput: response.usage.cache_read_input_tokens ?? 0,
      output: response.usage.output_tokens,
    },
  };
}
