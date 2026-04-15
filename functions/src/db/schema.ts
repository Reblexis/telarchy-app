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
  /** When true, new non-task markets debit the workspace owner's agent balance per newMarketLiquidityCredits. */
  autoFundNewMarkets: boolean('auto_fund_new_markets').notNull().default(false),
  /** Pool contribution (credits) per new market when auto-fund is on. */
  newMarketLiquidityCredits: doublePrecision('new_market_liquidity_credits').notNull().default(0),
});

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export const agents = pgTable('agents', {
  id: text('id').primaryKey(),
  apiKeyHash: text('api_key_hash').notNull(),
  /** BetterAuth user ID for browser-authenticated participants. */
  authUserId: text('auth_user_id').references(() => authUser.id, { onDelete: 'set null' }),
  /** Balance in nanocredits (1 credit = 1_000_000_000 units) */
  balance: bigint('balance', { mode: 'number' }).notNull().default(0),
  earnedBetting: doublePrecision('earned_betting').notNull().default(0),
  spentBetting: doublePrecision('spent_betting').notNull().default(0),
  spentTokens: doublePrecision('spent_tokens').notNull().default(0),
  earnedTasks: doublePrecision('earned_tasks').notNull().default(0),
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
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull(),
});

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
  /** { enabled: boolean, halfLife: number } | null */
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
  taskId: text('task_id'),
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

export const tasks = pgTable('tasks', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  proposedBy: text('proposed_by').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  price: doublePrecision('price').notNull(),
  /** 'pending' | 'approved' | 'declined' */
  status: text('status').notNull().default('pending'),
  conditionalMarketIds: jsonb('conditional_market_ids').notNull().$type<string[]>().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

export const taskMessages = pgTable('task_messages', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  taskId: text('task_id').notNull(),
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
  value: doublePrecision('value').notNull(),
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
  /** vaultId → { read: boolean } */
  vaultPermissions: jsonb('vault_permissions').notNull().$type<Record<string, { read: boolean }>>().default({}),
  /** Capabilities granted to every member of this group: subset of 'read' | 'trade' | 'manage'. */
  capabilities: jsonb('capabilities').notNull().$type<string[]>().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.id, t.workspaceId] })]);

// ---------------------------------------------------------------------------
// Vaults (workspace-scoped information store)
// ---------------------------------------------------------------------------

export const vaults = pgTable('vaults', {
  id: text('id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  content: text('content').notNull().default(''),
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
