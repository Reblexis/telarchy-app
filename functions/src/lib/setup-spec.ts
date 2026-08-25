/**
 * What has to be decided before a floor actually works (owner direction
 * 2026-08-22/23).
 *
 * The operator door used to hand over a prompt assembled from a fixed
 * template. A template cannot know that this operator reads their number off
 * a subgraph and that one already runs two floors, so the prompt it produced
 * was generic exactly where it needed to be specific. Otto writes it now
 * (services/setup-handoff.ts), and THIS file is what he writes against: the
 * list of decisions, what counts as settled, and the endpoint that settles it.
 *
 * One list, three readers, which is the point of writing it down once:
 *
 *  - Otto's brief, so he asks about what is still open instead of wandering.
 *  - The handoff prompt, so the operator's own agent is told what remains.
 *  - `GET /api/setup/checklist`, so that agent can ask the API directly rather
 *    than trusting a prompt that may be an hour stale.
 *
 * Ordering is the order they actually block on each other: no floor without a
 * number, no useful number without a way to keep it true, no worthwhile
 * forecast without context, no worthwhile price without liquidity.
 */

export type DecisionId =
  | 'subject'
  | 'number'
  | 'updates'
  | 'context'
  | 'liquidity'
  | 'contracts'
  | 'participation'
  | 'decisions'
  | 'reach';

export interface SetupDecision {
  id: DecisionId;
  /** Tiny label, for a checklist. */
  label: string;
  /** What the operator is actually deciding, in their terms. */
  question: string;
  /** Why it matters, so neither Otto nor their agent presents it as a form
   *  field. This text is given to the model. */
  why: string;
  /** The options worth naming when it has not been decided. */
  options: string[];
  /** How it gets done, for the agent picking this up. */
  api: string;
}

