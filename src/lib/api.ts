import type { User } from 'firebase/auth';

const API_BASE = import.meta.env.VITE_API_URL || '';

async function request(path: string, user: User, options: RequestInit = {}) {
  const token = await user.getIdToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers as Record<string, string>),
    },
  });
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`API unavailable (${res.status}). Ensure Cloud Functions are deployed.`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API error');
  return data;
}

export const api = {
  getMetrics: (user: User) => request('/api/metrics', user),
  createMetric: (user: User, body: { name: string; description: string; value: number; formula: string; timePreference?: { enabled: boolean; halfLife: number } }) =>
    request('/api/metrics', user, { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (user: User, id: string, body: { name: string; description: string; value: number; formula: string; oldValue: number; updateNote: string; timePreference?: { enabled: boolean; halfLife: number } | null }) =>
    request(`/api/metrics/${id}`, user, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMetric: (user: User, id: string) =>
    request(`/api/metrics/${id}`, user, { method: 'DELETE' }),
  getMetricLogs: (user: User, metricId: string) =>
    request(`/api/metrics/${metricId}/logs`, user),
  getUpdates: (user: User, limit?: number) =>
    request(`/api/updates${limit ? `?limit=${limit}` : ''}`, user),
  getStatus: (user: User) => request('/api/status', user),

  // Agents
  getAgents: (user: User) => request('/api/agents', user),
  approveAgent: (user: User, id: string) =>
    request(`/api/agents/${id}/approve`, user, { method: 'PUT' }),
  setAgentRole: (user: User, id: string, role: string) =>
    request(`/api/agents/${id}/role`, user, { method: 'PUT', body: JSON.stringify({ role }) }),
  creditAgent: (user: User, id: string, amount: number, reason: string, fromAgentId?: string) =>
    request(`/api/agents/${id}/credit`, user, { method: 'POST', body: JSON.stringify({ amount, reason, fromAgentId }) }),
  spendAgent: (user: User, id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, user, { method: 'POST', body: JSON.stringify({ amount, type, reason }) }),
  deleteAgent: (user: User, id: string) =>
    request(`/api/agents/${id}`, user, { method: 'DELETE' }),

  // Markets & Trading
  getMarkets: (user: User) => request('/api/predictions/markets', user),
  getMarketDetail: (user: User, id: string) => request(`/api/predictions/markets/${id}`, user),
  getMarketTrades: (user: User, id: string) => request(`/api/predictions/markets/${id}/trades`, user),
  createMarket: (user: User, metricId: string, targetDate: string) =>
    request('/api/predictions/markets', user, { method: 'POST', body: JSON.stringify({ metricId, targetDate }) }),
  deleteMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}`, user, { method: 'DELETE' }),
  voidMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}/void`, user, { method: 'POST' }),
  resolveMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}/resolve`, user, { method: 'POST' }),
  refreshMarkets: (user: User) =>
    request('/api/predictions/markets/refresh', user, { method: 'POST' }),
  resolvePredictions: (user: User, targetDate?: string) =>
    request('/api/predictions/resolve', user, { method: 'POST', body: JSON.stringify({ targetDate }) }),
  trade: (user: User, body: Record<string, unknown>) =>
    request('/api/predictions/trade', user, { method: 'POST', body: JSON.stringify(body) }),
  getPositions: (user: User, marketId?: string) => {
    const qs = marketId ? `?marketId=${marketId}` : '';
    return request(`/api/predictions/positions${qs}`, user);
  },
  injectLiquidity: (user: User, marketId: string, amount: number) =>
    request(`/api/predictions/markets/${marketId}/liquidity`, user, { method: 'POST', body: JSON.stringify({ amount }) }),

  // Hooks (public, no auth)
  getHooksStatus: async (): Promise<{ active: boolean; lastPolledAt?: string; intervalMs?: number; nextPollAt?: string }> => {
    const res = await fetch(`${API_BASE}/api/events/hooks/status`);
    if (!res.ok) return { active: false };
    return res.json();
  },
};
