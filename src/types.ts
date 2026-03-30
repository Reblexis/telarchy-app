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
  baselineTotal?: number;
  timeSeries?: Array<{ date: string; value: number }>;
  conditionalTimeSeries?: Array<{ date: string; value: number }>;
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

export type GraphInterval = 'day' | 'week' | 'month' | 'year';

export type AgentRole = 'admin' | 'agent' | 'pending';

export interface MetricPermission {
  read: boolean;
  trade: boolean;
}

export type PermissionGroupType = 'public' | 'admin' | 'custom';

export interface PermissionGroup {
  id: string;
  name: string;
  type: PermissionGroupType;
  description: string;
  agentIds: string[];
  uids: string[];
  permissions: Record<string, MetricPermission>;
}

export interface Agent {
  id: string;
  role: AgentRole;
  balance: number;
  earnedBetting: number;
  earnedTasks?: number;
  spentBetting: number;
  spentTokens: number;
  createdAt: string;
  approvedAt: string | null;
}

export interface Market {
  id: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolved: boolean;
  resolvedAt: string | null;
  actualValue: number | null;
  active: boolean;
  createdAt: string;
  consensus: number | null;
  probability: number;
  totalStake: number;
  tradeCount: number;
  rangeMin: number;
  rangeMax: number;
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
  createdAt: string;
}

export interface TaskMessage {
  id: string;
  taskId: string;
  from: string;
  content: string;
  createdAt: string;
}

export interface TaskMarketSummary {
  marketId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  consensus: number | null;
  baselineConsensus?: number | null;
  rangeMin: number;
  rangeMax: number;
  liquidity: number;
  tradeCount: number;
}

export interface TaskUtilitySummary {
  expectedCurrentUtility: number | null;
  baselineUtility: number | null;
}

export interface TaskDetailData extends TaskProposal {
  markets?: TaskMarketSummary[];
  utilitySummary?: TaskUtilitySummary;
}

export interface Position {
  id: string;
  agentId: string;
  marketId: string;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}

export interface LiquidityEvent {
  id: string;
  amount: number;
  totalLiquidity: number;
  type: 'initial' | 'injection';
  createdAt: unknown;
}

export interface TradePoint {
  consensus: number | null;
  createdAt: { _seconds: number } | null;
  agentId?: string;
  direction?: 'higher' | 'lower';
  shares?: number;
  cost?: number;
}
