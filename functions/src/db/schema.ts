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
  /** Bounty paid by workspace owner to proposer when a proposal is approved. 0 = no reward. */
  proposalReward: doublePrecision('proposal_reward').notNull().default(0),
  /** Penalty deducted from proposer (paid to workspace owner) when a proposal is declined as spam. 0 = no penalty. */
  spamPenalty: doublePrecision('spam_penalty').notNull().default(0),
  /** Per-participant cap on simultaneously pending proposals in this workspace. 0 disables the cap. */
  maxPendingProposalsPerParticipant: integer('max_pending_proposals').notNull().default(0),
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
    /** The SECOND currency (owner decision 2026-08-28): liquidity credits,
     *  bought with real money, spendable ONLY as market-pool injections.
     *  Nanocredits like `balance`. Walled both ways: purchases land here and
     *  nowhere else, and LP leftovers from wallet-funded injections return
     *  here, never to the tradeable balance - that wall is what keeps a
     *  liquidity purchase a service rather than a credit sale
     *  (docs/liquidity-purchases.md). */
    liquidityBalance: bigint('liquidity_balance', { mode: 'number' }).notNull().default(0),
    /** Whether the TRADEABLE balance may fund market pools once the
     *  liquidity wallet is empty (owner ask 2026-08-30). The wallet is
     *  always spent first; this only says what happens after it runs out.
     *  Default true, which is what every account did before the setting
     *  existed. */
    poolFromBalance: boolean('pool_from_balance').notNull().default(true),
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
    /**
     * When true, `workspaceId` above is the key's whole reach rather than a
     * default: a request carrying X-Workspace-Id for anything else is refused.
     * What "only on this market" mints on the market page
     * (docs/owner-on-the-floor.md, "Handing it to your own agent"), so a leaked
     * key reaches one market instead of every market its owner belongs to.
     */
    workspaceLocked: boolean('workspace_locked').notNull().default(false),
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
    /**
     * How long after a period this number is final, in minutes. A monthly
     * total that needs three days of refunds to be true says 4320, and its
     * markets settle then rather than at midnight on the 30th, when the number
     * cannot exist yet (owner ask 2026-08-31). The market it settles on is
     * still the last reading at or before the PERIOD END, so the lag buys the
     * time to report and never moves which period is being priced.
     */
    settlementLagMinutes: integer('settlement_lag_minutes').notNull().default(0),
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
    /**
     * Credits a new market on this metric opens with (docs/owner-on-the-floor.md).
     * NULL falls back to the workspace's `newMarketLiquidityCredits`, which is
     * what every metric did before the owner could say otherwise. Credits, not
     * a weight: the owner reads a pool in credits, so the control and the thing
     * it moves share a unit.
     */
    liquidityCredits: doublePrecision('liquidity_credits'),
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
    /**
     * The timestamp of the reading this market settled on: the last one at or
     * before its resolution instant, which is what the fixing uses
     * (docs/guides/sources.md). Kept so the settlement can say how old that
     * reading was, permanently, rather than leaving a trader to work it out
     * from two logs. Null on anything not settled, and on everything settled
     * before 2026-08-31.
     */
    /**
     * When this market settles: the end of its period plus the metric's
     * reporting lag at the moment it opened (docs/guides/sources.md). Stamped
     * at creation rather than derived, so changing a metric's lag can never
     * move the settlement of a market people are already trading. Null on
     * markets opened before 2026-08-31, which settle at their period end.
     */
    settlesAt: timestamp('settles_at'),
    settledReadingAt: timestamp('settled_reading_at'),
    /** When the owner was last emailed that this market was about to settle on
     *  a stale reading. Dedupe for that mail and nothing else. */
    staleNoticeAt: timestamp('stale_notice_at'),
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
    /**
     * 'trade' (a buy or a sell against the AMM, the sign of `shares` says
     * which) or 'redeem' (one side of a matched-pair redemption).
     *
     * A redemption writes two rows, one per side, because the price replay
     * rebuilds the book by walking this table and a change to markets.shares
     * with no rows behind it replays as a different market. Those rows are
     * bookkeeping, not something the trader did: they move no price and have
     * no counterparty. Every list a person reads keys off this column, so a
     * redemption is never rendered as a sell nobody placed.
     */
    kind: text('kind').notNull().default('trade'),
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
    /** Agent who provided liquidity (null for initial platform liquidity) */
    agentId: text('agent_id'),
    /** Which purse funded it: 'balance' | 'liquidity' (the bought wallet).
     *  Null on rows that predate the wallet, which read as 'balance'. LP
     *  leftovers are routed back to the purse they came from. */
    fundedFrom: text('funded_from'),
    poolContribution: doublePrecision('pool_contribution'),
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

