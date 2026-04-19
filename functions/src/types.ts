export interface TimePreference {
  enabled: boolean;
  halfLife: number; // in years
}

export interface Metric {
  id: string;
  name: string;
  description: string;
  question: string;
  value: number;
  total: number | null;
  formula: string;
  order: number;
  depth: number;
  updatedAt?: string;
  timePreference?: TimePreference;
  marketRangeMax?: number;
  checkInIntervalDays?: number;
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
export type Capability = 'read' | 'trade' | 'manage';
export const ALL_CAPABILITIES: Capability[] = ['read', 'trade', 'manage'];

export interface Agent {
  id: string;
  apiKeyHash: string;
  authUserId?: string | null;
  balance: number;
  earnedBetting: number;
  earnedTasks?: number;
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
  taskId?: string;
}

export type TaskStatus = 'pending' | 'approved' | 'declined';

export interface TaskProposal {
  id: string;
  proposedBy: string;
  title: string;
  description: string;
  price: number;
  status: TaskStatus;
  conditionalMarketIds: string[];
  createdAt: Date;
}

export interface TaskMessage {
  id: string;
  taskId: string;
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
   *  in the active workspace. Master API key receives all capabilities. */
  capabilities: Set<Capability>;
  /** Canonical participant identity, stored in the agents table. */
  agentId?: string;
  /** Always set. Determined by auth context (session, API key, or agent key). */
  workspaceId: string;
  /** BetterAuth user ID, set when authenticated via browser session. */
  uid?: string;
  /** True when authenticated via the master API key (no real identity). */
  isMasterKey?: boolean;
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

export interface VaultPermission {
  read: boolean;
}

export interface ConnectorPermission {
  read: boolean;
}

export interface Connector {
  id: string;
  name: string;
  provider: string;
  providerConfig: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

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
  /** vaultId → permissions */
  vaultPermissions: Record<string, VaultPermission>;
  /** connectorId → permissions */
  connectorPermissions: Record<string, ConnectorPermission>;
  /** Capabilities granted to all members of this group. */
  capabilities: Capability[];
}

export interface Vault {
  id: string;
  name: string;
  description: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}
