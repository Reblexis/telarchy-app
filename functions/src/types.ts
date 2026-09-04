export interface TimePreference {
  enabled: boolean; // gates the exponential curve only; custom horizons work independently
  halfLife: number; // in years
  density?: number; // number of market sample points per metric (default 3)
  /** Extra market horizons beyond the curve: "+Nd"|"+Nw"|"+Nm"|"+Ny" (rolling,
   *  re-resolved against today on every refresh) or an absolute "YYYY",
   *  "YYYY-MM", "YYYY-Www", "YYYY-MM-DD" (one-shot, dropped once past). */
  customHorizons?: string[];
  /** What each entry of customHorizons opens with, in credits, paid by the
   *  workspace owner as the market opens and again every time a rolling
   *  entry comes round: `book` for the metric's own market (null or absent
   *  falls back to the metric's liquidityCredits, then the workspace default)
   *  and `proposal` for a proposal's branch on that date (absent is 0: the
   *  proposer funds their own; docs/guides/proposals.md). */
  horizonCredits?: Record<string, HorizonCredits>;
}

export interface HorizonCredits {
  book?: number | null;
  proposal?: number;
}

export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number | null;
  /** The metric's value evaluated at "now" (formula result with no time-
   *  preference projection applied). For leaves this equals `value`; for
   *  derived metrics it's the formula evaluated against children's current
   *  values. Null when an upstream computation failed. */
  currentTotal?: number | null;
  formula: string;
  order: number;
  depth: number;
  updatedAt?: string;
  timePreference?: TimePreference;
  marketRangeMax?: number;
  /** Markets void (N/A) while the metric has no logged reading; see schema. */
  resolvesNaUntilMeasured?: boolean;
  /** How long after a period the number is final, in minutes (docs/guides/sources.md). */
  settlementLagMinutes?: number;
  /** Credits a new book on this metric opens with; null means the workspace default. */
  liquidityCredits?: number | null;
  timeSeries?: Array<{ date: string; value: number }>;
  missingMarkets?: string[];
  /** Half-life inherited from the nearest TP-enabled ancestor. Set on descendants
   *  so the chart can render the decay overlay even though the descendant itself
   *  has no time preference of its own. */
  inheritedHalfLife?: number;
}

export interface MetricLog {
  metricId: string;
  metricName: string;
  value: number;
  /** Computed outlook (m.total) captured at log time. NULL for rows written before migration 0018. */
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

/**
 * Atomic permissions granted to a participant (via union of their groups' capabilities).
 * Group names/types are just labels — they do not directly grant access. Capabilities do.
 */
export type Capability = 'read' | 'trade' | 'manage' | 'manage_workspace';
export const ALL_CAPABILITIES: Capability[] = ['read', 'trade', 'manage', 'manage_workspace'];

export interface Agent {
  id: string;
  apiKeyHash: string;
  authUserId?: string | null;
  balance: number;
  earnedBetting: number;
  spentBetting: number;
  spentTokens: number;
  walletAddress?: string;
  withdrawnUsdc?: number;
  createdAt: Date;
  approvedAt: Date | null;
}

export interface Withdrawal {
  id: string;
  agentId: string;
  credits: number;
  usdcAmount: number;
  toAddress: string;
  txHash: string;
  createdAt: Date;
}

export interface Market {
  id: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolved: boolean;
  resolvedAt: Date | null;
  actualValue: number | null;
  createdAt: Date;
  rangeMin: number;
  rangeMax: number;
  shares: [number, number];
  liquidity: number;
  proposalId?: string;
}

export type ProposalStatus = 'pending' | 'approved' | 'declined';

export interface Proposal {
  id: string;
  proposedBy: string;
  title: string;
  description: string;
  status: ProposalStatus;
  conditionalMarketIds: string[];
  createdAt: Date;
}

export interface ProposalMessage {
  id: string;
  proposalId: string;
  from: string;
  content: string;
  createdAt: Date;
}

export interface Position {
  id: string;
  agentId: string;
  marketId: string;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

export interface Trade {
  id: string;
  agentId: string;
  marketId: string;
  direction: 'higher' | 'lower';
  shares: number;
  cost: number;
  createdAt: Date;
}

export interface AuthInfo {
  /** Union of capabilities granted by all permission groups the caller belongs to
   *  in the active workspace. Master API key receives all capabilities. For
   *  agent-key callers this is already intersected with the key's scopes; for
   *  browser sessions and master keys, scopes don't apply. */
  capabilities: Set<Capability>;
  /** Canonical participant identity, stored in the agents table. */
  agentId?: string;
  /** Always set. Determined by auth context (session, API key, or agent key). */
  workspaceId: string;
  /** BetterAuth user ID, set when authenticated via browser session. */
  uid?: string;
  /** True when authenticated via the master API key (no real identity). */
  isMasterKey?: boolean;
  /** Per-key scopes (only set for agent-key auth). Wildcard ['*'] means full
   *  access. requireScope() consults this to gate account/identity endpoints;
   *  intersectWorkspaceCaps() consults it to gate workspace endpoints. */
  scopes?: string[];
  /** Public handle of the agent_api_keys row that resolved this request. Set
   *  for agent-key auth so routes can self-report which key authorized them. */
  keyId?: string;
}

export type WorkspaceVisibility = 'public' | 'unlisted' | 'private';
export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  createdBy: string;
  createdAt: Date;
  visibility: WorkspaceVisibility;
  tradedVolume?: number;
}

export interface WorkspaceMember {
  role: WorkspaceMemberRole;
  joinedAt: Date;
}

export interface UserProfile {
  uid: string;
  email: string;
  createdAt: Date;
  workspaces: Record<string, WorkspaceMember>;
}

export interface MetricPermission {
  read: boolean;
  trade: boolean;
}

export type PermissionGroupType = 'public' | 'admin' | 'trader' | 'custom';

export interface SourcePermission {
  read: boolean;
}

export type SourceType = 'text' | 'github';

export interface PermissionGroup {
  id: string;
  name: string;
  type: PermissionGroupType;
  /** Shown to all agents */
  description: string;
  /** Canonical participant IDs that belong to this group. */
  memberIds: string[];
  /** metricId → permissions */
  permissions: Record<string, MetricPermission>;
  /** sourceId → permissions (covers text sources and external bridges uniformly) */
  sourcePermissions: Record<string, SourcePermission>;
  /** Capabilities granted to all members of this group. */
  capabilities: Capability[];
}

export interface Source {
  id: string;
  name: string;
  description: string;
  type: SourceType;
  /** Text content for type='text'; empty otherwise. */
  content: string;
  /** Provider-specific config for external bridges (e.g. GitHub: repo, defaultBranch, installationId). */
  config: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
