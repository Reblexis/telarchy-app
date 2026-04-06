export interface TimePreference {
  enabled: boolean;
  halfLife: number; // in years
}

export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number | null;
  formula: string;
  order: number;
  depth: number;
  timePreference?: TimePreference;
  marketRangeMax?: number;
  timeSeries?: Array<{ date: string; value: number }>;
  missingMarkets?: string[];
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

export type AgentRole = 'admin' | 'agent' | 'pending';

export interface Agent {
  id: string;
  apiKeyHash: string;
  role: AgentRole;
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
  role: AgentRole | 'admin';
  /** Canonical participant identity, stored in the agents table. */
  agentId?: string;
  /** Always set. 'default' for master-key or existing Firebase admin users. */
  workspaceId: string;
  /** BetterAuth user ID, set when authenticated via browser session. */
  uid?: string;
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

export type PermissionGroupType = 'public' | 'admin' | 'custom';

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
}
