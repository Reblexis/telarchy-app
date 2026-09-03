import type { TimePreference } from '../types';
import { BASE_PATH, withBase } from './base-path';
import { pickCurrentSeason } from './season-clock';

/** A guide category, served by GET /api/guides/_categories. */
export interface GuideCategory {
  id: string;
  title: string;
  description: string;
}

/** One entry of the guide index served by GET /api/guides. */
export interface GuideSection {
  id: string;
  title: string;
  description: string;
  category: string;
  order: number;
  path: string;
}

export interface ActivityItem {
  id: string;
  type: string;
  timestamp: string;
  actor: { id: string; label: string } | null;
  marketId?: string;
  metricId?: string;
  proposalId?: string;
  data: Record<string, unknown>;
}

export interface AgentHeartbeat {
  agentId: string;
  status: string;
  workspaceId: string | null;
  workspaceName: string | null;
  strategy: string | null;
  lastCycleStartedAt: string | null;
  lastCycleEndedAt: string | null;
  nextCycleAt: string | null;
  pollIntervalSeconds: number;
  workspacesVisited: number;
  lastTraded: number;
  lastSkipped: number;
  lastErrors: number;
  lastError: string | null;
  balance: number | null;
  updatedAt: string;
}

/** Desired-state row for an out-of-process agent runner (see /agents). */
export interface AgentControl {
  agentId: string;
  desiredState: 'enabled' | 'paused';
  triggerRequestedAt: string | null;
  triggerAckedAt: string | null;
  updatedAt: string;
}

export interface AgentTraceEntry {
  marketId: string;
  metric: string;
  targetDate: string;
  rangeMin: number;
  rangeMax: number;
  consensus: number;
  estimate: number;
  confidence: number;
  distance: number;
  threshold: number;
  reasoning: string;
  outcome: string;
  cost?: number;
  resultingConsensus?: number;
  error?: string;
}

export interface AgentTrace {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  agentId: string;
  strategy: string;
  startedAt: string;
  endedAt: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  candidates: number;
  traded: number;
  skipped: number;
  errors: number;
  costUsd: number;
  entries: AgentTraceEntry[];
  createdAt: string;
}

/**
 * A resting instruction to buy while the market sits at or beyond a price.
 * `limitValue` is in the metric's own units (dollars here), never probability.
 */
/**
 * Structured payment details; mirrors functions/src/lib/payout.ts.
 *
 * Keep the crypto member in step with CRYPTO_NETWORKS / CRYPTO_ASSETS there.
 * It drifted once (2026-08-15): the server had grown four EVM chains and a
 * required `asset`, this type still said three networks and no asset, and the
 * mismatch was invisible only because AccountDialog cast its payload through
 * `as unknown as PayoutMethod`. A component that switches on `network` would
 * then fall through for a stored 'base'. Cast nothing into this type; if a
 * payload does not fit, this type is what is wrong.
 */
export type CryptoNetwork = 'ethereum' | 'base' | 'arbitrum' | 'optimism' | 'polygon' | 'solana' | 'bitcoin';

export type PayoutMethod = (
  | { provider: 'paypal'; email: string }
  | { provider: 'bank'; iban: string; holder: string }
  | {
      provider: 'crypto';
      network: CryptoNetwork;
      asset: string;
      address: string;
    }
  | { provider: 'revolut'; handle: string }
  | { provider: 'wise'; email: string }
  | { provider: 'other'; details: string }
) & {
  /** Free text the payer should read when sending (bank reference, exchange
   *  memo or destination tag). Optional on every provider. */
  note?: string;
};

/**
 * One thing that happened to this participant (GET /api/notifications).
 * `kind` says what: someone commented on a proposal they posted, someone
 * replied in a thread they are in, a new proposal went on a ballot where they
 * trade, or one of their own proposals was decided.
 */
export interface NotificationItem {
  id: string;
  /** `stale` is the one the matrix does not govern: a market of yours is
   *  about to settle on a reading nobody took in the period it settles for
   *  (docs/guides/sources.md). */
  kind: 'comment' | 'reply' | 'contract' | 'anyComment' | 'settled' | 'decision' | 'stale';
  at: string;
  actor: string | null;
  subject: string;
  detail: string;
  workspaceSlug: string | null;
  proposalId: string | null;
  marketId: string | null;
  /** The comment it is about, when it is about one: the floor scrolls to it. */
  commentId: string | null;
  unread: boolean;
}

export interface NotificationsPayload {
  unread: number;
  seenAt: string | null;
  notifications: NotificationItem[];
}

/**
 * Which emails a participant gets (docs/vision.md, "Participant email
 * notifications"). Mirrors the three switches on the participant row; read
 * from GET /api/agents/me and GET /api/auth/me, written through
 * POST /api/auth/profile.
 */
export interface NotificationPrefs {
  /** Someone commented under a proposal you posted. On for a new account. */
  commentOnMyProposal: boolean;
  /** Someone else commented in a thread you are in. On for a new account. */
  replyToMyComment: boolean;
  /** Every new proposal on a workspace you belong to. Off until asked for. */
  newProposal: boolean;
  /** Every comment anywhere on a workspace you belong to. Off until asked for. */
  anyComment: boolean;
  /** A market you traded settled, with its value. On for a new account. */
  marketResolved: boolean;
  /** A proposal you traded or commented on was approved or declined. On for
   *  a new account. The proposer's own decision mail has no switch. */
  contractDecided: boolean;
}

/** One kind of notification, each deliverable over three channels (owner ask
 *  2026-08-24). Web is the bell, mobile is a browser push. */
export type NotificationKindId = 'comment' | 'reply' | 'contract' | 'anyComment' | 'settled' | 'decision';
export type NotificationChannel = 'web' | 'email' | 'mobile';
/** The resolved matrix GET /api/auth/me serves: every cell, defaults applied. */
export type NotificationMatrix = Record<NotificationKindId, Record<NotificationChannel, boolean>>;
/** A partial update: only the cells being flipped. */
export type NotificationMatrixUpdate = Partial<
  Record<NotificationKindId, Partial<Record<NotificationChannel, boolean>>>
>;

/** A bug report, help request, or feature idea (POST /api/feedback).
 *  Mirrors the row in functions/src/routes/feedback.ts. */
