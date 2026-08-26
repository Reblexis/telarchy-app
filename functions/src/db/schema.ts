import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------------------------------------------------------------------------
// BetterAuth managed tables
// ---------------------------------------------------------------------------

export const authUser = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  consentedAt: timestamp('consented_at'),
  consentedVersion: text('consented_version'),
  /** Which door this human came through ('github' for the public repo, 'manifold',
   *  'hn', ...): the `?ref=` slug the landing stored in the ta_ref cookie, or the
   *  signup body's own `source`. Attribution for the open-source release; null
   *  when nothing was tagged. Same idea as waitlist.source. */
  source: text('source'),
});

export const authSession = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
});

export const authAccount = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const authVerification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** URL slug, derived from the name and unique per owner (createdBy). Drives
   *  the GitHub-style path /{ownerHandle}/{slug}. Nullable only transiently
   *  during backfill; new workspaces always get one. See migration 0034. */
  slug: text('slug'),
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** One-line summary of what this workspace governs. Shown on the marketplace
   *  card and the public workspace page, so a stranger can tell what they are
   *  looking at before joining. Public on public/unlisted workspaces. */
  description: text('description'),
  /** The owner's public commitment: what they will actually do with the number
   *  the market produces, and the pre-declared reasons they may decline anyway.
   *
   *  This exists because an open workspace's credibility is not its metrics, it
   *  is whether the owner honours the result. A workspace that invites outside
   *  forecasters without saying what their work buys them is asking for free
   *  labour, and forecasters correctly refuse. Rendered on the public workspace
   *  page above the markets. Public on public/unlisted workspaces. */
  charter: text('charter'),
  /** Owner-authored "what is this company/subject" blurb for the public floor
   *  (the "What is <name>?" section): free text, the owner's own words plus
   *  sources. Null = the floor shows its built-in default copy. */
  subjectAbout: text('subject_about'),
  /** When this workspace started running its number through Telarchy. The
   *  floor's actual-vs-forecast chart marks it with one dashed line, because a
   *  year of trajectory raises the question the number alone cannot answer:
   *  what changed, and when. Owner-declared rather than derived, since the
   *  honest date is neither the workspace's creation nor its first trade.
   *  Null = the chart carries no marker. */
  telarchyStartedOn: timestamp('telarchy_started_on'),
  /** 'public' | 'unlisted' | 'private' */
  visibility: text('visibility').notNull().default('private'),
  tradedVolume: doublePrecision('traded_volume').notNull().default(0),
  /** When true, new non-proposal markets debit the workspace owner's agent balance per newMarketLiquidityCredits. */
  autoFundNewMarkets: boolean('auto_fund_new_markets').notNull().default(false),
  /** Pool contribution (credits) per new market when auto-fund is on. */
  newMarketLiquidityCredits: doublePrecision('new_market_liquidity_credits').notNull().default(0),
  /** The workspace's liquidity budget in nanocredits (docs/liquidity.md):
   *  credits bought with a funding package, spendable only by placing
   *  liquidity into this workspace's markets. Never traded, never
   *  transferred, never paid out. Auto-fund draws it before the owner's
   *  tradeable balance; LP leftover from markets it funded returns here. */
  liquidityBudget: bigint('liquidity_budget', { mode: 'number' }).notNull().default(0),
  /** Per-metric auto-fund weights, { [metricId]: weight } (default 1 where
   *  absent, 0 = the owner funds that metric by hand). Auto-fund and the
   *  top-up sweep use newMarketLiquidityCredits x weight. docs/liquidity.md. */
  liquidityWeights: jsonb('liquidity_weights').notNull().default({}),
  /** Bounty paid by workspace owner to proposer when a proposal is approved. 0 = no reward. */
  proposalReward: doublePrecision('proposal_reward').notNull().default(0),
  /** Penalty deducted from proposer (paid to workspace owner) when a proposal is declined as spam. 0 = no penalty. */
  spamPenalty: doublePrecision('spam_penalty').notNull().default(0),
  /** Per-participant cap on simultaneously pending proposals in this workspace. 0 disables the cap. */
  maxPendingProposalsPerParticipant: integer('max_pending_proposals').notNull().default(0),
  /**
   * Per-participant cap, in credits, on cumulative buy cost per market
   * (both directions summed). 0 disables the cap.
   *
   * This is the workspace's manipulation bound: signup grants free credits to
   * every account, so without a cap one person with a handful of email
   * addresses can deploy enough into a single market to decide its outcome,
   * and any public ship-what-the-market-says commitment becomes buyable. With
   * a cap, moving a market far requires many distinct identities, which is
   * exactly the coordination the owner can detect and (per charter) void.
   * Deliberately a cumulative buy-cost bound rather than a net-position bound:
   * selling does not refund cap headroom, so churning cannot stretch it.
   */
  maxPositionCostPerMarket: doublePrecision('max_position_cost_per_market').notNull().default(0),
});

/**
 * Historical + current workspace slugs, keyed by owner. One row per slug a
 * workspace has ever had (created and on every rename). Lets old URLs resolve
 * and redirect to the current slug, and prevents an owner reusing a slug that
 * already points elsewhere. Uniqueness is enforced case-insensitively per owner
 * by a partial index in migration 0034 (not declared here, mirroring how the
 * nickname LOWER() index lives only in its migration).
 */