/**
 * The earn table: every way to receive free credits, with its price
 * (owner decision 2026-08-30). The operator edits it live, mid-season
 * included, because Season 0's published rules reserve that right and
 * because pricing a signal correctly is the whole anti-farming strategy:
 * a grant priced at what the account genuinely brings turns sybil farming
 * from an attack into a purchase (design record in the telarchy umbrella,
 * notes/earn-table-design-2026-08-30.md).
 *
 * `credits` is a flat grant when `kind` is 'flat' and a ceiling on a
 * measured signal when it is 'cap' (the Manifold import).
 */
export const earnRules = pgTable('earn_rules', {
  key: text('key').primaryKey(),
  label: text('label').notNull(),
  credits: doublePrecision('credits').notNull(),
  /** 'flat' | 'cap' */
  kind: text('kind').notNull().default('flat'),
  enabled: boolean('enabled').notNull().default(true),
  /** What the operator is paying for, in their words. Published, because
   *  an entrant is entitled to read how credits are earned. */
  note: text('note').notNull().default(''),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by'),
});

/**
 * What each participant has already earned, and what external thing
 * proved it (owner ask 2026-08-30).
 *
 * Two uniqueness rules carry the whole anti-farming weight, both enforced
 * in the database rather than in code, because a race between two link
 * requests is exactly when a check-then-write would pay twice:
 *
 *  - (agent_id, key, period): one earn per participant per period. Every
 *    one-time earn uses period '', so for those it reads "ever"; the
 *    daily streak uses the UTC date, which is what makes it recurring.
 *  - (key, ref_id): one external account pays once ACROSS THE PLATFORM.
 *    Without it a single Google account funds ten Telarchy accounts.
 */
