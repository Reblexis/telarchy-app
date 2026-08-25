export interface TimePreference {
  enabled: boolean; // gates the exponential curve only; custom horizons work independently
  halfLife: number; // in years
  density?: number; // number of market sample points per metric (default 3)
  /** Extra market horizons beyond the curve: "+Nd"|"+Nw"|"+Nm"|"+Ny" (rolling,
   *  re-resolved against today on every refresh) or an absolute "YYYY",
   *  "YYYY-MM", "YYYY-Www", "YYYY-MM-DD" (one-shot, dropped once past). */
  customHorizons?: string[];
}

export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number | null;
  /** Formula result evaluated at "now" (no time-preference projection).
   *  Equals `value` for leaves; for derived metrics it's the formula
   *  evaluated against children's current values. Null when computation
   *  failed upstream. */
  currentTotal?: number | null;
  formula: string;
  order: number;
  depth: number;
  updatedAt?: string;
  timePreference?: TimePreference;
  marketRangeMax?: number;
  baselineTotal?: number;
  timeSeries?: Array<{ date: string; value: number }>;
  conditionalTimeSeries?: Array<{ date: string; value: number }>;
  missingMarkets?: string[];
  inheritedHalfLife?: number;
}

export interface MetricLog {
  metricId: string;
  metricName: string;
  value: number;
  /** Computed outlook (m.total) captured at log time. Null on rows written before migration 0018. */
  outlook: number | null;
  timestamp: Date;
}

export interface UpdateEntry {
  metricName: string;
  oldValue: number;
  newValue: number;
  description: string;
  timestamp: Date;
}

export type AgentRole = 'admin' | 'agent' | 'member' | 'pending';

export interface MetricPermission {
  read: boolean;
  trade: boolean;
}

export type PermissionGroupType = 'public' | 'admin' | 'trader' | 'custom';

export interface SourcePermission {
  read: boolean;
}

export type Capability = 'read' | 'trade' | 'manage' | 'manage_workspace';

/**
 * Vocabulary mirrored from functions/src/lib/scopes.ts. Kept hand-synced with
 * the backend so the API tab UI can render scope checkboxes without a
 * round-trip. Update both when the vocabulary changes.
 */
export const WORKSPACE_SCOPES = ['workspace:read', 'workspace:trade', 'workspace:manage'] as const;
export const ACCOUNT_SCOPES = [
  'account:read',
  'account:write',
  'account:wallet',
  'account:keys',
  'account:agents',
  'account:feedback',
] as const;
export const ALL_KEY_SCOPES = [...WORKSPACE_SCOPES, ...ACCOUNT_SCOPES] as const;
export type WorkspaceScope = (typeof WORKSPACE_SCOPES)[number];
export type AccountScope = (typeof ACCOUNT_SCOPES)[number];
export type KeyScope = WorkspaceScope | AccountScope;
export type ScopeValue = KeyScope | '*';

export const SCOPE_LABELS: Record<KeyScope, { label: string; group: 'Workspace' | 'Account'; help: string }> = {
  'workspace:read': {
    label: 'Read workspace data',
    group: 'Workspace',
    help: 'View metrics, markets, proposals, status, and accessible sources.',
  },
  'workspace:trade': {
    label: 'Place trades',
    group: 'Workspace',
    help: 'Trade on markets, propose proposals, and post proposal messages. Implies workspace:read.',
  },
  'workspace:manage': {
    label: 'Workspace admin',
    group: 'Workspace',
    help: 'Create metrics, resolve markets, edit groups, void markets, and other admin operations. Implies workspace:trade and workspace:read.',
  },
  'account:read': {
    label: 'Read account',
    group: 'Account',
    help: 'Read your own profile and the list of participants you own. Required for /api/auth/me, /api/agents/mine, /api/auth/me/export.',
  },
  'account:write': {
    label: 'Edit account profile',
    group: 'Account',
    help: 'Update your nickname and intent via /api/auth/profile.',
  },
  'account:wallet': {
    label: 'Manage wallet & balance',
    group: 'Account',
    help: 'Set your USDC wallet, deposit, withdraw, and spend on your own ID.',
  },
  'account:keys': {
    label: 'Manage API keys',
    group: 'Account',
    help: 'List, mint, edit, and revoke API keys for your own agent. Cannot be self-elevated: a key cannot grant itself this scope.',
  },
  'account:agents': {
    label: 'Register sub-agents',
    group: 'Account',
    help: 'Create new bot agents owned by you via POST /api/agents.',
  },
  'account:feedback': {
    label: 'Submit feedback',
    group: 'Account',
    help: 'File bug reports, help requests, and feature ideas via POST /api/feedback.',
  },
};

