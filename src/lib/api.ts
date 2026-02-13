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
  createMetric: (user: User, body: { name: string; description: string; value: number; formula: string; decay: boolean }) =>
    request('/api/metrics', user, { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (user: User, id: string, body: { name: string; description: string; value: number; formula: string; decay: boolean; oldValue: number; updateNote: string }) =>
    request(`/api/metrics/${id}`, user, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMetric: (user: User, id: string) =>
    request(`/api/metrics/${id}`, user, { method: 'DELETE' }),
  getMetricLogs: (user: User, metricId: string) =>
    request(`/api/metrics/${metricId}/logs`, user),
  getUpdates: (user: User, limit?: number) =>
    request(`/api/updates${limit ? `?limit=${limit}` : ''}`, user),
  getStatus: (user: User) => request('/api/status', user),
  triggerDecay: (user: User) => request('/api/decay', user, { method: 'POST' }),

  // Agents
  getAgents: (user: User) => request('/api/agents', user),
  approveAgent: (user: User, id: string) =>
    request(`/api/agents/${id}/approve`, user, { method: 'PUT' }),
  setAgentRole: (user: User, id: string, role: string) =>
    request(`/api/agents/${id}/role`, user, { method: 'PUT', body: JSON.stringify({ role }) }),
  creditAgent: (user: User, id: string, amount: number, reason: string) =>
    request(`/api/agents/${id}/credit`, user, { method: 'POST', body: JSON.stringify({ amount, reason }) }),
  spendAgent: (user: User, id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, user, { method: 'POST', body: JSON.stringify({ amount, type, reason }) }),
  deleteAgent: (user: User, id: string) =>
    request(`/api/agents/${id}`, user, { method: 'DELETE' }),

  // Predictions & Markets
  getPredictions: (user: User, params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/api/predictions${qs}`, user);
  },
  getMarkets: (user: User) => request('/api/predictions/markets', user),
  createMarket: (user: User, metricId: string, targetDate: string) =>
    request('/api/predictions/markets', user, { method: 'POST', body: JSON.stringify({ metricId, targetDate }) }),
  deleteMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}`, user, { method: 'DELETE' }),
  resolvePredictions: (user: User, targetDate?: string) =>
    request('/api/predictions/resolve', user, { method: 'POST', body: JSON.stringify({ targetDate }) }),
};