export const earnClaims = pgTable(
  'earn_claims',
  {
    id: text('id').primaryKey(),
    agentId: text('agent_id').notNull(),
    key: text('key').notNull(),
    /** The provider account id or Manifold user id that was proved; null
     *  for earns that prove nothing external. */
    refId: text('ref_id'),
    /** What was actually paid, which is the price on the day it was
     *  claimed, not today's price. */
    credits: doublePrecision('credits').notNull(),
    /** Which occurrence of a recurring earn this is: the UTC date for the
     *  daily streak, '' for every earn that can only happen once. */
    period: text('period').notNull().default(''),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [uniqueIndex('earn_claims_agent_key_period_idx').on(t.agentId, t.key, t.period)],
);

/**
 * Every version of every rule, append-only. A table that decides who
 * receives money has to be able to answer "what did it say the day this
 * account was funded?", and a rule changed mid-season must stay
 * reconstructable afterwards.
 */
export const earnRuleHistory = pgTable(
  'earn_rule_history',
  {
    id: text('id').primaryKey(),
    key: text('key').notNull(),
    credits: doublePrecision('credits').notNull(),
    kind: text('kind').notNull(),
    enabled: boolean('enabled').notNull(),
    note: text('note').notNull().default(''),
    changedAt: timestamp('changed_at').notNull().defaultNow(),
    changedBy: text('changed_by'),
  },
  t => [index('earn_rule_history_key_idx').on(t.key, t.changedAt)],
);

/**
 * One paid liquidity purchase (Stripe Checkout): the only path by which
 * real money enters the managed instance. `status` walks pending ->
 * completed; fulfilment (the webhook) allocates `credits` evenly across the
 * workspace's open markets, records the split in `allocation`
 * ({ marketId: credits }), and is idempotent on both the row status and the
 * session id. Completed rows are the platform's liquidity revenue, which
 * sizes the next season's pool (docs/liquidity-purchases.md).
 */
export const liquidityPurchases = pgTable('liquidity_purchases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  /** The purchasing account. Under strict season eligibility a purchaser is
   *  a workspace operator and takes no season payout, which is what keeps
   *  the purchase a service rather than contest consideration. */
  agentId: text('agent_id').notNull(),
  usdAmount: doublePrecision('usd_amount').notNull(),
  credits: doublePrecision('credits').notNull(),
  /** The rate at purchase time, so a later price change never rewrites an
   *  old row's meaning. */
  creditsPerUsd: doublePrecision('credits_per_usd').notNull(),
  stripeSessionId: text('stripe_session_id'),
  /** 'pending' | 'completed' */
  status: text('status').notNull().default('pending'),
  allocation: jsonb('allocation'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  completedAt: timestamp('completed_at'),
});

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
  /** Total promised, in USD. No ceiling: a deterministic skill-scored payout
   *  needs no sweepstakes registration at any size (the old sub-5000 rule was
   *  the NY/FL chance-sweepstakes bonding line and never applied to a skill
   *  contest; retired 2026-08-28, design record in the telarchy umbrella,
   *  notes/wheel-vs-proportional-legality-2026-08-28.md). */
  poolUsd: doublePrecision('pool_usd').notNull(),
  /** 'ladder' pays the published rungs by place; 'proportional' splits the
   *  pool by positive settled score (lib/seasons.ts, THE PAYOUT). Existing
   *  rows default to 'ladder', the only mode that existed before. */
  payoutMode: text('payout_mode').notNull().default('ladder'),
  /** Proportional mode: a computed share below this is not paid and rolls
   *  forward, because a $0.40 prize costs more to send than it is worth. */
  minPayoutUsd: doublePrecision('min_payout_usd').notNull().default(0),
  /** The two platform rules for seasons after Season 0 (lib/seasons.ts,
   *  SettleOptions.strictEligibility): public-workspace operators take no
   *  payout, and entries sharing a payout handle collapse to one. Default
   *  on for new seasons; migration 0082 sets Season 0 (and every
   *  pre-existing row) off, because its published rules made owners
   *  explicitly eligible (amendment of 2026-08-25). */
  strictEligibility: boolean('strict_eligibility').notNull().default(true),
  /** Published ladder, [{ place, prizeUsd }, ...]. Frozen once running.
   *  Empty for a proportional season. */
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
 * One row per (participant, workspace, Idempotency-Key) that placed a trade.
 *
 * The callers here are bots, so a timed-out request is retried automatically
 * and unattended. Without this, the retry buys again, on a curve the first
 * attempt already moved, and the participant pays twice for one decision; not
 * retrying leaves it unsure whether it holds a position. Neither shows up as
 * an error, which is why the cost of it was invisible.
 *
 * The key is the CALLER's, so it is scoped by participant and workspace: "1"
 * is a key someone will pick, and two participants picking it must not collide.
 * `requestHash` is the canonicalised body, so the same key with a different
 * body is a mistake worth refusing rather than a replay worth serving. Only a
 * committed trade writes a row, so a call that failed leaves the key free for
 * a real retry.
 */
export const tradeIdempotency = pgTable(
  'trade_idempotency',
  {
    agentId: text('agent_id').notNull(),
    workspaceId: text('workspace_id').notNull(),
    /** The caller's Idempotency-Key header, verbatim. */
    key: text('key').notNull(),
    /** SHA-256 of the canonicalised request body, to catch a reused key. */
    requestHash: text('request_hash').notNull(),
    /** The exact 201 body the first call returned, replayed to duplicates. */
    response: jsonb('response').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  t => [
    primaryKey({ columns: [t.agentId, t.workspaceId, t.key] }),
    // For the pruning job: these rows are only useful for as long as a client
    // might still be retrying.
    index('trade_idempotency_created_idx').on(t.createdAt),
  ],
);