export interface ScopePreset {
  id: 'trader' | 'reader' | 'manager' | 'account' | 'full';
  label: string;
  description: string;
  scopes: string[];
}

export const SCOPE_PRESETS: ScopePreset[] = [
  {
    id: 'trader',
    label: 'Trader',
    description: 'Read workspace data and place trades. The default for bot keys.',
    scopes: ['workspace:read', 'workspace:trade'],
  },
  {
    id: 'reader',
    label: 'Read-only',
    description: 'View workspace data and your own account; no trades, no admin.',
    scopes: ['workspace:read', 'account:read'],
  },
  {
    id: 'manager',
    label: 'Workspace admin',
    description: 'Full workspace access (read, trade, admin operations).',
    scopes: ['workspace:read', 'workspace:trade', 'workspace:manage'],
  },
  {
    id: 'account',
    label: 'Account access',
    description: 'Manage your own account from a script: profile, wallet, register sub-agents, file feedback.',
    scopes: ['account:read', 'account:write', 'account:wallet', 'account:agents', 'account:feedback'],
  },
  {
    id: 'full',
    label: 'Full access',
    description: 'Wildcard. Equivalent to a legacy unrestricted key. Use only when you know you need it.',
    scopes: ['*'],
  },
];

export interface AgentMembershipRequest {
  workspaceId: string;
  groupIds: string[];
}

export interface PermissionGroup {
  id: string;
  name: string;
  type: PermissionGroupType;
  description: string;
  memberIds: string[];
  permissions: Record<string, MetricPermission>;
  sourcePermissions: Record<string, SourcePermission>;
  capabilities: Capability[];
}

export type SourceType = 'text' | 'github';

export interface Source {
  id: string;
  name: string;
  description: string;
  type: SourceType;
  content?: string;
  config: {
    repo?: string;
    defaultBranch?: string;
    [key: string]: unknown;
  };
  createdAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  role: AgentRole;
  authUserId?: string | null;
  balance: number;
  earnedBetting: number;
  spentBetting: number;
  spentTokens: number;
  realizedPnl?: number;
  pnlConsensus?: number;
  pnlMetric?: number;
  createdAt: string;
  approvedAt: string | null;
}

export type MarketStatus = 'open' | 'resolved' | 'voided' | 'closed';

export type ConditionalBranch = 'approved' | 'declined';

export interface Market {
  id: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolved: boolean;
  resolvedAt: string | null;
  actualValue: number | null;
  active: boolean;
  status: MarketStatus;
  createdAt: string;
  consensus: number | null;
  probability: number;
  totalStake: number;
  tradeCount: number;
  rangeMin: number;
  rangeMax: number;
  liquidity: number;
  proposalId?: string;
  /** Set on conditional markets only. 'approved' or 'declined'. */
  branch?: ConditionalBranch;
}

export type ProposalStatus = 'pending' | 'approved' | 'declined';

export interface Proposal {
  id: string;
  proposedBy: string;
  proposedByName?: string | null;
  title: string;
  description: string;
  status: ProposalStatus;
  conditionalMarketIds: string[];
  liquiditySubsidy: number;
  /** Why the owner declined, published permanently on the proposal. Set only
   *  on declined proposals, and required by the backend when the workspace
   *  publishes a charter, since that is what the charter promises. */
  declineReason?: string | null;
  createdAt: string;
}

export interface ProposalMessage {
  id: string;
  proposalId: string;
  from: string;
  fromName?: string | null;
  content: string;
  createdAt: string;
}

/** Per-branch market state inside a paired proposal-market summary. */
export interface BranchMarketSummary {
  marketId: string;
  consensus: number | null;
  liquidity: number;
  tradeCount: number;
  resolved: boolean;
  voided: boolean;
  actualValue: number | null;
}

/**
 * Paired summary for one (metric, targetDate) under a proposal. Both branches
 * plus the natural-trajectory baseline. `delta` is the headline impact:
 * approved.consensus - declined.consensus.
 */
export interface ProposalMarketSummary {
  metricId: string;
  metricName: string;
  targetDate: string;
  resolvesOn: string | null;
  rangeMin: number;
  rangeMax: number;
  approved: BranchMarketSummary | null;
  declined: BranchMarketSummary | null;
  delta: number | null;
  baselineConsensus: number | null;
}

export interface Position {
  id: string;
  agentId: string;
  marketId: string;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}