export interface FeedbackItem {
  id: string;
  kind: string;
  subject: string;
  body: string;
  status: string;
  email: string | null;
  url: string | null;
  agentId: string | null;
  workspaceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LimitOrder {
  id: string;
  marketId: string;
  agentId: string;
  direction: 'higher' | 'lower';
  limitValue: number;
  budgetCredits: number;
  filledCredits: number;
  remainingCredits: number;
  status: 'open' | 'filled' | 'cancelled' | 'expired' | 'voided';
  expiresAt: string | null;
  createdAt: string;
}

/** One way to receive free credits, and what the operator prices it at.
 *  `kind` is 'flat' (grants exactly `credits`) or 'cap' (grants up to it
 *  from a measured signal, which is how the Manifold import works). */
export interface EarnRule {
  key: string;
  label: string;
  credits: number;
  /** Walled pool credits this earn grants beside the trading ones, for a
   *  floor of your own (docs/agent-economy.md). Absent on an instance that
   *  has not migrated. */
  liquidityCredits?: number;
  /** `flat` a one-time grant, `cap` an "up to", `daily` the streak, `open`
   *  an earn with no ceiling (trading profit). Only flat and cap carry a
   *  number the reader can finish, so only they count toward the tally. */
  kind: 'flat' | 'cap' | 'daily' | 'open';
  enabled?: boolean;
  note: string;
  updatedAt?: string;
}

/** Where the viewer's trade-a-day run stands. */
export interface DailyStreak {
  days: number;
  earnedToday: boolean;
  todayCredits: number;
  nextCredits: number;
}

/** An earn rule with the viewer's own state on it. */
export interface MyEarnRule extends EarnRule {
  claimed: boolean;
}

/** One rung of a prize season's published ladder. */
export interface LadderRung {
  place: number;
  prizeUsd: number;
}

/**
 * A prize season: a bounded cash tournament over the trading board.
 *
 * `status` is draft (parameters still editable, standings read empty),
 * running (baselines pinned, entry open, standings computed live) or settled
 * (finals frozen, ladder assigned, standings read stored values).
 */
export interface PrizeSeason {
  id: string;
  name: string;
  status: 'draft' | 'running' | 'settled';
  startsAt: string;
  endsAt: string;
  settledAt: string | null;
  poolUsd: number;
  /** 'proportional' splits the pool by positive settled score; 'ladder' pays
   *  the published rungs by place (Season 0's original shape). */
  payoutMode: 'ladder' | 'proportional';
  /** Proportional only: a computed share below this is not paid. */
  minPayoutUsd: number;
  /** Seasons after Season 0: public-workspace operators take no payout and
   *  entries sharing a payout handle collapse to one. */
  strictEligibility: boolean;
  /** Empty for a proportional season. */
  ladder: LadderRung[];
  rulesUrl: string;
  /** Pinned workspaces that are no longer public, and so no longer counted in
   *  a public response. Present on running standings only. */
  workspacesDropped?: number;
}

/** One entrant's row in a season's standings. `score` is growth in marked
 *  profit since the season started, NOT lifetime profit. */
export interface SeasonStanding {
  rank: number;
  id: string;
  nickname: string | null;
  image?: string | null;
  manifoldUsername?: string | null;
  /** null while the season is a draft: no baseline exists, so no score does. */
  score: number | null;
  /** Settled seasons only. */
  prizeUsd?: number;
  /** Running seasons: what this standing would pay if it settled now. */
  projectedPrizeUsd?: number;
  /** Running seasons: the same score with every market that still resolves
   *  inside the season valued at its current call, and what the pool would
   *  pay on that. Display only, never the rank; null on a draft (no window
   *  yet) and on a settled season (the finals are frozen). */
  markedScore?: number | null;
  markedProjectedPrizeUsd?: number | null;
  claimState?: 'unclaimed' | 'claimed' | 'expired' | 'paid' | null;
}

/** This participant's relationship to the running season. */
export interface MySeasonEntry {
  season: PrizeSeason | null;
  optedIn: boolean;
  canEnter: boolean;
  /** Whether payment details are on the account. NOT required to enter: it is
   *  reported so the season page can mention that a prize will need somewhere
   *  to go, as a nudge rather than a gate. Winners are asked at claim time. */
  hasPayoutMethod?: boolean;
  /** When this participant agreed to the season rules, or null. Someone who
   *  has already agreed is not asked again on a rejoin. */
  rulesAcceptedAt?: string | null;
  /** Where a winner is told they have won. Asked at entry, because an
   *  API-registered participant has no email anywhere else. */
  contactEmail?: string | null;
  /** When they confirmed they are 18 or older, as the rules require. */
  confirmedOver18At?: string | null;
  /** The account's own email, for prefilling. Null for API participants. */
  accountEmail?: string | null;
}

export interface LeaderboardEntry {
  /** In the current prize season. */
  seasonEntered?: boolean;
  /** What they would win if the season settled now; null before it starts,
   *  because no baselines exist yet and a 0 would read as "wins nothing"
   *  rather than "not decided yet". */
  seasonPrizeUsd?: number | null;
  rank: number | null;
  id: string;
  nickname: string | null;
  /** Account picture, for the rail avatar. */
  image?: string | null;
  /** Manifold username if this trader imported a record. */
  manifoldUsername?: string | null;
  calibration: number | null;
  accuracy: number | null;
  totalEarnings: number;
  /** The final part of totalEarnings (resolutions and refunds, minus the cash
   *  paid on those markets). Absent on a season row, whose number is a
   *  difference of two marks rather than a sum of settlements. */
  settledEarnings?: number;
  /** The still-a-mark part: totalEarnings - settledEarnings. */
  openEarnings?: number;
  resolvedMarkets: number;
  totalTrades: number;
  lastTradeAt: string | null;
}

export interface PublicProfilePosition {
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  proposalId: string | null;
  metricName: string | null;
  targetDate: string | null;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
  status: 'open' | 'conditional' | 'closed' | 'resolved';
  probabilityHigher: number | null;
  consensus: number | null;
  actualValue: number | null;
}

export interface PublicProfileTrade {
  id: string;
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  proposalId: string | null;
  metricName: string | null;
  targetDate: string | null;
  /** Null for a redemption: both sides leave the book at once. */
  direction: 'higher' | 'lower' | null;
  /** 'redeem' is the automatic par redemption of matched pairs, not something
   *  the participant placed; it is one row, both ledger sides summed. */
  kind: 'buy' | 'sell' | 'redeem';
  shares: number;
  cost: number;
  createdAt: string;
}

export interface ProfileProposedJob {
  id: string;
  workspaceId: string;
  title: string;
  askUsd: number | null;
  status: string;
  createdAt: string;
}

export interface PublicParticipantProfile {
  id: string;
  nickname: string | null;
  /** The participant's account picture (data URL or provider image), null
   *  if none set. */
  image: string | null;
  /** Their Manifold username if they imported a Manifold record. */
  manifoldUsername: string | null;
  intent: string | null;
  /** Freeform public description: who this participant is and what it is in
   *  Telarchy to do. Set via POST /api/auth/profile (max 500 chars). */
  bio: string | null;
  joinedAt: string;
  /** The participant that created this one via POST /api/agents with an
   *  agent key; null for humans and self-registered bots. */
  parent: { id: string; nickname: string | null } | null;
  /** Participants this one created the same way (its sub-agents). */
  children: Array<{ id: string; nickname: string | null }>;
  stats: {
    rank: number | null;
    calibration: number | null;
    accuracy: number | null;
    totalEarnings: number;
    settledEarnings: number;
    openEarnings: number;
    resolvedMarkets: number;
    totalTrades: number;
    lastTradeAt: string | null;
  };
  activeWorkspaces: Array<{ id: string; name: string }>;
  openPositions: PublicProfilePosition[];
  recentTrades: PublicProfileTrade[];
  /** Jobs this participant proposed on public boards, newest first. */
  proposedJobs: ProfileProposedJob[];
  /** Daily balance snapshots (credits) plus a live "now" point. Snapshots are
   *  written by the hourly resolve cron, one per UTC day. */
  balanceHistory: Array<{ at: string; balance: number }>;
  /** Cumulative realized PnL over time: per resolved market, net trade cash +
   *  resolution payout at resolvedAt. Viewer-scoped like openPositions. */
  pnlHistory: Array<{ at: string; cumulative: number }>;
}

export interface MarketplaceListing {
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  metricName: string;
  targetDate: string;
  consensus: number | null;
  probability: number;
  /** LMSR sensitivity, b = pool / ln 2. Price maths only, never a credit
   *  figure on screen: see `pool` for what was actually paid in. */
  liquidity: number;
  /** Credits in the pool. */
  pool?: number;
  /** Present on /api/marketplace/featured; absent on other marketplace endpoints. */
  tradedVolume?: number;
  rangeMin: number;
  rangeMax: number;
}

export interface ProposalStats {
  total: number;
  approved: number;
  declined: number;
  declinedSpam: number;
  withdrawn: number;
  pending: number;
}

/**
 * What a logged-out visitor sees at /marketplace/:workspaceId. Deliberately
 * counts, not contents: metric names and market consensus are public, but
 * logged metric values, proposal text, and chat still require membership.
 */
export interface PublicWorkspace {
  workspaceId: string;
  name: string;
  slug: string | null;
  ownerId: string | null;
  /** Equal to ownerId when the owner never set a nickname; do not print a raw
   *  participant id as if it were a name. */
  ownerHandle: string | null;
  description: string | null;
  /** The owner's public commitment about what they will do with the number. */
  charter: string | null;
  /** Owner-authored "What is <name>?" blurb for the floor (free text; null =
   *  the floor's built-in default copy is shown). Owner-editable. */
  subjectAbout?: string | null;
  /** When the owner says this workspace started running on Telarchy (ISO), or
      null. The floor's year chart marks it with one dashed line. */
  telarchyStartedOn?: string | null;
  visibility: string;
  proposalReward: number;
  spamPenalty: number;
  /** What pressing join actually grants, per the Public group's capabilities. */
  joinAs: 'trader' | 'viewer';
  /** The platform signup grant, so the page can say what you start with. */
  signupCredits: number;
  metricCount: number;
  openMarketCount: number;
  participantCount: number;
  proposalStats: ProposalStats;
  markets: PublicWorkspaceMarket[];
  /** The ballot: present only when the workspace's Public group grants read
   *  (an Open workspace, where contents are one free self-join away anyway). */
  proposals?: PublicProposal[];
  decided?: PublicDecidedProposal[];
  /** Participants ranked by real USD earned from approved jobs. */
  topContractors?: PublicContractor[];
  /** Hero-metric logged history (oldest first), the evidence a forecaster
   *  prices against. Same Open-workspace disclosure rule as the ballot. */
  heroHistory?: Array<{ at: string; value: number }>;
  /** The metric's own description: the owner's provenance statement. */
  heroMetricDescription?: string | null;
  /** The hero metric's id, so a manager can edit that description in place.
      Editing it voids and reopens the metric's open markets (it is the
      settlement text), which the edit UI must say out loud. */
  heroMetricId?: string | null;
  tradesThisWeek?: number;
  /** The market's call after each trade of the hero market (the amber line). */
  marketHistory?: Array<{ at: string; consensus: number | null }>;
  /** Which market `marketHistory` is the replay OF. Never plot a series on a
      market that did not produce it: keyed by position, the weekly view drew
      the yearly market's prices (owner report 2026-08-17). */
  marketHistoryMarketId?: string;
  /** Each open horizon's own metric history, so a two-clock workspace can
      draw one actual-vs-forecast chart per horizon (2026-08-15). */
  horizonHistories?: Array<{
    marketId: string;
    metricName: string;
    targetDate: string;
    /** First moment of the settled period; the chart's x-axis opens here. */
    periodStart?: string;
    /** Last moment of the period, which is not the settlement instant when the
     *  metric carries a reporting lag. */
    periodEnd?: string;
    /** The period this metric restarts on, or null when it never does. Set,
        `points` carries only readings from inside this market's own period. */
    resetsEvery?: string | null;
    /** The metric voids its markets (N/A) while it has no reading at all. */
    resolvesNaUntilMeasured?: boolean;
    /** Whether any reading exists; never inferred from `points`. */
    measured?: boolean;
    description: string | null;
    points: Array<{ at: string | null; value: number }>;
  }>;
  /** The owner's most recent announcement, inline so the first paint shows it
      without a second request; null when the workspace has never published
      one. The rest come from `getWorkspaceAnnouncements`. */
  latestAnnouncement?: Announcement | null;
  /** How many announcements exist in total, so the floor can offer the rest. */
  announcementCount?: number;
}

/** One owner announcement on a public floor. Append-only by construction: an
 *  edit keeps `originalBody` and stamps `editedAt` instead of overwriting, and
 *  nothing deletes one. Render both timestamps and the original when
 *  `editedAt` is set; the record is only worth something if a reader can see
 *  it was changed. */
export interface Announcement {
  id: string;
  /** Markdown. */
  body: string;
  /** Server-side publish instant; never chosen by the publisher. */
  publishedAt: string;
  editedAt: string | null;
  /** The body exactly as first published, once the row has been edited. */
  originalBody: string | null;
  /** Nickname of the publishing participant when it is not the workspace
   *  owner; null when the owner published it. Print it: a delegate's words
   *  must never read as the owner's. */
  publishedBy: string | null;
}

export interface PublicProposalMarketPair {
  metricId?: string;
  metricName: string;
  targetDate: string;
  resolvesOn: string;
  approvedConsensus: number | null;
  declinedConsensus: number | null;
  /** approved minus declined consensus: the priced causal impact of approving. */
  delta: number | null;
  /** The approved branch's id and price shape, so a client can make the
   *  conditional market its main view and trade it directly. */
  approvedMarketId: string | null;
  declinedMarketId: string | null;
  approvedProbability: number | null;
  approvedLiquidity: number | null;
  /** The declined branch's price shape too: saying no is also a world, and
   *  the page lets you bet in it. Null probability = unpriced (liquidity 0). */
  declinedProbability: number | null;
  declinedLiquidity: number | null;
  /** What each branch says about itself, the same three the baseline prints
   *  (docs/ui-conventions.md, "What a market says about itself"): credits in
   *  the pool, distinct traders, credits traded. Per branch, because the two
   *  worlds are two separate books. Null while a branch has no market, which
   *  is not the same as a market nobody has touched (zero). */
  approvedPool: number | null;
  declinedPool: number | null;
  approvedTraders: number | null;
  declinedTraders: number | null;
  approvedVolume: number | null;
  declinedVolume: number | null;
  rangeMin: number;
  rangeMax: number;
}

export interface PublicProposal {
  id: string;
  title: string;
  description: string;
  /** The job's price in whole USD, stored rather than parsed from the title
   *  (it feeds burn inside the resolving metric). Null on proposals that
   *  predate the field. */
  askUsd?: number | null;
  /** Job lifecycle: on the ballot, or decided (the owner picked a branch). */
  status?: 'pending' | 'approved' | 'declined';
  resolvedAt?: string | null;
  declineReason?: string | null;
  proposedByName: string | null;
  /** Resolvable segment for /participants/:id (participant id; the page
   *  also resolves nicknames). */
  proposedByHandle?: string;
  createdAt: string;
  /** When this proposal's words or price were last edited, null if never.
   *  The marker is public; the log itself is GET /api/proposals/:id/revisions
   *  (docs/market-integrity.md, I1b). */
  editedAt?: string | null;
  /** Total conditional pairs; equals `markets.length` since 2026-08-26, when
   *  the payload started shipping every pair of the metric x date grid. */
  marketPairCount: number;
  markets: PublicProposalMarketPair[];
}

export interface PublicDecidedProposal {
  id: string;
  title: string;
  status: 'approved' | 'declined';
  askUsd: number | null;
  proposedByName: string | null;
  proposedByHandle: string | null;
  resolvedAt: string | null;
  declineReason: string | null;
}

/** A participant ranked by real USD earned from approved jobs. */
/** A job poster on the floor's second rail, ranked by what the market says
 *  their jobs are worth now (owner direction 2026-08-14), not by dollars
 *  collected. See `docs/ui-conventions.md`. */
export interface PublicContractor {
  id: string;
  name: string | null;
  /** Summed priced impact of the poster's live jobs, in the hero metric's
   *  unit, signed. null when the workspace has no hero market to price
   *  against, in which case the rail falls back to dollars. */
  impact: number | null;
  /** Live jobs (pending + approved); declined and withdrawn ones score zero. */
  jobs: number;
  pendingJobs: number;
  /** How many live jobs the market has actually priced. */
  pricedJobs: number;
  /** Dollars from approved jobs, the row's second line. */
  earnedUsd: number;
}

/** A market row on the public workspace page. No workspace fields: the page
 *  already knows which workspace it is showing. */
export interface PublicWorkspaceMarket {
  marketId: string;
  metricId: string;
  metricName: string;
  /** The metric's display order (POST /api/metrics/reorder): the headline
   *  tie-breaker between two metrics read on the same date, and the order the
   *  floor's metric stepper walks. Absent on an older payload. */
  metricOrder?: number | null;
  targetDate: string;
  resolvesOn: string;
  consensus: number | null;
  probability: number;
  /** LMSR sensitivity, b = pool / ln 2. Price maths only, never a credit
   *  figure on screen: see `pool`. */
  liquidity: number;
  /** Credits in the pool: what the owner and everyone else paid in. */
  pool?: number;
  /** Distinct participants who have traded this market. */
  traderCount?: number;
  /** Credits traded on this market over its life. */
  tradedVolume?: number;
  rangeMin: number;
  rangeMax: number;
}

/** The data room's feed (docs/data-room.md). One anonymous read carries the
 *  prose and every figure on the page, so the page cannot show a number the
 *  response does not carry. A term that could not be computed is null, never
 *  zero. */
export type DataRoomBlock = 'pulse' | 'funnel' | 'traction' | 'contracts' | 'traffic' | 'shipping';

export interface DataRoomFeed {
  schema: number;
  generatedAt: string;
  doc: {
    updatedAt: string;
    sections: Array<{
      id: string;
      title: string;
      markdown: string;
      blocks: DataRoomBlock[];
    }>;
  };
  evidence: {
    pulse: {
      weeklyActiveVerifiedTraders: number;
      participants: number;
      openMarkets: number;
      tradesThisWeek: number;
      source: string;
    };
    /** The chain that ends in the floor's metric. It replaced the `market`
     *  block on 2026-08-31: the page publishes no price and no settle date,
     *  because a reader arriving from the floor already has both. */
    funnel: {
      steps: Array<{
        id: string;
        n: number;
        /** Share of the step above. Null on the first step, and on any step
         *  whose predecessor is zero: 0/0 is not published as a percentage. */
        shareOfAbove: number | null;
      }>;
      /** The day the visit rollup starts, so the page can say the first
       *  conversion is not a cohort. */
      loadsSince: string | null;
    };
    traction: {
      participants: number;
      accounts: number;
      verifiedParticipants: number;
      trades: number;
      creditsTraded: number;
      openMarkets: number;
      settledMarkets: number;
      publicFloors: number;
      signupsByDay: Array<{ day: string; signups: number }>;
    };
    contracts: {
      proposed: number;
      approved: number;
      declined: number;
      pending: number;
      withdrawn: number;
      approvedUsd: number;
    };
    traffic: {
      byDay: Array<{ day: string; visits: number; uniques: number }>;
      keptSince: string | null;
      visits24h: number;
      uniques24h: number;
      visits7d: number;
      uniques7d: number;
      totalVisits: number;
    };
    shipping: {
      days: Array<{ date: string; changes: number }>;
      changes: Array<{ date: string; subject: string }>;
      total: number;
      builtAt: string;
    };
  };
}

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * GET with a short retry on transient unavailability (502/503/504) and on a
 * network throw. Cloud Run can briefly return 503 while a container is warming
 * (a cold start, or the moment a new revision takes over), and a first-time
 * visitor hitting a public page during that window should not see a hard
 * error. Backs off ~250ms, ~600ms; anything else (4xx, a real 5xx that
 * persists) returns as-is for the caller to handle.
 */
async function fetchGetWithRetry(url: string, attempts = 3): Promise<Response> {
  const delays = [250, 600];
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.status !== 503 && res.status !== 502 && res.status !== 504) return res;
      lastErr = new Error(`transient ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delays[i] ?? 600));
  }
  // Out of retries: do one final plain fetch so the caller sees the real status.
  try {
    return await fetch(url);
  } catch {
    throw lastErr;
  }
}

let activeWorkspaceId: string | null = localStorage.getItem('activeWorkspaceId');

async function _agentRequest(path: string, apiKey: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': apiKey,
      ...(options.headers as Record<string, string>),
    },
  });
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API unavailable (${res.status}). Ensure Cloud Functions are deployed.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

const activeWorkspaceListeners = new Set<() => void>();

export function setActiveWorkspace(id: string | null): void {
  if (id === activeWorkspaceId) return;
  activeWorkspaceId = id;
  if (id === null) {
    localStorage.removeItem('activeWorkspaceId');
  } else {
    localStorage.setItem('activeWorkspaceId', id);
  }
  // Notify subscribers (useWorkspace instances) so the sidebar and any other
  // workspace-aware UI refetch for the new workspace without a full page reload.
  // Guarded by the no-op early-return above so re-setting the same id (e.g. the
  // profile echo inside the fetch) cannot cause a refetch loop.
  activeWorkspaceListeners.forEach(l => {
    try {
      l();
    } catch (e) {
      console.error('active-workspace listener failed', e);
    }
  });
}

/** The last-used / URL-driven active workspace id. Used to upgrade flat routes
 *  (/metrics) to the namespaced /{ownerHandle}/{slug}/metrics form. */

/** Subscribe to active-workspace changes. Returns an unsubscribe function. */

/**
 * Fired after any successful mutating API call. Mutations are how credits
 * move (trades, liquidity top-ups, proposal subsidies, rewards), so listeners
 * (the sidebar balance counter) refetch instead of waiting for a route
 * change. Deliberately coarse: one cheap GET /agents/me per mutation burst
 * beats enumerating every spend endpoint and missing one.
 */
const mutationListeners = new Set<() => void>();
export function onApiMutation(cb: () => void): () => void {
  mutationListeners.add(cb);
  return () => {
    mutationListeners.delete(cb);
  };
}

function notifyMutation() {
  for (const cb of mutationListeners) {
    try {
      cb();
    } catch (err) {
      console.error('onApiMutation listener failed', err);
    }
  }
}

async function request(path: string, options: RequestInit = {}, skipWorkspaceHeader = false) {
  return requestWithWorkspace(path, options, { skipWorkspaceHeader });
}

type RequestWorkspaceOptions = {
  skipWorkspaceHeader?: boolean;
  workspaceId?: string;
};

let consentRecoveryInFlight: Promise<void> | null = null;

async function recoverConsent(): Promise<void> {
  if (!consentRecoveryInFlight) {
    consentRecoveryInFlight = fetch(`${API_BASE}/api/auth/consent`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true }),
    })
      .then(res => {
        sessionStorage.removeItem('pendingConsent');
        if (!res.ok) throw new Error(`Consent recovery failed: ${res.status}`);
      })
      .finally(() => {
        consentRecoveryInFlight = null;
      });
  }
  return consentRecoveryInFlight;
}

async function requestWithWorkspace(
  path: string,
  options: RequestInit = {},
  requestOptions: RequestWorkspaceOptions = {},
  retryAfterConsent = true,
) {
  const { skipWorkspaceHeader = false, workspaceId } = requestOptions;
  const effectiveWorkspaceId = skipWorkspaceHeader ? null : (workspaceId ?? activeWorkspaceId);
  const wsHeader: Record<string, string> = effectiveWorkspaceId ? { 'X-Workspace-Id': effectiveWorkspaceId } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...wsHeader,
      ...(options.headers as Record<string, string>),
    },
  });
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API unavailable (${res.status}). Ensure Cloud Functions are deployed.`);
  }
  const data = await res.json();
  if (res.status === 403 && data?.needsConsent && retryAfterConsent && path !== '/api/auth/consent') {
    await recoverConsent();
    return requestWithWorkspace(path, options, requestOptions, false);
  }
  if (!res.ok) throw new Error(data.error || 'API error');
  if ((options.method ?? 'GET') !== 'GET') notifyMutation();
  return data;
}

