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

/**
 * What the key the person just took may do. The prompt says it out loud, so
 * the agent knows what it can attempt before it tries: a read-only agent that
 * hands back the call to run is useful, one that discovers its limits by
 * getting 403s is not (owner ask 2026-08-31).
 */
export type KeyGrant = 'all' | 'here' | 'read' | 'none';

function grantLine(grant: KeyGrant, workspaceId: string): string[] {
  switch (grant) {
    case 'all':
      return [
        `- The key I am pasting does anything I can do, on every market I am in. Send it as "X-Agent-Key: <key>" with "X-Workspace-Id: ${workspaceId}".`,
      ];
    case 'here':
      return [
        `- The key I am pasting does anything I can do on THIS market and nothing on any other. Send it as "X-Agent-Key: <key>" with "X-Workspace-Id: ${workspaceId}".`,
      ];
    case 'read':
      return [
        `- The key I am pasting READS ONLY: it can see everything I can see and change nothing. Send it as "X-Agent-Key: <key>" with "X-Workspace-Id: ${workspaceId}".`,
        '- So when something needs changing, do not try the call. Tell me the exact request you would send and I will run it, or come back and widen the key.',
      ];
    case 'none':
      return [
        '- I am not giving you a key, so you can read what anyone can read and change nothing.',
        '- When something needs changing, tell me what you would do and I will do it, or I will come back with a key for you.',
      ];
  }
}

/** What the market looks like right now, as the operator's own agent needs to
 *  hear it: enough to know what exists, what is missing, and what to ask. */
export interface OwnerFloorState {
  workspaceId: string;
  name: string;
  /** The address people share; falls back to the id when there is no slug. */
  idOrSlug: string;
  /** Public, unlisted or private. An unlisted market is live and shareable. */
  visibility: string;
  metrics: Array<{
    name: string;
    /** The reading in force, null when the metric has never been read. */
    value: number | null;
    /** Open markets on this metric, with the credits behind each. */
    markets: Array<{ targetDate: string; pool: number }>;
  }>;
}

