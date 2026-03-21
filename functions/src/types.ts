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
  balance: number;
  gifted: number;
  earnedBetting: number;
  earnedTasks?: number;
  spentBetting: number;
  spentTokens: number;
  walletAddress?: string;   // Base network USDC withdrawal address (checksummed)
  withdrawnUsdc?: number;   // total USDC withdrawn on-chain
  createdAt: FirebaseFirestore.Timestamp;
  approvedAt: FirebaseFirestore.Timestamp | null;
}

export interface Withdrawal {
  id: string;
  agentId: string;
  credits: number;
  usdcAmount: number;
  toAddress: string;
  txHash: string;
  createdAt: FirebaseFirestore.Timestamp;
}

export interface Market {
  id: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolved: boolean;
  resolvedAt: FirebaseFirestore.Timestamp | null;
  actualValue: number | null;
  createdAt: FirebaseFirestore.Timestamp;
  rangeMin: number;
  rangeMax: number;
  shares: [number, number]; // [lowerShares, higherShares]
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
  createdAt: FirebaseFirestore.Timestamp;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  from: string;
  content: string;
  createdAt: FirebaseFirestore.Timestamp;
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
  createdAt: FirebaseFirestore.Timestamp;
}

/** @deprecated Kept for migration; new system uses Position + Trade */
export interface Prediction {
  id: string;
  agentId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  predictedValue: number;
  stake: number;
  createdAt: FirebaseFirestore.Timestamp;
  resolved: boolean;
  resolvedAt: FirebaseFirestore.Timestamp | null;
  actualValue: number | null;
  payout: number | null;
}

export interface AuthInfo {
  role: AgentRole | 'admin';
  agentId?: string;
  /** Always set — 'default' for master-key or existing Firebase admin users. */
  workspaceId: string;
  /** Firebase Auth UID, set when authenticated via ID token. */
  uid?: string;
}

export type WorkspaceVisibility = 'public' | 'unlisted' | 'private';
export type WorkspaceMemberRole = 'owner' | 'admin' | 'trader' | 'viewer';

export interface Workspace {
  id: string;
  name: string;
  createdBy: string;
  createdAt: FirebaseFirestore.Timestamp;
  visibility: WorkspaceVisibility;
}

export interface WorkspaceMember {
  role: WorkspaceMemberRole;
  joinedAt: FirebaseFirestore.Timestamp;
}

export interface UserProfile {
  uid: string;
  email: string;
  createdAt: FirebaseFirestore.Timestamp;
  /** Map of workspaceId → membership info */
  workspaces: Record<string, WorkspaceMember>;
}

export interface MetricPermission {
  read: boolean;
  trade: boolean;
}

export interface PermissionGroup {
  id: string;
  name: string;
  /** Agent IDs that belong to this group */
  agentIds: string[];
  /** metricId → permissions */
  permissions: Record<string, MetricPermission>;
}