export const workspaceSlugAliases = pgTable('workspace_slug_aliases', {
  workspaceId: text('workspace_id').notNull(),
  ownerKey: text('owner_key').notNull(),
  slug: text('slug').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Per-participant display order of the workspace list (the sidebar). Membership
 * is many-to-many, so ordering is a personal view preference, not a property of
 * the workspace: it is keyed by the caller's auth identity (`identity` = uid for
 * a browser account, else the agent id, matching how memberships resolve). Rows
 * are upserted by PUT /api/workspaces/order; GET /api/workspaces sorts by
 * position and appends any workspace lacking a row (e.g. newly joined) after the
 * ordered ones. See migration 0042.
 */
export const workspaceOrderings = pgTable(
  'workspace_orderings',
  {
    identity: text('identity').notNull(),
    workspaceId: text('workspace_id').notNull(),
    position: integer('position').notNull().default(0),
  },
  t => [primaryKey({ columns: [t.identity, t.workspaceId] })],
);

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents = pgTable(
  'agents',
  {
    /** How this participant receives real money, as a human-readable summary
     *  ("PayPal: x@y.com"). DERIVED from payoutMethod when that is set; kept
     *  as its own column because proposal snapshots and the owner's payout
     *  view read it. Required (via payoutMethod) to post any paid job. */
    payoutHandle: text('payout_handle'),
    /** The structured payment method: { provider, ...provider fields },
     *  validated per provider in POST /api/auth/profile (lib/payout.ts).
     *  Source of truth for payment details; payoutHandle is its summary. */
    payoutMethod: jsonb('payout_method'),
    id: text('id').primaryKey(),
    apiKeyHash: text('api_key_hash').notNull(),
    /** BetterAuth user ID for browser-authenticated participants. Means "this
     *  human IS this participant"; unique by index, set on the user's first
     *  participant only. Detached on GDPR delete. */
    authUserId: text('auth_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** BetterAuth user ID of the human who registered this participant via
     *  POST /api/agents. Means "this human OWNS this bot". Nullable, not unique
     *  (one human can own many bots). Bot agents themselves are independent
     *  participants once created; ownership is just an attribution / discovery
     *  link surfaced in /api/agents/mine. */
    ownerUserId: text('owner_user_id').references(() => authUser.id, { onDelete: 'set null' }),
    /** Attribution slug ('github', ...). Set from POST /api/agents/register's
     *  optional `source`, or inherited from the creating user's source on
     *  POST /api/agents. See authUser.source. */
    source: text('source'),
    /** Agent id of the participant that created this one via POST /api/agents
     *  using an agent key (agent-spawned sub-bots, e.g. an evolver's
     *  population). Means "this agent OWNS this bot". Nullable; complementary
     *  with ownerUserId (browser callers set ownerUserId, agent-key callers
     *  set ownerAgentId). Surfaced as parent/children on the public
     *  participant profile. Declared without .references() to avoid a
     *  self-referential type cycle; the FK lives in migration 0035. */
    ownerAgentId: text('owner_agent_id'),
    /**
     * Optional case-insensitive unique handle. Either signup path (human auth,
     * API register) may claim one. Uniqueness is enforced by a partial unique
     * index on LOWER(nickname); see migration 0020.
     */
    nickname: text('nickname'),
    /** SHA-256 of the one-time claim token minted by POST /api/onboard. A human
     *  presents the raw token (via the /claim page) to bind their browser
     *  account to this key-first identity; consumed (nulled) on claim. Null for
     *  identities not created through onboarding or already claimed. */
    claimTokenHash: text('claim_token_hash'),
    /** Balance in nanocredits (1 credit = 1_000_000_000 units) */
    balance: bigint('balance', { mode: 'number' }).notNull().default(0),
    earnedBetting: doublePrecision('earned_betting').notNull().default(0),
    spentBetting: doublePrecision('spent_betting').notNull().default(0),
    spentTokens: doublePrecision('spent_tokens').notNull().default(0),
    /** Base network USDC withdrawal address (checksummed) */
    walletAddress: text('wallet_address'),
    withdrawnUsdc: doublePrecision('withdrawn_usdc').notNull().default(0),
    /** Whether this participant has platform-wide admin privileges. */
    platformAdmin: boolean('platform_admin').notNull().default(false),
    /** 'creator' | 'agent' | null - onboarding intent captured at signup */
    intent: text('intent'),
    /** Freeform public bio: who this participant is and what it is in Telarchy
     *  to do. Shown on the public profile. Max 500 chars, set at registration
     *  or via POST /api/auth/profile. */
    bio: text('bio'),
    /**
     * Email notification switches (owner ask 2026-08-19; docs/vision.md,
     * "Participant email notifications"). They live on the participant rather
     * than the browser account because the thing being notified about (a
     * comment, a contract) happens to a participant, and one human can hold
     * several. Mail only ever reaches a participant with a browser account
     * attached; a key-only bot has no address and is skipped.
     *
     * On by default: someone commented under a contract this participant
     * posted. An answer addressed to you that nobody tells you about is the
     * comment box breaking its own promise.
     */
    notifyCommentOnMyProposal: boolean('notify_comment_on_my_proposal').notNull().default(true),
    /** On by default: someone else commented in a thread this participant has
     *  commented in (contract or market), i.e. a reply to them. */
    notifyReplyToMyComment: boolean('notify_reply_to_my_comment').notNull().default(true),
    /** OFF by default: every new contract on the ballot of a workspace this
     *  participant belongs to. Volume is set by strangers, so this one is
     *  opt-in rather than opt-out. */
    notifyNewProposal: boolean('notify_new_proposal').notNull().default(false),
    /** OFF by default: every comment on a workspace this participant belongs to,
     *  whoever wrote it and wherever it landed. The owner of a floor wants to
     *  see the conversation on it without going looking; nobody else does, and
     *  the volume is set by strangers, so it is opt-in like the one above. */
    notifyAnyComment: boolean('notify_any_comment').notNull().default(false),
    /** ON by default: a market this participant traded settled, with the value
     *  it settled at. The answer to a bet they placed, so opt-out. */
    notifyMarketResolved: boolean('notify_market_resolved').notNull().default(true),
    /** ON by default: a contract this participant traded on or commented under
     *  was approved or declined. The proposer's own decision mail is switchless
     *  (services/notifications.ts); this switch covers everyone else with money
     *  or words on the outcome. */
    notifyContractDecided: boolean('notify_contract_decided').notNull().default(true),
    /** Web and mobile cells of the notification matrix, as OVERRIDES:
     *  { [kind]: { web?, mobile? } }. A missing cell means its default
     *  (lib/notification-prefs.ts). Email cells stay on the boolean columns
     *  above, so every cell has exactly one owner. */
    notificationChannels: jsonb('notification_channels'),
    /**
     * How far this participant has read the notifications inbox
     * (GET /api/notifications). The inbox itself is derived from comments,
     * contracts and decisions rather than stored, so this one timestamp is
     * the entire read state: anything newer is unread.
     *
     * Defaults to now(), and migration 0064 backfilled existing rows the same
     * way, because a null would have meant every account's first sight of the
     * feature was a badge counting months of history nobody promised them.
     */
    /** Operated by us or run as part of the platform: trading bots, sync jobs,
     *  the workspace owner's own admin account. They trade, they rank and they
     *  appear on every board like anyone else; they simply cannot take a prize
     *  rung, which is what the published season rules have always said and what
     *  nothing enforced until 2026-08-20. */
    platformOperated: boolean('platform_operated').notNull().default(false),
    notificationsSeenAt: timestamp('notifications_seen_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    approvedAt: timestamp('approved_at'),
  },
  t => [uniqueIndex('agents_auth_user_id_idx').on(t.authUserId)],
);

/**
 * Daily balance snapshots per participant, written by the hourly resolve cron
 * (first run of each UTC day; idempotent via the composite PK). Balance is in
 * nanocredits, like agents.balance. Powers the balance graph on the public
 * participant profile.
 *
 * Since migration 0060 this is a cache, not the only record: `credit_ledger`
 * carries every balance delta with a running balance_after, so the graph
 * COULD be replayed from it. This table stays because the graph is a hot read
 * and replaying a participant's whole ledger to draw thirty points is a scan
 * where this is a lookup. If the two ever disagree, the ledger is right.
 */
export const agentBalanceSnapshots = pgTable(
  'agent_balance_snapshots',
  {
    agentId: text('agent_id').notNull(),
    /** UTC day, YYYY-MM-DD. */
    day: text('day').notNull(),
    balance: bigint('balance', { mode: 'number' }).notNull(),
  },
  t => [primaryKey({ columns: [t.agentId, t.day] })],
);

export const agentApiKeys = pgTable(
  'agent_api_keys',
  {
    hash: text('hash').primaryKey(),
    /** Opaque public handle (uuid). Used in management URLs so the hash never leaves the DB. */
    keyId: text('key_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull(),
    /** Optional human label shown in the management UI. */
    label: text('label'),
    /** Per-key permission set. Vocabulary lives in lib/scopes.ts. Default '{*}' = full access. */
    scopes: text('scopes').array().notNull().default(['*']),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** Bumped (debounced) by the auth middleware on every successful key resolve. */
    lastUsedAt: timestamp('last_used_at'),
  },
  t => [uniqueIndex('agent_api_keys_key_id_idx').on(t.keyId)],
);

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export const waitlist = pgTable('waitlist', {
  email: text('email').primaryKey(),
  /** Which door they came through: 'marketplace' for the listing tile, or a
   *  workspace slug for that floor's own email door. Both post to the same
   *  endpoint, so without this the owner cannot tell which surface converts.
   *  Null on rows written before the column existed. */
  source: text('source'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Deposits & Withdrawals
// ---------------------------------------------------------------------------

export const deposits = pgTable('deposits', {
  txHash: text('tx_hash').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  from: text('from').notNull(),
  usdcAmount: doublePrecision('usdc_amount').notNull(),
  credits: doublePrecision('credits').notNull(),
  buyRate: doublePrecision('buy_rate').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * Participant-to-participant credit transfers (POST /api/agents/transfer).
 * Why: credits previously moved only via trading, deposits, payouts, and
 * admin crediting; external economic systems built on top of Telarchy (e.g.
 * the agent-economy bank's credit<->compute-credit exchange) need a plain
 * "pay another participant" primitive, and both parties need a visible
 * ledger of those moves. Amounts are stored in credits (display units);
 * balance mutations themselves happen in integer nanocredits.
 */
export const creditTransfers = pgTable(
  'credit_transfers',
  {
    id: text('id').primaryKey(),
    fromAgentId: text('from_agent_id')
      .notNull()
      .references(() => agents.id),
    toAgentId: text('to_agent_id')
      .notNull()
      .references(() => agents.id),
    credits: doublePrecision('credits').notNull(),
    /** Freeform reference set by the sender (max 200 chars), e.g. an exchange
     *  or invoice id in an external system. */
    memo: text('memo').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [index('credit_transfers_from_idx').on(t.fromAgentId), index('credit_transfers_to_idx').on(t.toAgentId)],
);

export const withdrawals = pgTable('withdrawals', {
  id: text('id').primaryKey(),
  agentId: text('agent_id')
    .notNull()
    .references(() => agents.id),
  credits: doublePrecision('credits').notNull(),
  usdcAmount: doublePrecision('usdc_amount').notNull(),
  toAddress: text('to_address').notNull(),
  txHash: text('tx_hash').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// System config (replaces _system/economy Firestore doc)
// ---------------------------------------------------------------------------

export const systemConfig = pgTable('system_config', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
});

// ---------------------------------------------------------------------------
// Workspace-scoped tables (all carry workspaceId)
// ---------------------------------------------------------------------------

export const metrics = pgTable(
  'metrics',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    value: doublePrecision('value').notNull().default(0),
    formula: text('formula').notNull().default('0'),
    /** Display order within workspace */
    order: integer('order').notNull().default(0),
    /** { enabled: boolean, halfLife: number, density?: number } | null */
    timePreference: jsonb('time_preference'),
    marketRangeMax: doublePrecision('market_range_max').notNull().default(1000),
    /**
     * The period this number restarts on: 'hour' | 'day' | 'week' | 'month' |
     * 'year', or NULL when it never restarts (an accumulating total or a level).
     *
     * It says which readings belong together. A resetting metric's reading is
     * about the period it was taken in and nothing else, so only readings inside
     * a market's own target period are that market's actual-so-far. Undeclared,
     * the floor drew last week's total as this week's actual (owner report
     * 2026-08-17).
     */
    resetsEvery: text('resets_every'),
    /**
     * While this metric has no logged reading at or before a market's
     * resolution instant, that market voids (N/A, everyone refunded) instead
     * of settling on `value`. For a number that does not exist until an event
     * happens, e.g. the valuation implied by an investment (owner ask
     * 2026-08-25). The first reading ends the state for good.
     */
    resolvesNaUntilMeasured: boolean('resolves_na_until_measured').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

export const markets = pgTable(
  'markets',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    metricId: text('metric_id').notNull(),
    metricName: text('metric_name').notNull(),
    targetDate: text('target_date').notNull(),
    resolved: boolean('resolved').notNull().default(false),
    resolvedAt: timestamp('resolved_at'),
    actualValue: doublePrecision('actual_value'),
    active: boolean('active').notNull().default(true),
    voided: boolean('voided').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    rangeMin: doublePrecision('range_min').notNull(),
    rangeMax: doublePrecision('range_max').notNull(),
    /** [lowerShares, higherShares] - LMSR state */
    shares: jsonb('shares').notNull().$type<[number, number]>(),
    liquidity: doublePrecision('liquidity').notNull(),
    /** LMSR pool (liquidity parameter b) */
    pool: doublePrecision('pool').notNull(),
    /** Cumulative traded volume on this market: sum of |cost| across all buy and sell trades. */
    tradedVolume: doublePrecision('traded_volume').notNull().default(0),
    proposalId: text('proposal_id'),
    /**
     * Conditional-market branch. NULL on natural-trajectory (non-proposal) markets.
     * On proposal-conditional markets: 'approved' (priced under the assumption the
     * proposal is approved) or 'declined' (priced under the assumption it is
     * declined). The headline impact is approved.consensus - declined.consensus.
     */
    branch: text('branch'),
    /** Flagged for the public benchmark surface (/benchmark + /api/marketplace/featured). */
    featured: boolean('featured').notNull().default(false),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] }), index('markets_workspace_idx').on(t.workspaceId)],
);

export const positions = pgTable(
  'positions',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    marketId: text('market_id').notNull(),
    /** 'higher' | 'lower' */
    direction: text('direction').notNull(),
    shares: doublePrecision('shares').notNull(),
    totalCost: doublePrecision('total_cost').notNull(),
  },
  t => [
    primaryKey({ columns: [t.id, t.workspaceId] }),
    index('positions_workspace_idx').on(t.workspaceId),
    index('positions_market_idx').on(t.marketId),
  ],
);

export const trades = pgTable(
  'trades',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id),
    marketId: text('market_id').notNull(),
    /** 'higher' | 'lower' */
    direction: text('direction').notNull(),
    shares: doublePrecision('shares').notNull(),
    cost: doublePrecision('cost').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.id, t.workspaceId] }),
    // Regrowth insurance, not present-day tuning: this table hit 348k rows once
    // (lib/board.ts) and every hot read filters one of these shapes. The PK
    // leads on id, so it serves none of them.
    index('trades_ws_market_created_idx').on(t.workspaceId, t.marketId, t.createdAt),
    index('trades_created_idx').on(t.createdAt),
  ],
);

export const liquidityEvents = pgTable(
  'liquidity_events',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    marketId: text('market_id').notNull(),
    amount: doublePrecision('amount').notNull(),
    totalLiquidity: doublePrecision('total_liquidity').notNull(),
    /** 'initial' | 'injection' */
    type: text('type').notNull(),
    /** Agent who provided liquidity (null for initial platform liquidity and
     *  for budget-funded liquidity, see fundedBy) */
    agentId: text('agent_id'),
    poolContribution: doublePrecision('pool_contribution'),
    /** 'agent' (from agentId's balance) | 'budget' (the workspace liquidity
     *  budget, docs/liquidity.md) | 'platform' (initial, nobody's). Decides
     *  where the pool leftover goes at resolution or void. */
    fundedBy: text('funded_by').notNull().default('agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.id, t.workspaceId] }),
    // The price replay reads every event for one market in creation order.
    index('liquidity_events_ws_market_created_idx').on(t.workspaceId, t.marketId, t.createdAt),
  ],
);

/**
 * A resting instruction: buy `direction` in this market with up to
 * `budgetCredits`, but only while consensus sits at or beyond `limitValue`.
 *
 * `budgetCredits` is debited at placement, so a row here is reserved money
 * rather than an intention; cancelling or expiring refunds the unfilled
 * remainder. Fills happen inside the transaction of whatever trade crossed
 * the limit (no matching engine, no cron), and an order never moves the
 * price past its own limit, which is what makes it a limit order rather
 * than a delayed market order. Design: docs/limit-orders.md.
 */
/**
 * Every change to a participant's balance, with the reason it happened.
 *
 * `agents.balance` is a cache of this table's sum. Before migration 0060 it
 * was the only record: about twenty-five call sites incremented it directly
 * (payouts, void refunds, proposal stakes and rewards, spam penalties,
 * contract payments, signup grants, admin adjustments, limit-order holds) and
 * none of them left a row, so a wrong balance could not be explained and a
 * lost one could not be rebuilt.
 *
 * `services/credits.ts` (`applyCredits`) is the only code allowed to write
 * either this table or `agents.balance`, and it writes both in one
 * transaction, so a balance change without a record is not expressible. A
 * source-grep test fails the build if a second writer appears; a
 * reconciliation test replays this table and asserts it equals the stored
 * balance. Append-only under the same trigger as `trades`.
 *
 * Governing doc: docs/market-integrity.md.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    agentId: text('agent_id').notNull(),
    /** Nanocredits, signed: negative is a debit. Same unit as agents.balance. */
    deltaUnits: bigint('delta_units', { mode: 'number' }).notNull(),
    /** The balance this row produced, so a divergence is visible at its origin. */
    balanceAfterUnits: bigint('balance_after_units', { mode: 'number' }).notNull(),
    /** Closed set; see CreditReason in services/credits.ts. */
    reason: text('reason').notNull(),
    /** 'market' | 'proposal' | 'transfer' | 'season' | null. */
    refType: text('ref_type'),
    refId: text('ref_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

/**
 * What a market was settling on, and when the owner changed it.
 *
 * Editing a metric's description used to void every open market on it
 * (refunding positions, respawning fresh), because the description IS the
 * settlement text. With a prize season running that trade is backwards: a
 * reworded sentence cost a week of price discovery and every open position.
 * Since 2026-08-18 the edit applies in place and this row is what keeps it
 * honest, rendered on the floor under "What is this market?" so a trader can
 * see whether the goalposts moved after they took their position.
 *
 * Append-only: the whole point is that a revision cannot be un-made.
 */
export const metricDefinitionRevisions = pgTable(
  'metric_definition_revisions',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    metricId: text('metric_id').notNull(),
    /** 'name' | 'description' | 'formula' | 'marketRangeMax' */
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    /** Agent id or auth user id of whoever saved it, when known. */
    changedBy: text('changed_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

/**
 * Every edit to a contract's definition, in the order it happened.
 *
 * Same rule and same shape as `metricDefinitionRevisions`, for the same
 * reason (docs/market-integrity.md, I1b): a contract's title, description and
 * price are what a trader prices "if approved" against, and editing them in
 * place is only honest if the change is published to whoever is already
 * holding. `askUsd` is here too, even though changing it re-anchors an
 * untraded pair rather than editing under anyone: a price that moved before
 * the first trade still explains why the opening call is where it is.
 *
 * Append-only: the whole point is that a revision cannot be un-made.
 */
export const proposalRevisions = pgTable(
  'proposal_revisions',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    proposalId: text('proposal_id').notNull(),
    /** 'title' | 'description' | 'askUsd' */
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    /** Agent id or auth user id of whoever saved it, when known. */
    changedBy: text('changed_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

export const limitOrders = pgTable('limit_orders', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  marketId: text('market_id').notNull(),
  agentId: text('agent_id').notNull(),
  /** 'higher' | 'lower' */
  direction: text('direction').notNull(),
  /** Metric space (dollars), not probability: the page speaks dollars. */
  limitValue: doublePrecision('limit_value').notNull(),
  budgetCredits: doublePrecision('budget_credits').notNull(),
  filledCredits: doublePrecision('filled_credits').notNull().default(0),
  /** 'open' | 'filled' | 'cancelled' | 'expired' */
  status: text('status').notNull().default('open'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const proposals = pgTable(
  'proposals',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    proposedBy: text('proposed_by').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    /** 'pending' | 'approved' | 'declined' | 'declined_spam' | 'withdrawn' */
    status: text('status').notNull().default('pending'),
    /** Where approval's real-dollar payment goes (PayPal email, IBAN, crypto
     *  address; free text). Required at listing for a non-zero ask; returned
     *  only to manage-capability callers, never in member/public payloads. */
    payoutHandle: text('payout_handle'),
    conditionalMarketIds: jsonb('conditional_market_ids').notNull().$type<string[]>().default([]),
    /**
     * Per-branch-market credit subsidy seeded into each conditional market's
     * pool. Running total of all contributions (proposer at creation plus any
     * post-hoc admin top-ups); always equals the sum of subsidyContributions.
     */
    liquiditySubsidy: doublePrecision('liquidity_subsidy').notNull().default(0),
    /**
     * Who funds the subsidy: agentId -> credits per branch market. Re-spawned
     * conditional markets (target-date rollovers) are re-seeded from this map,
     * debiting each contributor, so top-ups persist instead of evaporating
     * with the voided market generation. Refunds on void flow back through
     * per-contributor liquidityEvents rows.
     */
    subsidyContributions: jsonb('subsidy_contributions').notNull().$type<Record<string, number>>().default({}),
    /** Reward credits actually paid out on approval. 0 if not approved or workspace had no reward configured. */
    rewardPaid: doublePrecision('reward_paid').notNull().default(0),
    /** Penalty credits actually charged on spam-decline. 0 if not declined as spam. */
    penaltyCharged: doublePrecision('penalty_charged').notNull().default(0),
    /** Set when status leaves 'pending'. */
    resolvedAt: timestamp('resolved_at'),
    /** Participant id who approved/declined/spam-declined; equals proposedBy on withdraw. */
    resolvedBy: text('resolved_by'),
    /**
     * Why this proposal was declined, in the owner's own words, kept permanently
     * on the proposal.
     *
     * A workspace that publishes a charter is promising participants that a
     * proposal the market ranked highest either ships or gets a written reason.
     * Without somewhere durable to put that reason it degrades into a chat
     * message nobody can find three months later, which is the same as not
     * having promised anything. So it is required on decline exactly when the
     * workspace has a charter: making the public commitment is what turns the
     * field on. See workspaces.charter.
     */
    declineReason: text('decline_reason'),
    /**
     * The job's price in whole USD (paid-jobs charter, 2026-08-09). Stored
     * rather than parsed back out of the title, because burn (the summed cost
     * of approved jobs) is subtracted inside the resolving metric: a number
     * that reaches the metric through prose can break silently or be edited.
     * Null for proposals that predate the field or that carry no ask.
     */
    askUsd: integer('ask_usd'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

/** One row per document load the server serves on the public floor
 *  (owner ask 2026-08-11): launch traffic beside signups on /admin.
 *  Request-log data per the privacy policy; purged past 30 days when
 *  the stats endpoint reads. */
/**
 * One row per notification a participant has read individually (the bell's
 * "one less per click"). The inbox is derived from several tables, so its
 * items have no single order a cursor could walk; `agents.notificationsSeenAt`
 * still answers "read everything older than this", and this table answers
 * "and also these".
 *
 * Deliberately disposable: marking everything read deletes the participant's
 * rows, because the watermark then covers them and a table of read receipts
 * nobody queries is just growth.
 */
export const notificationReads = pgTable(
  'notification_reads',
  {
    agentId: text('agent_id').notNull(),
    /** The derived item id from GET /api/notifications, e.g. `pm-<uuid>`. */
    itemId: text('item_id').notNull(),
    readAt: timestamp('read_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.agentId, t.itemId] })],
);

/**
 * One browser's push subscription, the mobile channel's address (owner ask
 * 2026-08-24). A participant can hold several (phone and laptop both count);
 * the endpoint is the identity, so re-subscribing the same browser upserts
 * rather than duplicates. A push rejected with 404/410 means the browser
 * revoked it, and the sender deletes the row.
 */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    /** The browser-issued push URL; unique, because one browser is one address. */
    endpoint: text('endpoint').notNull(),
    /** The subscription's `keys` object (p256dh + auth), as the browser gave it. */
    keys: jsonb('keys').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [
    uniqueIndex('push_subscriptions_endpoint_idx').on(t.endpoint),
    index('push_subscriptions_agent_idx').on(t.agentId),
  ],
);

/**
 * Every question asked of a floor's Ask field, with its answer (owner ask
 * 2026-08-20). This is the only record of what a visitor wanted to know and
 * could not find on the page, which before launch is the highest-signal data
 * the product produces: each row is a gap in the floor, in the visitor's own
 * words.
 *
 * The answer is stored beside the question on purpose. Models change and
 * prompts change, so an answer that was wrong cannot be reproduced later by
 * re-asking; if it is not kept, the evidence is gone.
 *
 * Identity is layered and best-effort: the participant when the asker had one,
 * and otherwise the request-log fields the privacy policy already covers. Those
 * are purged on the same 30-day window as pageVisits, while the question text
 * is kept, because the gap it names outlives the visit.
 */
export const floorQuestions = pgTable(
  'floor_questions',
  {
    id: text('id').primaryKey(),
    /** The floor asked about; NULL for a conversation on the operator door,
     *  where the person does not have one yet (the operator-door design note). */
    workspaceId: text('workspace_id'),
    question: text('question').notNull(),
    answer: text('answer').notNull().default(''),
    /** Participant id when known; null for an anonymous visitor, which is most
     *  of them by design (the field exists to serve people without accounts). */
    askedBy: text('asked_by'),
    ip: text('ip'),
    country: text('country'),
    costUsd: doublePrecision('cost_usd'),
    model: text('model'),
    /** Set when the gateway failed or the budget ran out: a question that got
     *  no answer is the most interesting row in the table. */
    error: text('error'),
    /** What Otto did on the asker's behalf while answering: [{ method, path,
     *  status }] (owner direction 2026-08-21, when he stopped being an answer
     *  service and got the caller's own API access). Acting for someone without
     *  a record of what was done is the part that could not be defended later,
     *  and the row already carries who asked and what they asked for. */
    toolCalls: jsonb('tool_calls'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [index('floor_questions_created_idx').on(t.createdAt)],
);

export const pageVisits = pgTable('page_visits', {
  id: text('id').primaryKey(),
  ts: timestamp('ts').notNull().defaultNow(),
  path: text('path').notNull(),
  referer: text('referer'),
  userAgent: text('user_agent'),
  ip: text('ip'),
  /** ISO 3166-1 alpha-2 country from an offline IP lookup at log time
   *  (owner ask 2026-08-11): where launch traffic comes from. Null when
   *  the IP is private/unknown. */
  country: text('country'),
});

/**
 * Visits and unique addresses per day, kept forever (owner ask 2026-08-20:
 * the data room publishes traffic).
 *
 * page_visits is purged at 30 days by the privacy policy, which would cap the
 * published history at a month for as long as the site exists. This rollup is
 * written on every data-room read from whatever rows the log still holds, so
 * history accumulates from the day it shipped instead of sliding.
 *
 * It carries no IP, no path, no user-agent and no referer: two counts and a
 * date. That is what makes keeping it forever compatible with purging the log
 * that produced it, and it is why the table can be read by anyone.
 */
export const trafficDaily = pgTable('traffic_daily', {
  /** ISO date, YYYY-MM-DD, in UTC, matching how the cockpit buckets days. */
  day: text('day').primaryKey(),
  visits: integer('visits').notNull(),
  /** Distinct IPs that day, counted before the address was purged. */
  uniques: integer('uniques').notNull(),
});

export const proposalMessages = pgTable(
  'proposal_messages',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    proposalId: text('proposal_id').notNull(),
    from: text('from').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

export const marketMessages = pgTable(
  'market_messages',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    marketId: text('market_id').notNull(),
    from: text('from').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

/** Owner-authored prose attached to a workspace: public, timestamped, newest
 *  first. The surface a charter's "I announce material news" promise lands on
 *  (see docs/vision.md, "Workspace announcements"). Not a comment (nobody
 *  replies) and not `updates` below (which is a metric-change record).
 *
 *  Append-only, enforced by a trigger in migration 0057, not by convention:
 *  there is no delete and no overwrite, because what this buys a trader is the
 *  ability to check that a disclosure happened BEFORE an event, and a record
 *  the publisher can quietly rewrite proves nothing. */
export const announcements = pgTable(
  'announcements',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** Markdown, capped at 5000 chars by the route. */
    body: text('body').notNull(),
    /** Set server-side on insert and never again; a self-chosen disclosure
     *  timestamp is not evidence of anything. */
    publishedAt: timestamp('published_at').notNull().defaultNow(),
    /** Null until the row is edited. Public from then on, beside publishedAt. */
    editedAt: timestamp('edited_at'),
    /** Null until the FIRST edit, then the body exactly as first published.
     *  Public, so an edit is visible as an edit rather than as history. */
    originalBody: text('original_body'),
    /** Nickname of the publishing participant when it is NOT the workspace
     *  owner (an automated publisher, an admin); null when the owner
     *  published it. Set on insert, never editable (migration 0078): the
     *  owner's words and a delegate's must stay distinguishable forever. */
    publishedBy: text('published_by'),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

export const updates = pgTable(
  'updates',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    metricName: text('metric_name').notNull(),
    oldValue: doublePrecision('old_value').notNull(),
    newValue: doublePrecision('new_value').notNull(),
    description: text('description').notNull().default(''),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

export const metricLogs = pgTable(
  'metric_logs',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    metricId: text('metric_id').notNull(),
    metricName: text('metric_name').notNull(),
    /** User-authored current value for leaves (0 for composites, since the PUT route zeroes value on non-leaf rows). */
    value: doublePrecision('value').notNull(),
    /** Computed outlook (m.total). For composites this is the formula result; for leaves with Time Preference enabled
     *  it is the blend of value and future market consensus, so it differs from value. NULL on rows written before
     *  migration 0018. */
    outlook: doublePrecision('outlook'),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.id, t.workspaceId] }),
    index('metric_logs_ws_metric_ts_idx').on(t.workspaceId, t.metricId, t.timestamp),
  ],
);

export const events = pgTable(
  'events',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    type: text('type').notNull(),
    data: jsonb('data').notNull(),
    timestamp: timestamp('timestamp').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] }), index('events_ws_ts_idx').on(t.workspaceId, t.timestamp)],
);

export const permissionGroups = pgTable(
  'permission_groups',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    /** 'public' | 'admin' | 'trader' | 'custom' */
    type: text('type').notNull(),
    description: text('description').notNull().default(''),
    /** Canonical participant IDs in this group. */
    memberIds: jsonb('member_ids').notNull().$type<string[]>().default([]),
    /** metricId → { read: boolean, trade: boolean } */
    permissions: jsonb('permissions').notNull().$type<Record<string, { read: boolean; trade: boolean }>>().default({}),
    /** sourceId → { read: boolean } (covers both text and external-bridge sources) */
    sourcePermissions: jsonb('source_permissions').notNull().$type<Record<string, { read: boolean }>>().default({}),
    /** Capabilities granted to every member of this group: subset of 'read' | 'trade' | 'manage'. */
    capabilities: jsonb('capabilities').notNull().$type<string[]>().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

// ---------------------------------------------------------------------------
// Sources (workspace-scoped information stores, static or live)
// type='text': free-text content stored in `content`.
// type='github' (etc.): external bridge, config in `config`, optional opaque
//   credentials in `credentials` (never exposed via API).
// ---------------------------------------------------------------------------

export const sources = pgTable(
  'sources',
  {
    id: text('id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** 'text' | 'github' | ... */
    type: text('type').notNull(),
    content: text('content').notNull().default(''),
    config: jsonb('config').notNull().default({}),
    credentials: text('credentials').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.id, t.workspaceId] })],
);

// ---------------------------------------------------------------------------
// Hook watcher (replaces system/hookWatcher Firestore doc)
// ---------------------------------------------------------------------------

export const hookWatcher = pgTable('hook_watcher', {
  workspaceId: text('workspace_id').primaryKey(),
  lastHeartbeat: timestamp('last_heartbeat'),
  status: text('status'),
});

// ---------------------------------------------------------------------------
// Bot agent telemetry: heartbeats from the polling loop (next-tick visibility)
// and per-session decision traces (mainly LLM strategies). Pushed by the
// out-of-process telarchy-agents service so the admin UI can introspect what
// the bots are doing without tailing log files on the host.
// ---------------------------------------------------------------------------

export const agentTraces = pgTable(
  'agent_traces',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    agentId: text('agent_id').notNull(),
    strategy: text('strategy').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at').notNull(),
    model: text('model'),
    tokensIn: integer('tokens_in').notNull().default(0),
    tokensOut: integer('tokens_out').notNull().default(0),
    cacheRead: integer('cache_read').notNull().default(0),
    cacheWrite: integer('cache_write').notNull().default(0),
    candidates: integer('candidates').notNull().default(0),
    traded: integer('traded').notNull().default(0),
    skipped: integer('skipped').notNull().default(0),
    errors: integer('errors').notNull().default(0),
    costUsd: doublePrecision('cost_usd').notNull().default(0),
    /** Array of session entries: per-market estimate, confidence, distance, threshold, outcome, reasoning. */
    entries: jsonb('entries').notNull().$type<unknown[]>().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [
    // The first two exist in migration 0019 but were never declared here;
    // declaring them keeps drizzle-kit from trying to drop them. The third
    // serves the daily retention prune (services/maintenance.ts).
    index('agent_traces_workspace_started_idx').on(t.workspaceId, t.startedAt.desc()),
    index('agent_traces_agent_started_idx').on(t.agentId, t.startedAt.desc()),
    index('agent_traces_started_idx').on(t.startedAt),
  ],
);

// ---------------------------------------------------------------------------
// Feedback: bug reports and help requests submitted from the UI or via API.
// Visible to platform admins via /api/feedback (list) and per-row update.
// ---------------------------------------------------------------------------

export const feedback = pgTable('feedback', {
  id: text('id').primaryKey(),
  /** 'bug' | 'help' | 'feedback' */
  kind: text('kind').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  /** Workspace the submitter was active in at submission time, if any. */
  workspaceId: text('workspace_id'),
  /** Submitter's participant id (resolved from session or X-Agent-Key). */
  agentId: text('agent_id'),
  /** Submitter's BetterAuth user id, when signed in via browser session. */
  authUserId: text('auth_user_id'),
  /** Reply-to address. Captured from the form or copied from the user's auth profile. */
  email: text('email'),
  /** Page or endpoint where the issue was hit (frontend route or API path). */
  url: text('url'),
  /** Browser/client user-agent string. */
  userAgent: text('user_agent'),
  /** 'open' | 'triaged' | 'resolved' | 'closed' */
  status: text('status').notNull().default('open'),
  /** Free-form admin notes; appended over time, not exposed to submitters. */
  adminNotes: text('admin_notes').notNull().default(''),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/**
 * Desired-state control plane for out-of-process agents (the telarchy-agents
 * runners). The admin UI at /agents writes rows; each agent's runner polls
 * GET /api/admin/agent-controls every tick and obeys. This direction (agents
 * pull, server never connects to the agent host) means no inbound access to
 * the box running the agents is ever needed.
 */
export const agentControls = pgTable('agent_controls', {
  agentId: text('agent_id').primaryKey(),
  /** 'enabled' | 'paused'. Paused runners skip cycle bodies but keep heartbeating. */
  desiredState: text('desired_state').notNull().default('enabled'),
  /** Set by the UI to request an immediate cycle. */
  triggerRequestedAt: timestamp('trigger_requested_at'),
  /** Set by the runner when it fires the requested cycle (fires when requested > acked). */
  triggerAckedAt: timestamp('trigger_acked_at'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const agentHeartbeats = pgTable('agent_heartbeats', {
  /** One row per bot agent (e.g. bot-anchor, bot-ai-analyst). */
  agentId: text('agent_id').primaryKey(),
  /** 'idle' | 'running' | 'error' */
  status: text('status').notNull().default('idle'),
  /** Workspace currently being processed (if status='running'), or last visited. */
  workspaceId: text('workspace_id'),
  strategy: text('strategy'),
  lastCycleStartedAt: timestamp('last_cycle_started_at'),
  lastCycleEndedAt: timestamp('last_cycle_ended_at'),
  /** Wall-clock time of the next scheduled cycle, computed as endedAt + pollInterval. */
  nextCycleAt: timestamp('next_cycle_at'),
  pollIntervalSeconds: integer('poll_interval_seconds').notNull().default(0),
  workspacesVisited: integer('workspaces_visited').notNull().default(0),
  lastTraded: integer('last_traded').notNull().default(0),
  lastSkipped: integer('last_skipped').notNull().default(0),
  lastErrors: integer('last_errors').notNull().default(0),
  lastError: text('last_error'),
  balance: doublePrecision('balance'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Prize seasons
// ---------------------------------------------------------------------------

/**
 * One bounded cash tournament. Rules and arithmetic live in `lib/seasons.ts`;
 * this is just the record. Money never moves through the Service: the owner
 * pays winners directly against the payment details already on their account
 * (`agents.payout_method`), the same rail ToS section 3 uses for paid jobs.
 */
export const prizeSeasons = pgTable('prize_seasons', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  /** Total promised, in USD. Kept under 5000 deliberately: above that,
   *  New York and Florida require sweepstakes registration and bonding. */
  poolUsd: doublePrecision('pool_usd').notNull(),
  /** Published ladder, [{ place, prizeUsd }, ...]. Frozen once running. */
  ladder: jsonb('ladder').notNull(),
  /** The workspace ids this season scores over, PINNED when it starts rather
   *  than derived from workspaces.visibility at query time. Without this, an
   *  admin flipping a workspace public mid-season injects an entrant's whole
   *  history in it as if it were season profit, and flipping one private does
   *  the reverse; either reorders who receives money. */
  workspaceIds: jsonb('workspace_ids').notNull(),
  rulesUrl: text('rules_url').notNull(),
  /** draft | running | settled. Settle is reachable only from running, so a
   *  second settle can never reassign a prize that was already paid. */
  status: text('status').notNull().default('draft'),
  /** Frozen at settlement; the instant every final_profit was read at. */
  settledAt: timestamp('settled_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/**
 * One participant's entry in one season.
 *
 * `optedIn` lives here rather than on `agents` on purpose: a boolean on the
 * participant would silently carry one season's opt-in into the next.
 *
 * A row exists for every participant the season snapshotted a baseline for,
 * whether or not they opted in, because the baseline must be taken at the
 * season's start instant for everyone (otherwise opting in late is a free
 * option on your own drawdown). Only `optedIn` rows are ranked or paid.
 */
export const seasonEntries = pgTable(
  'season_entries',
  {
    seasonId: text('season_id').notNull(),
    agentId: text('agent_id').notNull(),
    /** Explicit entry. Nothing enters a participant into a season implicitly. */
    optedIn: boolean('opted_in').notNull().default(false),
    /** When they turned the toggle on. The published first tiebreak. */
    enteredAt: timestamp('entered_at'),
    /** When this entrant agreed to the season's published rules.
     *
     *  A record rather than a checkbox, because the question it answers ("did
     *  they accept these terms, and when?") is asked after the fact, in a
     *  dispute about money. Set on every opt-in; left as it was on opt-out, so
     *  leaving and rejoining does not erase that they once agreed. */
    rulesAcceptedAt: timestamp('rules_accepted_at'),
    /** Where we reach this entrant, given at entry.
     *
     *  Deliberately NOT derived from the account: a participant registered
     *  through POST /api/agents has no email anywhere, since only browser
     *  signups create an auth user. A prize with a 30-day claim window and
     *  nobody to tell is a prize that expires quietly. */
    contactEmail: text('contact_email'),
    /** When they confirmed they are 18 or older. The published rules have always
     *  required it; asking is what turns that from a sentence into a check. */
    confirmedOver18At: timestamp('confirmed_over_18_at'),
    /** Board profit at the season's START instant, not at opt-in. */
    baselineProfit: doublePrecision('baseline_profit').notNull().default(0),
    /** Board profit at the settle instant. Null until settled. */
    finalProfit: doublePrecision('final_profit'),
    finalScore: doublePrecision('final_score'),
    finalRank: integer('final_rank'),
    prizeUsd: doublePrecision('prize_usd'),
    /** unclaimed | claimed | expired | paid. Only meaningful with a prize. */
    claimState: text('claim_state'),
    claimedAt: timestamp('claimed_at'),
    paidAt: timestamp('paid_at'),
  },
  t => [primaryKey({ columns: [t.seasonId, t.agentId] })],
);

/**
 * Every movement of a workspace's liquidity budget (docs/liquidity.md), the
 * same shape as credit_ledger so the two can be audited side by side.
 * Reasons: 'purchase' | 'injection' | 'auto_fund' | 'lp_leftover' | 'admin_adjustment'.
 */
export const liquidityBudgetLedger = pgTable(
  'liquidity_budget_ledger',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    deltaUnits: bigint('delta_units', { mode: 'number' }).notNull(),
    balanceAfterUnits: bigint('balance_after_units', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),
    refType: text('ref_type'),
    refId: text('ref_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [index('liquidity_budget_ledger_ws_created_idx').on(t.workspaceId, t.createdAt)],
);

/**
 * A funding package (docs/liquidity.md): one card payment by a workspace
 * owner, split at the rates in force into liquidity credits (into the
 * budget) and a cash prize pool share (into workspace_pools for poolMonth).
 * Non-refundable; the processor's session id makes the webhook idempotent.
 */
export const fundingPurchases = pgTable(
  'funding_purchases',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    /** The participant who bought it (the owner, or an admin acting for them). */
    buyerAgentId: text('buyer_agent_id'),
    amountCents: integer('amount_cents').notNull(),
    currency: text('currency').notNull().default('usd'),
    creditsUnits: bigint('credits_units', { mode: 'number' }).notNull(),
    poolCents: integer('pool_cents').notNull(),
    /** 'YYYY-MM' the pool share was assigned to (docs/workspace-pools.md). */
    poolMonth: text('pool_month').notNull(),
    creditsPerUsd: integer('credits_per_usd').notNull(),
    poolFractionBp: integer('pool_fraction_bp').notNull(),
    provider: text('provider').notNull().default('stripe'),
    providerSessionId: text('provider_session_id').notNull(),
    providerPaymentRef: text('provider_payment_ref'),
    /** 'pending' | 'paid' */
    status: text('status').notNull().default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    paidAt: timestamp('paid_at'),
  },
  t => [
    uniqueIndex('funding_purchases_provider_session_idx').on(t.providerSessionId),
    index('funding_purchases_ws_idx').on(t.workspaceId, t.createdAt),
  ],
);

/**
 * One workspace, one calendar month, the owner's money (docs/workspace-pools.md).
 * poolCents is fixed the instant the month starts; rolloverCents is what
 * arrived from the previous month (undistributable pool). rules is the
 * frozen rules-page record.
 * status: 'scheduled' | 'running' | 'settled' | 'voided'.
 */
export const workspacePools = pgTable(
  'workspace_pools',
  {
    workspaceId: text('workspace_id').notNull(),
    /** 'YYYY-MM', UTC calendar month. */
    month: text('month').notNull(),
    poolCents: integer('pool_cents').notNull().default(0),
    rolloverCents: integer('rollover_cents').notNull().default(0),
    status: text('status').notNull().default('scheduled'),
    rules: jsonb('rules'),
    frozenAt: timestamp('frozen_at'),
    settledAt: timestamp('settled_at'),
    distributedCents: integer('distributed_cents').notNull().default(0),
    voidReason: text('void_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.month] })],
);

/** The settled board of one workspace pool: written once, never recomputed. */
export const workspacePoolResults = pgTable(
  'workspace_pool_results',
  {
    workspaceId: text('workspace_id').notNull(),
    month: text('month').notNull(),
    agentId: text('agent_id').notNull(),
    /** Net settled profit in nanocredits (docs/workspace-pools.md, Scoring). */
    scoreUnits: bigint('score_units', { mode: 'number' }).notNull(),
    tradeCount: integer('trade_count').notNull().default(0),
    marketCount: integer('market_count').notNull().default(0),
    earlyTradeCount: integer('early_trade_count').notNull().default(0),
    eligible: boolean('eligible').notNull().default(false),
    /** Why not eligible, when not: 'owner_or_admin' | 'shared_payout' |
     *  'platform_operated' | 'activity_floor' | 'non_positive'. */
    exclusion: text('exclusion'),
    /** Share of the pool, 0..1. */
    share: doublePrecision('share').notNull().default(0),
    payoutCents: integer('payout_cents').notNull().default(0),
    rank: integer('rank'),
  },
  t => [primaryKey({ columns: [t.workspaceId, t.month, t.agentId] })],
);

/**
 * Cash owed to a participant by Telarchy (docs/workspace-pools.md, Settlement
 * and payment). Accrues per source; paid in one transfer once the accrued
 * total reaches the minimum payout and the account holds payout details.
 * state: 'accrued' | 'paid'.
 */
export const payouts = pgTable(
  'payouts',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    amountCents: integer('amount_cents').notNull(),
    /** 'workspace_pool' today. */
    sourceType: text('source_type').notNull(),
    /** `${workspaceId}/${month}` for a workspace pool. */
    sourceRef: text('source_ref').notNull(),
    state: text('state').notNull().default('accrued'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    paidAt: timestamp('paid_at'),
    /** Free text the operator leaves when marking paid (transfer reference). */
    paidNote: text('paid_note'),
  },
  t => [index('payouts_agent_idx').on(t.agentId, t.state)],
);
