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

export interface AuthInfo {
  role: AgentRole | 'admin';
  agentId?: string;
}
