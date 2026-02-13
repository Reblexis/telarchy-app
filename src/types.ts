export interface Metric {
  id: string;
  name: string;
  description: string;
  value: number;
  total: number;
  formula: string;
  decay: boolean;
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
  createdAt: string;
  consensus: number | null;
  totalStake: number;
  predictionCount: number;
}

export interface Prediction {
  id: string;
  agentId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  predictedValue: number;
  stake: number;
  createdAt: string;
  resolved: boolean;
  resolvedAt: string | null;
  actualValue: number | null;
  payout: number | null;
}
