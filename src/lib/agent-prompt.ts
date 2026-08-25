/**
 * The prompt a person hands their own AI so it can read a Telarchy floor.
 *
 * It lives in account settings rather than on the floor (owner direction
 * 2026-08-20: the page's job is the market, and every extra door on it is
 * weight). One function, so the copy button and its test cannot drift, and so
 * a second surface that wants to hand out the same instructions gets the same
 * text rather than a paraphrase.
 *
 * Everything it points at is public and unauthenticated: the brief is the same
 * one the floor's own Ask field reads, which is the point. A visitor's agent
 * and ours should be working from identical facts.
 */

export interface FloorRef {
  idOrSlug: string;
  name: string;
}

export function agentPrompt(origin: string, floor: FloorRef | null): string {
  if (floor) {
    const base = `${origin}/api/marketplace/${floor.idOrSlug}`;
    return [
      `You are researching ${floor.name} on Telarchy, where a market prices what each proposed contract would do to the company's real numbers.`,
      '',
      `1. Read the brief: GET ${base}/context?format=md`,
      "   It carries the company, every metric with its history, the open markets and their current prices, every contract with the market's priced impact, and the owner's published documents. Drop ?format=md for JSON.",
      `2. The endpoint catalog is GET ${origin}/api/help. Registering a participant and placing trades are documented there.`,
      '',
      'Then answer my questions about this company using only that brief, and tell me when something is not in it. Treat market prices as predictions, not facts.',
    ].join('\n');
  }
  return [
    "You are working with Telarchy, where a market prices what each proposed action would do to a company's real numbers.",
    '',
    `1. List the open floors: GET ${origin}/api/marketplace/workspaces/public`,
    `2. For any of them, read its brief: GET ${origin}/api/marketplace/<slug>/context?format=md`,
    "   It carries the company, every metric with its history, the open markets and their current prices, every contract with the market's priced impact, and the owner's published documents. Drop ?format=md for JSON.",
    `3. The endpoint catalog is GET ${origin}/api/help. Registering a participant and placing trades are documented there.`,
    '',
    'Answer my questions using only those briefs, and tell me when something is not in them. Treat market prices as predictions, not facts.',
  ].join('\n');
}