function fmtNum(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * The prompt an operator hands their own coding agent so it can run their
 * market (docs/owner-on-the-floor.md, "Handing it to your own agent").
 *
 * Built from state rather than written by a model: it is instant, it costs
 * nothing, and every id in it comes from the payload the page already holds,
 * so it cannot hallucinate a workspace. Otto writes the personalised version
 * on the operator door, where he has a conversation to draw on.
 *
 * It carries no key. A prompt is pasted into chat logs, issues and
 * screenshots; the key is offered separately, once, in the panel.
 */
export function ownerAgentPrompt(origin: string, state: OwnerFloorState, grant: KeyGrant = 'here'): string {
  const url = `${origin}/${state.idOrSlug}`;
  const lines: string[] = [];
  lines.push(
    `I run "${state.name}" on Telarchy, a public market that prices where my real numbers will land. I want you to help me set it up and then keep it true. Ask me what I want before you change anything.`,
    '',
    'WHERE IT IS',
    `- The market: ${url}`,
    `- Workspace id: ${state.workspaceId}`,
    `- Visibility: ${state.visibility}${state.visibility === 'unlisted' ? ' (live and shareable by link, not on the front page until I publish it)' : ''}`,
    '',
    'WHAT IS THERE NOW',
  );
  if (state.metrics.length === 0) {
    lines.push('- No metric yet, so there is nothing to trade. This is the first thing to fix.');
  } else {
    for (const m of state.metrics) {
      const reading = m.value === null ? 'never reported' : `now reads ${fmtNum(m.value)}`;
      if (m.markets.length === 0) {
        lines.push(
          `- "${m.name}", ${reading}, and NO date, so it has no market. A metric with no horizon opens nothing.`,
        );
      } else {
        const mk = m.markets.map(k => `${k.targetDate} with ${fmtNum(k.pool)} credits behind it`).join('; ');
        lines.push(`- "${m.name}", ${reading}, priced on ${mk}.`);
      }
    }
  }
  lines.push(
    '',
    'HOW TO ACT AS ME',
    ...grantLine(grant, state.workspaceId),
    `- Everything public is readable with no key at all: GET ${origin}/api/marketplace/${state.idOrSlug}/context?format=md is the whole brief.`,
    `- The endpoint catalog is GET ${origin}/api/help. Start by calling GET ${origin}/api/setup/checklist?workspaceId=${state.workspaceId} and work from what it says is open, rather than trusting this list.`,
    '',
    'THE CALLS',
    '- New metric: POST /api/metrics { name, description, value, formula: "", marketRangeMax, timePreference: { enabled: false, halfLife: 1, customHorizons: ["2026-12"] } }',
    '- Another date on an existing metric: PUT /api/metrics/{id} with the full customHorizons list, plus liquidityCredits for what each new market opens with. Rolling entries ("+0w", "+0m", "+1m") re-open each period; an absolute date ("2026-12", "2026-12-31") is one-shot.',
    '- Report the number: PUT /api/metrics/{id} { value, oldValue, updateNote }. This is what markets settle on, so it is the call that matters most.',
    '- Deepen a market: GET /api/predictions/markets to find its id, then POST /api/predictions/markets/{id}/liquidity { amount }.',
    '- How the market is run: PUT /api/workspaces/{id}/settings { description, subjectAbout, charter, visibility, autoFundNewMarkets, newMarketLiquidityCredits, proposalReward }.',
    '',
    'THREE THINGS THAT COST ME MONEY IF YOU GET THEM WRONG',
    '- A metric with no horizon opens no market. Always send timePreference.customHorizons.',
    '- A new market is auto-funded with 0.5 credits by default, which is worse than nothing because it still trades: five credits move such a price across its whole band. A couple of hundred behind a number I actually decide on is a market worth reading.',
    '- Credits bought for liquidity live in a walled wallet and are spent before my tradeable balance. Both are mine, and a market that does not pay out returns what is left to the wallet.',
    '',
    'WHAT I WANT FROM YOU',
    '- Ask me what this market should price, and propose the number yourself rather than asking me to supply it. Say what you would pick and why, and let me correct you.',
    '- Offer to find where each number can be read from, and to keep reporting it on a schedule once we agree one.',
    '- Tell me when a range, a date or a pool is wrong before someone trades on it, because machinery freezes the moment they do.',
    '- Confirm with me before anything that spends credits or makes the market public.',
  );
  return lines.join('\n');
}

/**
 * The same handoff for someone who trades rather than runs the market
 * (owner ask 2026-08-31: the words have to be right for both). Same shape as
 * the owner's, different verbs: what to read, how to price, how to trade, and
 * the one rule that keeps a bot from spending everything on a thin market.
 */
export function traderAgentPrompt(
  origin: string,
  floor: FloorRef,
  grant: KeyGrant,
  workspaceId: string | null,
): string {
  const base = `${origin}/api/marketplace/${floor.idOrSlug}`;
  return [
    `I trade ${floor.name} on Telarchy, where a market prices where the company's real numbers will land. Help me find what is mispriced, and ask me before you spend anything.`,
    '',
    'WHERE IT IS',
    `- The market: ${origin}/${floor.idOrSlug}`,
    `- The whole brief, in one read: GET ${base}/context?format=md`,
    '  It carries the company, every metric with its history, the open markets and their prices, and every contract with what the market says it would do to the number.',
    '',
    'HOW TO ACT AS ME',
    ...grantLine(grant, workspaceId ?? '<the workspace id from the brief>'),
    `- The endpoint catalog is GET ${origin}/api/help. Trading, limit orders and contracts are all in it.`,
    '',
    'THE CALLS',
    '- What is open: GET /api/predictions/markets',
    '- Trade: POST /api/predictions/trade { marketId, direction: "higher" | "lower", amount } where amount is credits, not shares.',
    '- Rest an order instead of taking the price: POST /api/predictions/limit-orders.',
    '- What I hold: GET /api/predictions/positions.',
    '',
    'WHAT I WANT FROM YOU',
    '- Read the brief before you price anything, and say which reading in it makes you think the market is wrong.',
    '- A thin pool moves on almost nothing, so say what the pool is before you tell me a price is wrong.',
    '- Treat the market price as a prediction, not a fact, and tell me when the brief cannot answer something.',
    '- Confirm with me before every trade, with the credits it costs and what it would do to what I hold.',
  ].join('\n');
}