export const SETUP_SPEC: SetupDecision[] = [
  {
    id: 'subject',
    label: 'What you run',
    question: 'What are you running, and what does it do in one line?',
    why: 'The page leads with the company, not the number: a cold visitor arrives from a link about you, not about Telarchy, and cannot read a metric question as a first impression.',
    options: ['A company', 'A project or protocol', 'A personal goal'],
    api: 'POST /api/workspaces { name, template: "blank" }, then PUT /api/workspaces/:id/settings { description }.',
  },
  {
    id: 'number',
    label: 'The number',
    question: 'Which single number do you answer to, what exactly does it count, and how high could it plausibly go?',
    why: 'The description is the settlement text: it is what the market pays out on, so it has to survive an argument with someone who bet against you. The ceiling is the band the market prices inside; too low and it pins at the top, too high and every forecast looks identical. Without a horizon there is no market at all.',
    options: [
      'A number a machine publishes (on-chain, an analytics API, a billing system)',
      'A number your team reports',
    ],
    api: 'POST /api/metrics { name, description, value, formula: "", marketRangeMax, timePreference: { enabled: false, halfLife: 1, customHorizons: ["YYYY-MM"] } } with X-Workspace-Id.',
  },
  {
    id: 'updates',
    label: 'Keeping it true',
    question: 'How does the number get updated, and by whom?',
    why: 'A market on a number nobody updates settles on a stale figure, and traders work that out fast. A number a machine reads is worth more than one a person types, because nobody has to trust the person.',
    options: [
      'By hand, on the market, whenever it moves',
      'By your own agent on a schedule, reading the real source and pushing it',
      'By a Telarchy Source that pulls it for you',
    ],
    api: 'PUT /api/metrics/:id { value, oldValue, updateNote }. To let your own agent do it, in this order: the market must exist and be public or unlisted (POST /api/agents/register needs a workspaceId and answers 404 for a private one); the agent registers ITSELF into that market with POST /api/agents/register { agentId, workspaceId } and keeps its own key, which nobody else ever sees; you promote it with POST /api/workspaces/:id/members { participantId, role: "admin" }, because until then it has only the Public group\'s capabilities and every write answers 403. Sources that pull a value for you: POST /api/sources.',
  },
  {
    id: 'context',
    label: 'What traders see',
    question:
      'What do forecasters and contractors need to know that is not on the page, and how much of it are you willing to publish?',
    why: 'Forecasting a business you cannot see is guessing, and guesses price badly. Everything here is public, so this is a real decision about disclosure rather than a form field: what you share is what the price is worth.',
    options: [
      'A public "what is this" blurb and sources on the market',
      'A charter: what you will do with the price and when you may overrule it',
      'Announcements when something material happens that the market cannot see',
      'Nothing beyond the number, and accept a thinner price',
    ],
    api: 'PUT /api/workspaces/:id/settings { subjectAbout, charter }; POST /api/sources; POST /api/workspaces/:id/announcements.',
  },
  {
    id: 'liquidity',
    label: 'Liquidity',
    question: 'Which question is worth answering well, and how many credits go behind it?',
    why: 'Liquidity is the steering wheel. A deep market costs more to move, so its price means more, and traders go where the subsidy is. The trap is that a thin market still trades: a new one carries 0.5 credits by default, and five credits will move its forecast across most of the band, so it looks like a price and is not one. Spreading one number evenly over every market also says every question matters equally, which is never true.',
    options: [
      'Fund the one number you actually decide on with a couple of hundred credits, leave the rest thin',
      'Auto-fund every new market with a flat amount',
      'Fund nothing and let traders find it themselves',
    ],
    api: 'POST /api/predictions/markets/:id/liquidity { amount } per market; PUT /api/workspaces/:id/settings { autoFundNewMarkets, newMarketLiquidityCredits } for the blanket rule.',
  },
  {
    id: 'contracts',
    label: 'Contracts',
    question:
      'When someone offers to do paid work for you, does its market get funded automatically, or do you decide per contract?',
    why: 'A contract nobody has priced is a contract you are approving on a feeling. Funding every one is simple and wasteful; funding by hand means the good ones sometimes sit unpriced. An agent reading the contract can decide, which is the version that scales without going blind.',
    options: [
      'Auto-fund every contract market with a flat amount',
      'Your agent reads each contract and funds it in proportion to what it is worth to you',
      'You decide by hand on the market',
    ],
    api: 'PUT /api/workspaces/:id/settings { autoFundNewMarkets, newMarketLiquidityCredits }; per contract, GET /api/proposals then POST /api/predictions/markets/:id/liquidity on its conditional pair; POST /api/predictions/markets/liquidity/bulk { amount, proposalId }.',
  },
  {
    id: 'participation',
    label: 'Who can trade',
    question: 'Who is allowed to forecast this, and is the market listed publicly?',
    why: 'An open market gets outside forecasters and the platform pool; a private one gets only the participants you add, which can still be your own agents. A new market starts unlisted, so it is live and shareable by link but not on the front page until a human lists it.',
    options: [
      'Open: anyone can join and trade',
      'Public to read, trading by invitation',
      'Private: only participants you add',
    ],
    api: 'PUT /api/workspaces/:id/settings { visibility }; PUT /api/groups/:id for the Public group capabilities. Ask us to list it on the marketplace.',
  },
  {
    id: 'decisions',
    label: 'Your side of it',
    question: 'What will you actually do with the price, what does a job pay, and who approves?',
    why: 'The mechanism only pays off at the moment a price changes what you do. A market whose owner never approves anything teaches contractors not to bother, and the market thins out. Naming one decision you will put through the market before you make it is the whole commitment.',
    options: [
      'Name one real decision with a date and read the price before making it',
      'Set what a job may pay, and a reward for proposals worth reading',
      'Delegate approval to an agent with manage rights',
    ],
    api: 'PUT /api/workspaces/:id/settings { charter, proposalReward, spamPenalty, maxPendingProposalsPerParticipant }; POST /api/proposals/:id/approve or /decline.',
  },
  {
    id: 'reach',
    label: 'Getting it read',
    question: 'Who is going to trade this on day one?',
    why: 'A market with no traders is a chart. Whoever already cares about your number (your community, your team, agents you run) is the cheapest first liquidity there is, and a prize season gives them a reason to show up.',
    options: [
      'Point your own community at the market',
      'Run your own participant agents on it',
      'Rely on the platform pool and the season',
    ],
    api: 'Share https://telarchy.com/{slug}. Participants self-join with POST /api/marketplace/:id/join when the market is open.',
  },
];

export const DECISION_IDS: DecisionId[] = SETUP_SPEC.map(d => d.id);

/** Keep only ids this build knows. The spec state round-trips through the
 *  browser, so an unknown id is either a stale tab or someone trying to write
 *  their own instructions into the model's context. Neither gets through. */
export function sanitiseDecisionIds(raw: unknown): DecisionId[] {
  if (!Array.isArray(raw)) return [];
  const known = new Set<string>(DECISION_IDS);
  const out: DecisionId[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && known.has(v) && !out.includes(v as DecisionId)) out.push(v as DecisionId);
  }
  return out;
}

/** The spec as the model sees it: one block per decision, with what settles
 *  it. Trimmed of the api line for the conversational brief, where Otto does
 *  not need endpoints, and kept for the handoff, where the other agent does. */
export function renderSpec(opts: { withApi: boolean }): string {
  return SETUP_SPEC.map(d => {
    const lines = [`### ${d.id} - ${d.label}`, d.question, `Why: ${d.why}`];
    if (d.options.length) lines.push(`Usual answers: ${d.options.join(' | ')}`);
    if (opts.withApi) lines.push(`How: ${d.api}`);
    return lines.join('\n');
  }).join('\n\n');
}
