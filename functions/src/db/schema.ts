import {
  pgTable, text, boolean, integer, bigint, doublePrecision,
  timestamp, jsonb, primaryKey, uniqueIndex,
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
});

export const authSession = pgTable('session', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
});

export const authAccount = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => authUser.id, { onDelete: 'cascade' }),
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
  createdBy: text('created_by').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
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
  /** Per-participant cap on simultaneously pending proposals in this workspace. */
  maxPendingProposalsPerParticipant: integer('max_pending_proposals').notNull().default(3),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents = pgTable('agents', {
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
  /**
   * Optional case-insensitive unique handle. Either signup path (human auth,
   * API register) may claim one. Uniqueness is enforced by a partial unique
   * index on LOWER(nickname); see migration 0020.
   */
  nickname: text('nickname'),
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  approvedAt: timestamp('approved_at'),
}, t => [uniqueIndex('agents_auth_user_id_idx').on(t.authUserId)]);

export const agentApiKeys = pgTable('agent_api_keys', {
  hash: text('hash').primaryKey(),
  /** Opaque public handle (uuid). Used in management URLs so the hash never leaves the DB. */
  keyId: text('key_id').notNull(),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
  /** Optional human label shown in the management UI. */
  label: text('label'),
  /** Per-key permission set. Vocabulary lives in lib/scopes.ts. Default '{*}' = full access. */
  scopes: text('scopes').array().notNull().default(['*']),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  /** Bumped (debounced) by the auth middleware on every successful key resolve. */
  lastUsedAt: timestamp('last_used_at'),
}, t => [uniqueIndex('agent_api_keys_key_id_idx').on(t.keyId)]);

// ---------------------------------------------------------------------------
// Waitlist
// ---------------------------------------------------------------------------

export const waitlist = pgTable('waitlist', {
  email: text('email').primaryKey(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Deposits & Withdrawals
// ---------------------------------------------------------------------------

export const deposits = pgTable('deposits', {
  txHash: text('tx_hash').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  from: text('from').notNull(),
  usdcAmount: doublePrecision('usdc_amount').notNull(),
  credits: doublePrecision('credits').notNull(),
  buyRate: doublePrecision('buy_rate').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const withdrawals = pgTable('withdrawals', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull().references(() => agents.id),
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

export const metrics = pgTable('metrics', {
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const markets = pgTable('markets', {
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
  /** Flagged for the public benchmark surface (/benchmark + /api/marketplace/featured). */
  featured: boolean('featured').notNull().default(false),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const positions = pgTable('positions', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  marketId: text('market_id').notNull(),
  /** 'higher' | 'lower' */
  direction: text('direction').notNull(),
  shares: doublePrecision('shares').notNull(),
  totalCost: doublePrecision('total_cost').notNull(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const trades = pgTable('trades', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  agentId: text('agent_id').notNull().references(() => agents.id),
  marketId: text('market_id').notNull(),
  /** 'higher' | 'lower' */
  direction: text('direction').notNull(),
  shares: doublePrecision('shares').notNull(),
  cost: doublePrecision('cost').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const liquidityEvents = pgTable('liquidity_events', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  marketId: text('market_id').notNull(),
  amount: doublePrecision('amount').notNull(),
  totalLiquidity: doublePrecision('total_liquidity').notNull(),
  /** 'initial' | 'injection' */
  type: text('type').notNull(),
  /** Agent who provided liquidity (null for initial platform liquidity) */
  agentId: text('agent_id'),
  poolContribution: doublePrecision('pool_contribution'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const proposals = pgTable('proposals', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  proposedBy: text('proposed_by').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  /** 'pending' | 'approved' | 'declined' | 'declined_spam' | 'withdrawn' */
  status: text('status').notNull().default('pending'),
  conditionalMarketIds: jsonb('conditional_market_ids').notNull().$type<string[]>().default([]),
  /** Per-market credit subsidy seeded into each conditional market's pool at creation. */
  liquiditySubsidy: doublePrecision('liquidity_subsidy').notNull().default(0),
  /** Reward credits actually paid out on approval. 0 if not approved or workspace had no reward configured. */
  rewardPaid: doublePrecision('reward_paid').notNull().default(0),
  /** Penalty credits actually charged on spam-decline. 0 if not declined as spam. */
  penaltyCharged: doublePrecision('penalty_charged').notNull().default(0),
  /** Set when status leaves 'pending'. */
  resolvedAt: timestamp('resolved_at'),
  /** Participant id who approved/declined/spam-declined; equals proposedBy on withdraw. */
  resolvedBy: text('resolved_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const proposalMessages = pgTable('proposal_messages', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  proposalId: text('proposal_id').notNull(),
  from: text('from').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const marketMessages = pgTable('market_messages', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  marketId: text('market_id').notNull(),
  from: text('from').notNull(),
  content: text('content').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const updates = pgTable('updates', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  metricName: text('metric_name').notNull(),
  oldValue: doublePrecision('old_value').notNull(),
  newValue: doublePrecision('new_value').notNull(),
  description: text('description').notNull().default(''),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const metricLogs = pgTable('metric_logs', {
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
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const events = pgTable('events', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  type: text('type').notNull(),
  data: jsonb('data').notNull(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const permissionGroups = pgTable('permission_groups', {
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
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

// ---------------------------------------------------------------------------
// Sources (workspace-scoped information stores, static or live)
// type='text': free-text content stored in `content`.
// type='github' (etc.): external bridge, config in `config`, optional opaque
//   credentials in `credentials` (never exposed via API).
// ---------------------------------------------------------------------------

export const sources = pgTable('sources', {
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
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

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

export const agentTraces = pgTable('agent_traces', {
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
});

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
