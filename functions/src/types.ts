export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number;
  formula: string;
  order: number;
  depth: number;
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
  spentBetting: number;
  spentTokens: number;
  createdAt: FirebaseFirestore.Timestamp;
  approvedAt: FirebaseFirestore.Timestamp | null;
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
}
