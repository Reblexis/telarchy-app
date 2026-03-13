export interface TimePreference {
  enabled: boolean;
  halfLife: number; // in years
}

export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number;
  formula: string;
  order: number;
  depth: number;
  timePreference?: TimePreference;
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

export interface FirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
}

export type GraphInterval = 'day' | 'week' | 'month' | 'year';

export type AgentRole = 'admin' | 'agent' | 'pending';

export interface Agent {
  id: string;
  role: AgentRole;
  balance: number;
  gifted: number;
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
  consensus: number | null;
  probability: number;
  rangeMin: number;
  rangeMax: number;
  tradeCount: number;
}

export interface Position {
  id: string;
  agentId: string;
  marketId: string;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
}