/**
 * Normalize a running-season standing into the shape the trader rail and
 * /leaderboard already render, so the season board reuses one rendering path
 * (owner decision 2026-08-22: the floor becomes the season board). The season
 * SCORE takes the `totalEarnings` slot the row prints, the projected payout
 * takes the prize slot, and `seasonEntered` is true because a season standing
 * is by definition an entrant. `totalTrades` is set to 1 so the rail's
 * "drop never-traded rows" filter keeps every entrant: on the season board,
 * entering IS the qualification, not a trade count. The all-time-only fields
 * (calibration, accuracy, resolvedMarkets, lastTradeAt) have no meaning per
 * season and are left null/zero; the season header tells the reader the
 * number is a season score, and callers hide the trades sub-line in that mode.
 */
export function seasonStandingToEntry(s: SeasonStanding): LeaderboardEntry {
  return {
    rank: s.rank,
    id: s.id,
    nickname: s.nickname,
    image: s.image ?? null,
    manifoldUsername: s.manifoldUsername ?? null,
    calibration: null,
    accuracy: null,
    totalEarnings: s.score ?? 0,
    resolvedMarkets: 0,
    totalTrades: 1,
    lastTradeAt: null,
    seasonEntered: true,
    seasonPrizeUsd: s.projectedPrizeUsd ?? s.prizeUsd ?? 0,
  };
}

/** A visitor journey as the cockpit reads it (docs/ui-conventions.md). */
export interface Journey {
  id: string;
  ip: string;
  userAgent: string | null;
  country: string | null;
  /** The FIRST hit's referer: which channel delivered them. */
  referer: string | null;
  startedAt: string;
  entryPath: string;
  exitPath: string;
  durationSeconds: number;
  bounced: boolean;
  steps: Array<{ path: string; ts: string; secondsOnPage: number | null }>;
}

export interface JourneyFeed {
  summary: {
    journeys: number;
    bounced: number;
    visitors: number;
    medianSteps: number;
  };
  topExits: Array<{ path: string; journeys: number }>;
  journeys: Journey[];
}

/** One row of `GET /api/agents/mine`: an agent you own, and how it is doing. */
export interface MyAgent {
  id: string;
  nickname: string | null;
  bio: string | null;
  /** Credits it has left. */
  balance: number;
  /** Trading profit marked to market, the same number the leaderboard ranks
   *  on. Zero for a bot that has never traded, which is most of them. */
  earned: number;
  settledEarnings: number;
  openEarnings: number;
  totalTrades: number;
  lastTradeAt: string | null;
  /** Set when this agent IS the signed-in human rather than a bot they own. */
  authUserId: string | null;
  ownerUserId: string | null;
  ownerAgentId: string | null;
}

export interface XPost {
  id: string;
  author: string;
  authorName: string;
  text: string;
  likes: number;
  replies: number;
  createdAt: string | null;
}

export interface XSearch {
  id: string;
  query: string;
  rationale: string | null;
  harvested: number;
  lastUsedAt: string | null;
  createdAt: string;
  /** Present on the yield view: replies sent from this search and what they earned. */
  replies?: number;
  likes?: number;
}

export interface XReply {
  id: string;
  /** 'reply' to someone's post, or 'post', one of his own. */
  kind: 'reply' | 'post';
  sourcePostId: string | null;
  sourceAuthor: string | null;
  sourceText: string | null;
  text: string;
  replyId: string | null;
  likes: number | null;
  replies: number | null;
  metricsAt: string | null;
  hasNumber: boolean;
  disagrees: boolean;
  length: number;
  createdAt: string;
}

export type XSummary =
  | { enough: false; note: string }
  | {
      enough: true;
      median: number;
      anyEngagement: number;
      features: { label: string; on: number; off: number }[];
    };

export const api = {
  getMetrics: () => request('/api/metrics'),
  /** Create a metric on a floor the caller manages (docs/owner-on-the-floor.md,
   *  dialog 1). Name and description only: value starts at 0, range defaults
   *  and is correctable until the first trade, and the date comes next.
   *  timePreference is EXPLICITLY null: omitted, the server defaults the decay
   *  curve on and markets open before the owner ever picked a date. */
  createMetricIn: (
    workspaceId: string,
    body: { name: string; description: string },
  ): Promise<{ ok: boolean; id: string; warnings?: string[] }> =>
    requestWithWorkspace(
      '/api/metrics',
      {
        method: 'POST',
        body: JSON.stringify({
          ...body,
          value: 0,
          formula: '',
          timePreference: null,
        }),
      },
      { workspaceId },
    ),
  /** One metric, with its stored timePreference. The floor's "+ date" control
   *  needs the STORED horizons, not the dates of the markets on screen: a
   *  curve-generated date written back as a custom horizon would freeze it. */
  getMetric: (
    workspaceId: string,
    id: string,
  ): Promise<{
    id: string;
    name: string;
    timePreference?: TimePreference | null;
  }> => requestWithWorkspace(`/api/metrics/${id}`, {}, { workspaceId }),
  createMetric: (body: {
    name: string;
    description: string;
    value: number;
    formula: string;
    timePreference?: TimePreference;
    marketRangeMax?: number;
  }) => request('/api/metrics', { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (
    id: string,
    body: {
      name: string;
      description: string;
      value: number;
      formula: string;
      oldValue: number;
      updateNote: string;
      timePreference?: TimePreference | null;
      marketRangeMax?: number;
    },
  ) =>
    request(`/api/metrics/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  /** Report a new reading (docs/owner-on-the-floor.md, dialog 4). `oldValue`
   *  is what the route needs to write the public `updates` row; `updateNote`
   *  is the owner's optional sentence, and the route defaults it to "Value
   *  updated" when empty. `marketRangeMax` rides along only on a first
   *  reading, while no market has traded and the range is still movable. */
  reportMetricValue: (
    workspaceId: string,
    id: string,
    body: {
      value: number;
      oldValue: number;
      updateNote?: string;
      marketRangeMax?: number;
      /** The moment this reading describes, when it is not now: a September
       *  total typed in October is dated into September, which is how a market
       *  with a reporting lag settles on it (docs/guides/sources.md). */
      asOf?: string;
      /** The number does not exist for that moment, which is not zero. The
       *  market whose fixing lands on it voids as N/A and refunds. */
      na?: boolean;
    },
  ) => requestWithWorkspace(`/api/metrics/${id}`, { method: 'PUT', body: JSON.stringify(body) }, { workspaceId }),
  /** Partial metric update. The full-object `updateMetric` is for the editor;
   *  the floor's owner controls change one field at a time and must not
   *  resend the rest (docs/owner-on-the-floor.md). */
  patchMetric: (
    workspaceId: string,
    id: string,
    body: {
      liquidityCredits?: number | null;
      timePreference?: TimePreference | null;
      /** How long after a period this number is final. New markets settle that
       *  far after their period end; open ones keep the instant they opened
       *  with. */
      settlementLagMinutes?: number;
    },
  ) => requestWithWorkspace(`/api/metrics/${id}`, { method: 'PUT', body: JSON.stringify(body) }, { workspaceId }),
  deleteMetric: (id: string) => request(`/api/metrics/${id}`, { method: 'DELETE' }),
  reorderMetrics: (ids: string[]) =>
    request('/api/metrics/reorder', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  getMetricLogs: (metricId: string) => request(`/api/metrics/${metricId}/logs`),
  getUpdates: (limit?: number) => request(`/api/updates${limit ? `?limit=${limit}` : ''}`),
  getStatus: () => request('/api/status'),

  // Agents
  getParticipant: () => request('/api/agents/me'),
  /** The earn table: every way to receive free credits and its price.
   *  Public, because a contest whose grants decide standings owes its
   *  entrants a readable price list. */
  getEarnTable: (): Promise<{ rules: EarnRule[] }> => request('/api/earn'),
  /** The same list with the viewer's own state on it. */
  getMyEarn: (): Promise<{
    earned: number;
    available: number;
    streak: DailyStreak | null;
    rules: MyEarnRule[];
  }> => request('/api/earn/me'),
  /** Pay for any attached provider account not yet paid for. Safe to
   *  re-run: it reconciles against the accounts actually linked. */
  syncEarnLinks: (): Promise<{
    granted: number;
    paid: string[];
    takenElsewhere: string[];
  }> => request('/api/earn/links/sync', { method: 'POST' }),
  /** The operator's view: disabled rows and the last-changed stamp too. */
  getAdminEarnTable: (): Promise<{ rules: EarnRule[] }> => request('/api/admin/earn'),
  /** Re-price one task. Takes effect on the next grant and is appended to
   *  the rule's history, which is what makes a mid-season change
   *  reconstructable. */
  setEarnRule: (
    key: string,
    patch: {
      credits?: number;
      liquidityCredits?: number;
      enabled?: boolean;
      note?: string;
    },
  ): Promise<{ rule: EarnRule }> =>
    request(`/api/admin/earn/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  /** Start a liquidity-credits purchase (the second currency): returns the
   *  Stripe Checkout url to send the buyer to. Manage capability in the
   *  workspace required; 503 while the instance has no Stripe config. */
  /** What this floor has bought, newest first (docs/liquidity-purchases.md).
   *  Manage on the workspace; the page that renders it is /{floor}/funding. */
  getLiquidityPurchases: (
    workspaceId: string,
  ): Promise<{
    purchases: Array<{
      id: string;
      usdAmount: number;
      credits: number;
      creditsPerUsd: number;
      status: string;
      allocation: Record<string, number> | null;
      createdAt: string;
      completedAt: string | null;
    }>;
  }> =>
    requestWithWorkspace(`/api/workspaces/${encodeURIComponent(workspaceId)}/liquidity/purchases`, {}, { workspaceId }),
  buyLiquidityCredits: (workspaceId: string, usdAmount: number): Promise<{ url: string; credits: number }> =>
    request(`/api/workspaces/${encodeURIComponent(workspaceId)}/liquidity/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usdAmount }),
    }),
  getAgents: () => request('/api/agents'),
  getAgentTrades: (agentId: string, limit = 100) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/trades?limit=${limit}`),
  getAgentMarketPnl: (agentId: string) => request(`/api/agents/${encodeURIComponent(agentId)}/market-pnl`),
  /** The caller's own participant plus every bot they own, each with what it
   *  has earned beside what it has left. `earned` is the leaderboard's own
   *  number, so a bot's private row and its public rank cannot disagree. */
  getMyAgents: (): Promise<MyAgent[]> => request('/api/agents/mine'),
  /** Move credits from the caller to another participant. Strictly
   *  self-initiated by the API: you can fund a bot, and a bot has to send its
   *  own credits back. */
  transferCredits: (toAgent: string, amount: number, memo?: string) =>
    request('/api/agents/transfer', {
      method: 'POST',
      body: JSON.stringify({ toAgent, amount, memo }),
    }),
  registerAgent: (agentId: string) =>
    request('/api/agents/register', {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    }),
  spendAgent: (id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, {
      method: 'POST',
      body: JSON.stringify({ amount, type, reason }),
    }),
  getTreasury: () => request('/api/agents/treasury', {}, true),
  /** No auth — same treasury address as minted deposits use; 503 if server has no treasury key. */
  getDepositAddress: () =>
    request('/api/agents/deposit-address', {}, true) as Promise<{
      address: string;
      chain: string;
      asset: string;
      usdcContract: string;
    }>,
  depositForMe: (txHash: string) =>
    request('/api/agents/me/deposit', {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),
  depositForAgent: (agentId: string, txHash: string) =>
    request(`/api/agents/${agentId}/deposit`, {
      method: 'POST',
      body: JSON.stringify({ txHash }),
    }),
  withdrawFromMe: (amount: number) =>
    request('/api/agents/me/withdraw', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  withdrawFromAgent: (agentId: string, amount: number) =>
    request(`/api/agents/${agentId}/withdraw`, {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),
  setMyWallet: (walletAddress: string) =>
    request('/api/agents/me/wallet', {
      method: 'PUT',
      body: JSON.stringify({ walletAddress }),
    }),
  setAgentWallet: (agentId: string, walletAddress: string) =>
    request(`/api/agents/${agentId}/wallet`, {
      method: 'PUT',
      body: JSON.stringify({ walletAddress }),
    }),

  // Markets & Trading
  getMarkets: (
    proposalId?: string,
    workspaceId?: string,
    opts?: {
      status?: 'open' | 'closed' | 'resolved' | 'voided' | 'all';
      includeResolved?: boolean;
      includeVoided?: boolean;
      kind?: 'baseline' | 'conditional' | 'all';
    },
  ) => {
    const params = new URLSearchParams();
    if (proposalId) params.set('proposalId', proposalId);
    if (opts?.status) params.set('status', opts.status);
    if (opts?.includeResolved) params.set('includeResolved', 'true');
    if (opts?.includeVoided) params.set('includeVoided', 'true');
    if (opts?.kind && opts.kind !== 'baseline') params.set('kind', opts.kind);
    const qs = params.toString() ? `?${params}` : '';
    return requestWithWorkspace(`/api/predictions/markets${qs}`, {}, { workspaceId });
  },
  getMarketDetail: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}`, {}, { workspaceId }),
  getMarketTrades: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/trades`, {}, { workspaceId }),
  getMarketLiquidityEvents: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/liquidity-events`, {}, { workspaceId }),
  getMarketPositions: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/positions`, {}, { workspaceId }),
  createMarket: (metricId: string, targetDate: string) =>
    request('/api/predictions/markets', {
      method: 'POST',
      body: JSON.stringify({ metricId, targetDate }),
    }),
  deleteMarket: (id: string) => request(`/api/predictions/markets/${id}`, { method: 'DELETE' }),
  refreshMarkets: (proposalId?: string) =>
    request('/api/predictions/markets/refresh', {
      method: 'POST',
      body: JSON.stringify(proposalId ? { proposalId } : {}),
    }),
  resolvePredictions: (targetDate?: string) =>
    request('/api/predictions/resolve', {
      method: 'POST',
      body: JSON.stringify({ targetDate }),
    }),
  trade: (body: Record<string, unknown>, workspaceId?: string) =>
    requestWithWorkspace('/api/predictions/trade', { method: 'POST', body: JSON.stringify(body) }, { workspaceId }),
  // Description-only metric update (PUT accepts partial bodies). Changing the
  // description voids and recreates the metric's open markets server-side:
  // it is the settlement text, so callers must warn before saving.
  updateMetricDescription: (id: string, description: string, workspaceId?: string) =>
    requestWithWorkspace(
      `/api/metrics/${id}`,
      { method: 'PUT', body: JSON.stringify({ description }) },
      { workspaceId },
    ),
  getPositions: (marketId?: string, agentId?: string, workspaceId?: string) => {
    const params = new URLSearchParams();
    if (marketId) params.set('marketId', marketId);
    if (agentId) params.set('agentId', agentId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestWithWorkspace(`/api/predictions/positions${qs}`, {}, { workspaceId });
  },
  /** Resting orders. `limitValue` is in the metric's own units, not
      probability, because that is what the page shows. See docs/limit-orders.md. */
  placeLimitOrder: (
    body: {
      marketId: string;
      direction: 'higher' | 'lower';
      limitValue: number;
      budgetCredits: number;
      expiresAt?: string;
    },
    workspaceId?: string,
  ) =>
    requestWithWorkspace(
      '/api/predictions/limit-orders',
      { method: 'POST', body: JSON.stringify(body) },
      { workspaceId },
    ),
  getLimitOrders: (marketId?: string, workspaceId?: string): Promise<LimitOrder[]> => {
    const qs = marketId ? `?marketId=${encodeURIComponent(marketId)}` : '';
    return requestWithWorkspace(`/api/predictions/limit-orders${qs}`, {}, { workspaceId }) as Promise<LimitOrder[]>;
  },
  cancelLimitOrder: (id: string, workspaceId?: string) =>
    requestWithWorkspace(
      `/api/predictions/limit-orders/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      { workspaceId },
    ),

  /** workspaceId is passed when the caller is on a floor rather than in the
   *  active workspace, which is every owner control on the floor itself. */
  injectLiquidity: (marketId: string, amount: number, workspaceId?: string) =>
    requestWithWorkspace(
      `/api/predictions/markets/${marketId}/liquidity`,
      { method: 'POST', body: JSON.stringify({ amount }) },
      { workspaceId },
    ),
  injectLiquidityBulk: (amount: number, proposalId?: string) =>
    request('/api/predictions/markets/liquidity/bulk', {
      method: 'POST',
      body: JSON.stringify({ amount, ...(proposalId && { proposalId }) }),
    }),

  // Proposals
  getProposals: (status?: string) => request(`/api/proposals${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getProposal: (id: string) => request(`/api/proposals/${id}`),
  createProposal: (body: {
    title: string;
    description: string;
    liquiditySubsidy?: number;
    askUsd?: number;
    payoutHandle?: string;
  }) => request('/api/proposals', { method: 'POST', body: JSON.stringify(body) }),
  /** Edit a proposal's definition: words and price both, published as
   *  revisions; a traded pair keeps its markets and positions untouched
   *  (docs/market-integrity.md, I1b). The proposer or a workspace manager;
   *  the server decides which. */
  /** What is published and what is waiting (platform admin only). */
  getRelease: () =>
    request('/api/admin/release') as Promise<{
      serving: string | null;
      candidate: { revision: string; url: string } | null;
      /** Branch previews, newest first; the stripe's picker lists them. */
      previews: Array<{ tag: string; revision: string; url: string }>;
      running: string | null;
      runningTags: string[];
      isServing: boolean;
      error: string | null;
    }>,
  /** Every branch of the repository and whether it is built as a preview
   *  (docs/infra/deploy.md, "Any branch can be built"). Platform admin only. */
  getBranches: () =>
    request('/api/admin/branches') as Promise<{
      branches: Array<{
        name: string;
        sha: string;
        tag: string | null;
        built: boolean;
      }>;
      error: string | null;
      buildConfigured: boolean;
    }>,
  /** Ask CI to build a branch as a preview. 501 names the terminal command
   *  when the instance holds no GitHub token. */
  buildBranch: (branch: string) =>
    request('/api/admin/branches/build', {
      method: 'POST',
      body: JSON.stringify({ branch }),
    }) as Promise<{
      ok: true;
      tag: string;
    }>,
  /** Give the revision answering this request 100% of the traffic. Pressed on
   *  the beta, so it publishes the build you are looking at. */
  publishRelease: () => request('/api/admin/publish', { method: 'POST', body: JSON.stringify({}) }),

  // The X workbench (docs/x-workbench.md). Platform admin only; every call
  // goes through this module, like every other call the UI makes.
  xLookupPost: (url: string): Promise<{ post: XPost }> =>
    request('/api/admin/x/lookup', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  xDraftReply: (input: {
    postId?: string;
    postAuthor?: string;
    postText: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ draft: { reply: string; reason: string; answer: string } }> =>
    request('/api/admin/x/draft', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** A post of his own from an idea, through the same argument (docs/x-workbench.md,
   *  "Writing his own post"). */
  xDraftPost: (input: {
    idea: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ draft: { post: string; reason: string; answer: string } }> =>
    request('/api/admin/x/compose', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  xRecordReply: (input: {
    kind?: 'reply' | 'post';
    sourcePostId?: string;
    sourceAuthor?: string;
    sourceText?: string;
    text: string;
    replyId?: string;
    searchId?: string;
  }): Promise<{ recorded: XReply }> =>
    request('/api/admin/x/record', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  xAttachReplyId: (id: string, replyId: string): Promise<{ recorded: XReply }> =>
    request(`/api/admin/x/record/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ replyId }),
    }),
  xLog: (): Promise<{
    replies: XReply[];
    summary: XSummary;
    draftingConfigured: boolean;
  }> => request('/api/admin/x/log'),
  xSuggestSearch: (
    avoid: string[] = [],
    messages: { role: 'user' | 'assistant'; content: string }[] = [],
  ): Promise<{
    suggestion: { query: string; rationale: string; answer: string };
  }> =>
    request('/api/admin/x/searches/suggest', {
      method: 'POST',
      body: JSON.stringify({ avoid, messages }),
    }),
  xSaveSearch: (query: string, rationale?: string): Promise<{ search: XSearch }> =>
    request('/api/admin/x/searches', {
      method: 'POST',
      body: JSON.stringify({ query, rationale }),
    }),
  xSearches: (): Promise<{ searches: XSearch[] }> => request('/api/admin/x/searches'),
  xHarvestSearch: (id: string, ids: string): Promise<{ posts: XPost[]; failed: string[] }> =>
    request(`/api/admin/x/searches/${encodeURIComponent(id)}/harvest`, {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  xGetVoiceProfile: (): Promise<{
    profile: string;
    draftingConfigured: boolean;
  }> => request('/api/admin/x/profile'),
  xSetVoiceProfile: (profile: string): Promise<{ ok: boolean }> =>
    request('/api/admin/x/profile', {
      method: 'PUT',
      body: JSON.stringify({ profile }),
    }),
  editProposal: (id: string, body: { title?: string; description?: string; askUsd?: number | null }) =>
    request(`/api/proposals/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  /** What changed on a proposal, oldest first. */
  getProposalRevisions: (id: string) =>
    request(`/api/proposals/${id}/revisions`) as Promise<{
      revisions: Array<{
        field: string;
        oldValue: string | null;
        newValue: string | null;
        at: string;
      }>;
    }>,
  approveProposal: (id: string) => request(`/api/proposals/${id}/approve`, { method: 'POST' }),
  /** `declineReason` is published permanently on the proposal. Required by the
   *  backend when the workspace has a charter, since that is the promise. */
  /** Admin: take a job off the board entirely (refunds every stake first). */
  removeProposal: (id: string) => request(`/api/proposals/${id}`, { method: 'DELETE' }),
  declineProposal: (id: string, declineReason?: string, refund?: boolean) =>
    request(`/api/proposals/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify({
        declineReason: declineReason?.trim() || null,
        refund: refund === true,
      }),
    }),
  getProposalMessages: (id: string) => request(`/api/proposals/${id}/messages`),
  sendProposalMessage: (id: string, content: string) =>
    request(`/api/proposals/${id}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  /** Public floor read: the thread under a market or a proposal, no
      account needed (Open workspaces only). */
  /** Ask to be told when workspace creation opens. `source` is the door it
   *  came through (a floor's slug, "marketplace", "waitlist"), which is how
   *  /admin tells one channel from another. 409 means already listed, which
   *  from the visitor's side is success, so it resolves rather than throws. */
  joinWaitlist: async (body: { email: string; source?: string }): Promise<{ alreadyListed: boolean }> => {
    const res = await fetch(`${API_BASE}/api/waitlist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 409) throw new Error((data as { error?: string }).error || 'Something went wrong');
    return { alreadyListed: res.status === 409 };
  },

  /** Guide categories, in render order, with the titles the index groups by.
   *  Built for this page: the index carries a category id, not its title. */
  getGuideCategories: async (): Promise<GuideCategory[]> => {
    const res = await fetch(`${API_BASE}/api/guides/_categories`);
    if (!res.ok) throw new Error(`Guide categories: ${res.status}`);
    return res.json();
  },

  /** The guide index: what /guides renders, in the order the API returns. */
  getGuides: async (): Promise<GuideSection[]> => {
    const res = await fetch(`${API_BASE}/api/guides`);
    if (!res.ok) throw new Error(`Guides: ${res.status}`);
    return res.json();
  },

  /** One guide section, as the markdown the API serves. */
  getGuide: async (section: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/guides/${section}`);
    if (!res.ok) throw new Error(`Guide ${section}: ${res.status}`);
    return res.text();
  },

  /** A legal document (terms, privacy, a season's rules) as markdown. */
  getLegalDocument: async (document: string): Promise<string> => {
    const res = await fetch(`${API_BASE}/api/legal/${document}`);
    if (!res.ok) throw new Error(`Legal ${document}: ${res.status}`);
    return res.text();
  },

  /** Name the account to link on any record provider, and get the
   *  one-time code that proves it (docs/record-links.md). */
  startRecordLink: (provider: string, handle: string): Promise<{ code: string; handle: string; proofField: string }> =>
    request(`/api/import/${encodeURIComponent(provider)}/start`, {
      method: 'POST',
      body: JSON.stringify({ handle }),
    }),

  /** Finish it once the code is on the profile. */
  /** `granted` is 0 when the record does not qualify for the grant, or the
   *  participant or the external account has already been paid; `why`
   *  says which. The link is made either way. */
  claimRecordLink: (provider: string): Promise<{ handle: string; granted: number; why?: string }> =>
    request(`/api/import/${encodeURIComponent(provider)}/claim`, {
      method: 'POST',
    }),

  /** The handful of flags a page needs before it knows who is looking:
   *  which store this build reads, and whether signups are open. */
  /** `preview` is the `br-` tag of the branch preview that answered, or null
   *  on the candidate and the published site (docs/infra/deploy.md). */
  getPublicConfig: (): Promise<{ store?: string; preview?: string | null }> => request('/api/public-config'),

  /** The served index.html, for the stale-tab check: a tab compares the
   *  bundle the server references now with the one it is running. Not an API
   *  call, but it is HTTP, and HTTP lives in this module. */
  getServedIndexHtml: async (): Promise<string> => {
    const res = await fetch(withBase('/'), { cache: 'no-store' });
    if (!res.ok) throw new Error(`index: ${res.status}`);
    return res.text();
  },

  /** The data room's whole page, prose and figures, in one anonymous read.
   *  The page renders this response and nothing else (docs/data-room.md). */
  getDataRoom: (): Promise<DataRoomFeed> => request('/api/data-room'),

  /** Admin launch dashboard: floor visits, signups, waitlist. */
  getFloorStats: () => request('/api/admin/floor-stats'),

  /** One visitor's ordered path through the site, per sitting, for every
   *  anonymous visitor in the log's 30-day window. Platform admin only;
   *  the rules are docs/ui-conventions.md, "Journeys". */
  getJourneys: (): Promise<JourneyFeed> => request('/api/admin/journeys'),

  /** Who to pay and where. Platform admin only; see routes/admin.ts. */
  findParticipants: (q: string) =>
    request(`/api/admin/participants?q=${encodeURIComponent(q)}`) as Promise<{
      participants: Array<{
        id: string;
        nickname: string | null;
        email: string | null;
        payoutHandle: string | null;
        payoutMethod: Record<string, unknown> | null;
        walletAddress: string | null;
        platformOperated: boolean;
        createdAt: string;
        approvedUsd: number;
        approvedContracts: Array<{
          title: string;
          askUsd: number;
          approvedAt: string | null;
        }>;
      }>;
    }>,
  /** Every question asked of a floor, newest first, with its answer. */
  getFloorQuestions: (
    limit = 100,
  ): Promise<{
    totalCostUsd: number;
    questions: Array<{
      id: string;
      workspaceId: string;
      slug: string | null;
      workspaceName: string | null;
      question: string;
      answer: string;
      askedBy: string | null;
      askedByName: string | null;
      country: string | null;
      costUsd: number | null;
      model: string | null;
      error: string | null;
      createdAt: string;
    }>;
  }> => request(`/api/admin/questions?limit=${limit}`),
  /** Bug reports, help requests and feature ideas (platform admin only).
   *  The same endpoint an operator would curl; /admin renders it. */
  getFeedback: (opts: { limit?: number; kind?: string; status?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.kind) q.set('kind', opts.kind);
    if (opts.status) q.set('status', opts.status);
    const qs = q.toString();
    return request(`/api/feedback${qs ? `?${qs}` : ''}`) as Promise<{
      items: FeedbackItem[];
    }>;
  },

  getFloorComments: (
    idOrSlug: string,
    q: { marketId?: string; proposalId?: string },
  ): Promise<Array<{ id: string; fromName: string; content: string; createdAt: string }>> =>
    request(
      `/api/marketplace/${encodeURIComponent(idOrSlug)}/comments?${q.proposalId ? `proposalId=${encodeURIComponent(q.proposalId)}` : `marketId=${encodeURIComponent(q.marketId ?? '')}`}`,
      {},
      true,
    ),

  /** Talk to Otto, the floor's market maker. The whole conversation goes with
      every turn (the server keeps the last twelve), so a follow-up means
      something. What he knows is the floor's public brief and nothing else. */
  askFloor: (
    idOrSlug: string,
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ answer: string }> =>
    request(
      `/api/marketplace/${encodeURIComponent(idOrSlug)}/ask`,
      {
        method: 'POST',
        body: JSON.stringify({ messages }),
      },
      true,
    ),

  /** Otto on the operator door: the setup conversation for someone who does
   *  not have a floor yet (the operator-door design note). Same shape as askFloor,
   *  no workspace. `opened` is any floor that came into existence during the
   *  turn, read back from the API rather than parsed out of his answer. */
  askSetup: (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    /** What earlier turns settled, so Otto stops asking about it. Round-trips
     *  through the browser and is filtered server-side to ids the spec knows. */
    settled: string[] = [],
  ): Promise<{
    answer: string;
    opened: Array<{ id?: string; name: string; slug: string | null }>;
    /** The prompt for the caller's own agent: written by Otto against the
     *  setup specification, with every id checked against the database before
     *  it is allowed out (functions/src/services/setup-handoff.ts). */
    /** The floor's real state, when a floor exists. */
    checklist: {
      blocking: string[];
      /** Enough of the market to draw it: the page's hero is the instrument. */
      market: {
        metricName: string;
        rangeMin: number;
        rangeMax: number;
        targetDate: string;
        consensus: number | null;
        pool: number;
      } | null;
      items: Array<{
        id: string;
        label: string;
        status: 'done' | 'open';
        note: string;
      }>;
    } | null;
  }> => request('/api/setup/ask', { method: 'POST', body: JSON.stringify({ messages, settled }) }, true),

  /**
   * The same conversation, arriving as Otto writes it (owner direction
   * 2026-08-24: "so i dont have to wait"). `onDelta` fires per fragment of
   * prose; the promise resolves with the payload askSetup returns, carried by
   * the trailing frame.
   *
   * Falls back to the whole-answer response when the server did not stream,
   * so the door works either way rather than working better and sometimes
   * not at all.
   */
  askSetupStream: async (
    messages: Array<{ role: 'user' | 'assistant'; content: string }>,
    settled: string[],
    onDelta: (text: string) => void,
  ) => {
    /**
     * The beta cannot stream until a build that can stream is PUBLISHED.
     *
     * /beta is served by proxying the published revision to the candidate, so
     * the proxy doing the forwarding is the published one: today it buffers
     * the whole response and gives up at twenty seconds, which turns a
     * streamed answer into a 503 (seen 2026-08-24). The fix ships in the same
     * build as streaming itself and only takes effect once that build is
     * live, which is the ordinary bootstrap for anything on that path.
     *
     * So on the beta, ask for a whole answer. Remove this the first time a
     * published build contains the streaming proxy; production streams now.
     */
    const proxied = BASE_PATH === '/beta';
    const res = await fetch(`${API_BASE}/api/setup/ask`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(proxied ? {} : { Accept: 'text/event-stream' }),
      },
      body: JSON.stringify({ messages, settled }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || `Could not reach Otto (${res.status})`);
    }
    if (!res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) {
      return await res.json();
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: unknown = null;
    let failure: string | null = null;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Frames are separated by a blank line and can span reads.
      let cut = buffer.indexOf('\n\n');
      for (; cut >= 0; cut = buffer.indexOf('\n\n')) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!data) continue;
        try {
          if (event === 'delta') onDelta((JSON.parse(data) as { text: string }).text);
          else if (event === 'done') final = JSON.parse(data);
          else if (event === 'failed') failure = (JSON.parse(data) as { error: string }).error;
        } catch (e) {
          console.error('setup stream frame failed:', e);
        }
      }
    }

    if (failure) throw new Error(failure);
    // A stream that ends without its trailing frame has given the reader
    // prose and nothing else: no handoff, no checklist, no idea whether a
    // market was opened. Saying so beats leaving the page confidently wrong.
    if (!final) throw new Error('Otto stopped mid-answer. Ask again.');
    return final;
  },

  /**
   * The prompt for the caller's own agent, asked for once the answer is on
   * screen. It is a second model call, and it used to ride along with the
   * answer, which made a turn as slow as both calls together and pushed it
   * past the deadline the beta proxy gives up at.
   */
  askSetupHandoff: (messages: Array<{ role: 'user' | 'assistant'; content: string }>, settled: string[] = []) =>
    request(
      '/api/setup/handoff',
      {
        method: 'POST',
        body: JSON.stringify({ messages, settled }),
      },
      true,
    ) as Promise<{
      handoff: string;
      settled: string[];
      open: string[];
      written: boolean;
    }>,

  /** What is still open on a floor, read from the database. The endpoint the
   *  handoff prompt tells an operator's own agent to call first. */
  setupChecklist: (workspaceId: string) =>
    request(`/api/setup/checklist?workspaceId=${encodeURIComponent(workspaceId)}`, {}, true) as Promise<{
      workspace: {
        id: string;
        name: string;
        slug: string | null;
        visibility: string;
      } | null;
      items: Array<{
        id: string;
        label: string;
        question: string;
        why: string;
        options: string[];
        api: string;
        status: 'done' | 'open';
        note: string;
      }>;
      blocking: string[];
    }>,

  /** Public floor read: who holds what and the trade history for a
      market, no account needed (Open workspaces only). */
  getMarketActivity: (
    idOrSlug: string,
    marketId: string,
  ): Promise<{
    consensus: number | null;
    positions: Array<{
      handle: string;
      id: string;
      direction: 'higher' | 'lower';
      shares: number;
      cost: number;
      worth: number | null;
    }>;
    trades: Array<{
      id: string;
      handle: string;
      direction: 'higher' | 'lower';
      kind: 'buy' | 'sell';
      shares: number;
      cost: number;
      createdAt: string;
    }>;
    /** The pool moving: opened with, or deepened by, and the depth after.
     *  Shown in the same list as the trades (docs/ui-conventions.md). */
    pool: Array<{
      id: string;
      /** Null on the platform's own initial liquidity, which has no funder. */
      handle: string | null;
      kind: 'opened' | 'deepened';
      amount: number;
      pool: number;
      createdAt: string;
    }>;
  }> =>
    request(
      `/api/marketplace/${encodeURIComponent(idOrSlug)}/market-activity?marketId=${encodeURIComponent(marketId)}`,
      {},
      true,
    ),

  getMarketMessages: (marketId: string) => request(`/api/predictions/markets/${encodeURIComponent(marketId)}/messages`),
  sendMarketMessage: (marketId: string, content: string) =>
    request(`/api/predictions/markets/${encodeURIComponent(marketId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  getHooksStatus: (): Promise<{
    active: boolean;
    lastPolledAt?: string;
    intervalMs?: number;
    nextPollAt?: string;
  }> => request('/api/events/hooks/status'),

  // Member-friendly workspace activity feed (requires `read` capability).
  // Hides deposits/withdrawals and anonymizes trade actors for non-admins.
  getActivity: (
    params: {
      since?: string;
      until?: string;
      limit?: number;
      types?: string[];
    },
    workspaceId?: string,
  ): Promise<{
    activities: ActivityItem[];
    supportedTypes: string[];
    nextCursor: string;
  }> => {
    const q = new URLSearchParams();
    if (params.since) q.set('since', params.since);
    if (params.until) q.set('until', params.until);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.types?.length) q.set('types', params.types.join(','));
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/activity${qs}`, {}, { workspaceId });
  },

  // Admin activity feed (workspace-scoped; requires `manage` capability)
  getAdminActivity: (
    params: {
      since?: string;
      until?: string;
      limit?: number;
      types?: string[];
      participantId?: string;
      marketId?: string;
      metricId?: string;
      proposalId?: string;
    },
    workspaceId?: string,
  ): Promise<{
    activities: ActivityItem[];
    supportedTypes: string[];
    nextCursor: string;
  }> => {
    const q = new URLSearchParams();
    if (params.since) q.set('since', params.since);
    if (params.until) q.set('until', params.until);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.types?.length) q.set('types', params.types.join(','));
    if (params.participantId) q.set('participantId', params.participantId);
    if (params.marketId) q.set('marketId', params.marketId);
    if (params.metricId) q.set('metricId', params.metricId);
    if (params.proposalId) q.set('proposalId', params.proposalId);
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/admin/activity${qs}`, {}, { workspaceId });
  },

  // Agent telemetry (heartbeats + decision traces; requires `manage`)
  getAgentHeartbeats: (workspaceId?: string): Promise<{ heartbeats: AgentHeartbeat[]; isPlatformAdmin?: boolean }> =>
    requestWithWorkspace('/api/admin/agent-heartbeats', {}, { workspaceId }),

  getAgentTraces: (
    params: {
      agentId?: string;
      since?: string;
      limit?: number;
      scopeWorkspaceId?: string | 'all';
    },
    workspaceId?: string,
  ): Promise<{
    traces: AgentTrace[];
    scope?: string;
    isPlatformAdmin?: boolean;
  }> => {
    const q = new URLSearchParams();
    if (params.agentId) q.set('agentId', params.agentId);
    if (params.since) q.set('since', params.since);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.scopeWorkspaceId) q.set('workspaceId', params.scopeWorkspaceId);
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/admin/agent-traces${qs}`, {}, { workspaceId });
  },

  // Agent control plane (platform admin / master key; see /agents)
  getAgentControls: (): Promise<{ controls: AgentControl[] }> => request('/api/admin/agent-controls'),

  setAgentControl: (params: {
    agentId: string;
    desiredState?: 'enabled' | 'paused';
    trigger?: boolean;
  }): Promise<AgentControl> =>
    request('/api/admin/agent-control', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  // Marketplace (public, no auth)
  getStats: async (): Promise<{
    marketsActive: number;
    agentsActive: number;
    tradesThisWeek: number;
  }> => {
    const res = await fetch(`${API_BASE}/api/marketplace/stats`);
    if (!res.ok) throw new Error(`Stats request failed: ${res.status}`);
    return res.json();
  },
  getMarketplace: async (limit = 50): Promise<MarketplaceListing[]> => {
    const res = await fetch(`${API_BASE}/api/marketplace?limit=${limit}`);
    if (!res.ok) throw new Error(`Marketplace request failed: ${res.status}`);
    return res.json();
  },
  getMarketplaceWorkspace: async (workspaceId: string): Promise<PublicWorkspace> => {
    const res = await fetchGetWithRetry(`${API_BASE}/api/marketplace/${encodeURIComponent(workspaceId)}`);
    if (!res.ok) throw new Error(`Marketplace workspace request failed: ${res.status}`);
    return res.json();
  },
  getPublicWorkspaces: async (): Promise<
    Array<{
      workspaceId: string;
      name: string;
      visibility: string;
      slug?: string | null;
      description?: string | null;
      openMarketCount?: number;
      proposalStats?: { pending?: number };
    }>
  > => {
    const res = await fetch(`${API_BASE}/api/marketplace/workspaces/public`);
    if (!res.ok) throw new Error(`Public workspaces request failed: ${res.status}`);
    return res.json();
  },
  getFeaturedMarkets: async (): Promise<MarketplaceListing[]> => {
    const res = await fetch(`${API_BASE}/api/marketplace/featured`);
    if (!res.ok) throw new Error(`Featured markets request failed: ${res.status}`);
    return res.json();
  },
  /** Every prize season, newest first. Public. */
  getSeasons: async (): Promise<{ seasons: PrizeSeason[] }> => {
    const res = await fetch(`${API_BASE}/api/seasons`);
    if (!res.ok) throw new Error(`Seasons request failed: ${res.status}`);
    return res.json();
  },
  /**
   * Standings for one season: the same board, scored as growth since the
   * season's baseline. Deliberately the leaderboard endpoint rather than a
   * season-specific one, so a standings row and a leaderboard row can never
   * disagree about the same participant.
   */
  getSeasonStandings: async (
    seasonId: string,
    limit = 100,
  ): Promise<{ season: PrizeSeason; participants: SeasonStanding[] }> => {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}&seasonId=${encodeURIComponent(seasonId)}`);
    if (!res.ok) throw new Error(`Season standings request failed: ${res.status}`);
    return res.json();
  },
  /** This participant's entry state for the running season. */
  getMySeason: async (): Promise<MySeasonEntry> => {
    const res = await fetch(`${API_BASE}/api/seasons/me`, {
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`Season entry request failed: ${res.status}`);
    return res.json();
  },
  /**
   * Enter or leave the season.
   *
   * Entering requires `acceptedRules`, `confirmedOver18` and a `contactEmail`
   * we can reach a winner on. No payment details: those are asked at claim
   * time. A refusal carries `reason` ('rules' | 'age' | 'contactEmail') so the
   * caller can point at the missing field rather than showing a message and
   * hoping. Leaving requires nothing at all.
   */
  setMySeasonEntry: async (
    optedIn: boolean,
    opts: {
      acceptedRules?: boolean;
      confirmedOver18?: boolean;
      contactEmail?: string;
    } = {},
  ): Promise<{ optedIn: boolean }> => {
    const res = await fetch(`${API_BASE}/api/seasons/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        optedIn,
        acceptedRules: opts.acceptedRules === true,
        confirmedOver18: opts.confirmedOver18 === true,
        contactEmail: opts.contactEmail,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error ?? `Season entry update failed: ${res.status}`) as Error & { reason?: string };
      err.reason = body.reason;
      throw err;
    }
    return body;
  },
  /** Claim a prize on a settled season. Needs payment details on the account
   *  first; the error says so when they are missing. */
  claimSeasonPrize: async (seasonId: string): Promise<{ claimed: boolean; prizeUsd: number; claimBy: string }> => {
    const res = await fetch(`${API_BASE}/api/seasons/${encodeURIComponent(seasonId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: '{}',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error ?? `Claim failed: ${res.status}`);
    return body;
  },
  /** Traders ranked by trading profit at current market prices. Pass a
   *  workspace id or slug to rank within that one public workspace, which is
   *  what a floor's own rail shows; omit it for the cross-workspace board. */
  getLeaderboard: async (limit = 100, workspaceIdOrSlug?: string): Promise<{ participants: LeaderboardEntry[] }> => {
    const scope = workspaceIdOrSlug ? `&workspaceId=${encodeURIComponent(workspaceIdOrSlug)}` : '';
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}${scope}`);
    if (!res.ok) throw new Error(`Leaderboard request failed: ${res.status}`);
    return res.json();
  },
  /**
   * What the floor's trader board should show RIGHT NOW (owner decision
   * 2026-08-22: "become the season board"). While a season is running the
   * board IS the competition: the season standings, ranked by season score
   * (growth since baseline), entrants only, over every public workspace.
   * With no running season it is the all-time board as before, scoped to the
   * workspace if one is named.
   *
   * One function answers "which board", so the floor rail and /leaderboard
   * can never disagree about whether a season is on. Returns the season it
   * decided on so the caller can label the header without a second fetch.
   */
  getFloorLeaders: async (
    limit = 100,
    workspaceIdOrSlug?: string,
  ): Promise<{
    participants: LeaderboardEntry[];
    seasonMode: boolean;
    season: PrizeSeason | null;
  }> => {
    const { seasons } = await api.getSeasons();
    const season = pickCurrentSeason(seasons);
    if (season?.status === 'running') {
      const { participants } = await api.getSeasonStandings(season.id, limit);
      return {
        participants: participants.map(seasonStandingToEntry),
        seasonMode: true,
        season,
      };
    }
    const { participants } = await api.getLeaderboard(limit, workspaceIdOrSlug);
    return { participants, seasonMode: false, season };
  },
  /** One market's consensus history on a public workspace: the series the
   *  chart draws, addressable per market so a proposal's conditional branch
   *  can become the page's main view. */
  getPublicMarketHistory: async (
    workspaceIdOrSlug: string,
    marketId: string,
  ): Promise<Array<{ at: string; consensus: number | null }>> => {
    const res = await fetch(
      `${API_BASE}/api/marketplace/${encodeURIComponent(workspaceIdOrSlug)}/markets/${encodeURIComponent(marketId)}/history`,
    );
    if (!res.ok) throw new Error(`Market history request failed: ${res.status}`);
    const body = await res.json();
    return body.history ?? [];
  },
  getPublicProfile: async (idOrNickname: string): Promise<PublicParticipantProfile> => {
    const res = await fetchGetWithRetry(`${API_BASE}/api/agents/${encodeURIComponent(idOrNickname)}/public`);
    if (res.status === 404) throw new Error('Participant not found');
    if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
    return res.json();
  },
  joinWorkspace: (workspaceId: string) =>
    request(`/api/marketplace/${encodeURIComponent(workspaceId)}/join`, {
      method: 'POST',
    }),

  // Notifications inbox (the bell). Workspace-agnostic: one inbox per
  // participant across every floor.
  getNotifications: (limit = 30): Promise<NotificationsPayload> => request(`/api/notifications?limit=${limit}`),
  markNotificationsSeen: (): Promise<{ ok: boolean; seenAt: string }> =>
    request('/api/notifications/seen', { method: 'POST' }),
  /** Read one row: the count drops by one, not all at once. */
  markNotificationRead: (itemId: string): Promise<{ ok: boolean }> =>
    request(`/api/notifications/${encodeURIComponent(itemId)}/read`, {
      method: 'POST',
    }),
  /** The mobile channel: whether push is configured, and the VAPID public key
   *  a browser needs to subscribe. */
  getPushKey: (): Promise<{ configured: boolean; publicKey: string | null }> =>
    request('/api/notifications/push-key', {}, true),
  /** Register this browser as one of my mobile addresses. */
  registerPushSubscription: (subscription: unknown): Promise<{ ok: boolean }> =>
    request('/api/notifications/push-subscriptions', {
      method: 'POST',
      body: JSON.stringify({ subscription }),
    }),
  /** Forget this browser's subscription. */
  deletePushSubscription: (endpoint: string): Promise<{ ok: boolean }> =>
    request('/api/notifications/push-subscriptions', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint }),
    }),

  // User auth / profile
  getProfile: () => request('/api/auth/me'),
  /** `notifications` is the email switches; any subset, an omitted key keeps
   *  its current value (see docs/vision.md, "Participant email notifications"). */
  upsertProfile: (opts?: {
    email?: string;
    intent?: 'creator' | 'agent' | 'trader';
    nickname?: string;
    bio?: string;
    image?: string | null;
    payoutHandle?: string | null;
    payoutMethod?: PayoutMethod | null;
    notifications?: Partial<NotificationPrefs>;
    notificationChannels?: NotificationMatrixUpdate;
    /** Whether the tradeable balance may fund market pools once the
     *  liquidity wallet is empty (the wallet is always spent first). */
    poolFromBalance?: boolean;
  }) =>
    request('/api/auth/profile', {
      method: 'POST',
      body: JSON.stringify(opts ?? {}),
    }),
  recordConsent: () =>
    request('/api/auth/consent', {
      method: 'POST',
      body: JSON.stringify({ accepted: true }),
    }),
  // Key-first onboarding claim (see /claim page and POST /api/onboard)
  onboardClaimInfo: (token: string) => request(`/api/onboard/claim/${encodeURIComponent(token)}`, {}, true),
  onboardClaim: (token: string) =>
    request('/api/onboard/claim', { method: 'POST', body: JSON.stringify({ token }) }, true),
  deleteAccount: () => request('/api/auth/me', { method: 'DELETE' }),
  exportAccount: () => request('/api/auth/me/export'),

  // Workspaces
  createWorkspace: (
    body:
      | {
          name: string;
          template?: string;
          templateParams?: { revenueRangeMax?: number; currency?: string };
          visibility?: 'public' | 'unlisted' | 'private';
        }
      | string,
  ) => {
    const payload = typeof body === 'string' ? { name: body } : body;
    return request('/api/workspaces', { method: 'POST', body: JSON.stringify(payload) }, true);
  },
  listWorkspaces: () => request('/api/workspaces', {}, true),
  /** Persist the caller's personal sidebar order for the workspace list.
   *  `ids` is every workspace id in the desired order; ids the caller no longer
   *  belongs to are ignored server-side. Returns { ok, order }. */
  reorderWorkspaces: (ids: string[]): Promise<{ ok: boolean; order: string[] }> =>
    request('/api/workspaces/order', { method: 'PUT', body: JSON.stringify({ ids }) }, true),
  /** Map a GitHub-style /{owner}/{slug} path to a workspace id. Returns the
   *  canonical segments + a `moved` flag (true when the slug is a former,
   *  renamed-away slug and the URL should be replaced). */
  resolveWorkspacePath: (
    owner: string,
    slug: string,
  ): Promise<{
    workspaceId: string;
    canonicalOwner: string;
    canonicalSlug: string;
    moved: boolean;
  }> =>
    request(`/api/workspaces/resolve?owner=${encodeURIComponent(owner)}&slug=${encodeURIComponent(slug)}`, {}, true),
  getWorkspace: (id: string) => request(`/api/workspaces/${id}`),
  getWorkspaceStats: (id: string) => request(`/api/workspaces/${id}/stats`),
  updateWorkspaceSettings: (
    id: string,
    body: {
      name?: string;
      description?: string | null;
      charter?: string | null;
      subjectAbout?: string | null;
      telarchyStartedOn?: string | null;
      autoFundNewMarkets?: boolean;
      newMarketLiquidityCredits?: number;
      visibility?: 'public' | 'unlisted' | 'private';
      proposalReward?: number;
      spamPenalty?: number;
      maxPendingProposalsPerParticipant?: number;
    },
  ) =>
    request(`/api/workspaces/${id}/settings`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteWorkspace: (id: string) => request(`/api/workspaces/${id}`, { method: 'DELETE' }),
  /** Every announcement on a public floor, newest first. Anonymous read, so
   *  the floor can show them before a visitor has an account. */
  getWorkspaceAnnouncements: (idOrSlug: string): Promise<{ announcements: Announcement[] }> =>
    request(`/api/marketplace/${encodeURIComponent(idOrSlug)}/announcements`),
  publishAnnouncement: (workspaceId: string, body: string): Promise<Announcement> =>
    request(`/api/workspaces/${workspaceId}/announcements`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  /** Corrects an announcement. The server keeps the original body and stamps
   *  editedAt; there is no delete. */
  editAnnouncement: (workspaceId: string, announcementId: string, body: string): Promise<Announcement> =>
    request(`/api/workspaces/${workspaceId}/announcements/${announcementId}`, {
      method: 'PUT',
      body: JSON.stringify({ body }),
    }),
  // Sources (text + external bridges, unified)
  listSources: () => request('/api/sources'),
  getSource: (id: string) => request(`/api/sources/${id}`),
  createTextSource: (body: { name: string; description?: string; content?: string }) =>
    request('/api/sources', {
      method: 'POST',
      body: JSON.stringify({ ...body, type: 'text' }),
    }),
  updateSource: (id: string, body: { name?: string; description?: string; content?: string }) =>
    request(`/api/sources/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteSource: (id: string) => request(`/api/sources/${id}`, { method: 'DELETE' }),
  getSourceTree: (id: string, path?: string, ref?: string) => {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (ref) params.set('ref', ref);
    const qs = params.toString();
    return request(`/api/sources/${id}/tree${qs ? `?${qs}` : ''}`);
  },
  getSourceFile: (id: string, path: string, ref?: string) => {
    const params = new URLSearchParams({ path });
    if (ref) params.set('ref', ref);
    return request(`/api/sources/${id}/file?${params}`);
  },
  getGitHubRepos: (state: string) => request(`/api/sources/github/repos?state=${encodeURIComponent(state)}`),
  connectGitHub: (body: { state: string; repos: string[] }) =>
    request('/api/sources/github/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Feedback (bug reports / help requests)
  submitFeedback: (body: {
    kind: 'bug' | 'help' | 'feedback';
    subject: string;
    body: string;
    url?: string;
    email?: string;
  }) => request('/api/feedback', { method: 'POST', body: JSON.stringify(body) }, true),
  listFeedback: (
    params: {
      kind?: 'bug' | 'help' | 'feedback';
      status?: 'open' | 'triaged' | 'resolved' | 'closed';
      limit?: number;
    } = {},
  ) => {
    const q = new URLSearchParams();
    if (params.kind) q.set('kind', params.kind);
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q}` : '';
    return request(`/api/feedback${qs}`, {}, true);
  },
  updateFeedback: (
    id: string,
    body: {
      status?: 'open' | 'triaged' | 'resolved' | 'closed';
      adminNotes?: string;
    },
  ) => request(`/api/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true),

  // API keys & authenticated agent creation (used by the API page).
  // /api/agents/:id/keys uses :id=me to operate on the calling agent.
  listAgentKeys: (agentId: string) => request(`/api/agents/${encodeURIComponent(agentId)}/keys`),
  mintAgentKey: (
    agentId: string,
    body: {
      label?: string;
      scopes?: string[];
      workspaceId?: string;
      workspaceLocked?: boolean;
    },
  ): Promise<{
    keyId: string;
    apiKey: string;
    scopes: string[];
    workspaceId: string;
    workspaceLocked: boolean;
  }> =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAgentKey: (agentId: string, keyId: string, body: { label?: string | null; scopes?: string[] }) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys/${encodeURIComponent(keyId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  revokeAgentKey: (agentId: string, keyId: string) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),
  /**
   * Authenticated agent creation. The caller becomes the owner (authUserId)
   * for browser sessions. Memberships add the new agent to the named groups
   * in each workspace; caller must hold `manage` capability there. The
   * returned apiKey is shown once and never returned again. Send X-Workspace-Id
   * via the active workspace; backend default workspaceId on the new key is
   * memberships[0].workspaceId or the caller's active workspace.
   */
  createAgent: (body: {
    agentId: string;
    nickname?: string;
    keyLabel?: string;
    keyScopes?: string[];
    memberships?: Array<{ workspaceId: string; groupIds: string[] }>;
    /** Funds the new bot out of YOUR balance, in the same transaction that
     *  creates it. Nothing is minted, and if you cannot afford it no bot is
     *  created at all. Omit or 0 to create an unfunded one. */
    initialCredits?: number;
  }): Promise<{ agentId: string; apiKey: string; initialCredits: number }> =>
    request('/api/agents', { method: 'POST', body: JSON.stringify(body) }),

  // Permission groups
  listGroups: () => request('/api/groups'),
  createGroup: (name: string) => request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (
    id: string,
    body: {
      name?: string;
      memberIds?: string[];
      permissions?: Record<string, { read: boolean; trade: boolean }>;
      sourcePermissions?: Record<string, { read: boolean }>;
      capabilities?: string[];
    },
  ) => request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (id: string) => request(`/api/groups/${id}`, { method: 'DELETE' }),
};
