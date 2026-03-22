import type { User } from 'firebase/auth';

export interface MarketplaceListing {
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  metricName: string;
  targetDate: string;
  consensus: number | null;
  probability: number;
  liquidity: number;
  rangeMin: number;
  rangeMax: number;
}

const API_BASE = import.meta.env.VITE_API_URL || '';

let activeWorkspaceId: string | null = localStorage.getItem('activeWorkspaceId');

async function agentRequest(path: string, apiKey: string, options: RequestInit = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-Agent-Key': apiKey,
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

export const agentApi = {
  register: async (agentId: string): Promise<{ agentId: string; apiKey: string }> => {
    const res = await fetch(`${API_BASE}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Registration failed');
    return data;
  },
  getProfile: (agentId: string, apiKey: string) =>
    agentRequest(`/api/agents/${agentId}`, apiKey),
  getDashboard: (agentId: string, apiKey: string) =>
    agentRequest(`/api/agents/${agentId}/dashboard`, apiKey),
  getMarkets: (agentId: string, apiKey: string) =>
    agentRequest('/api/predictions/markets', apiKey),
  getPositions: (agentId: string, apiKey: string, marketId?: string) => {
    const qs = marketId ? `?marketId=${marketId}` : '';
    return agentRequest(`/api/predictions/positions${qs}`, apiKey);
  },
  trade: (agentId: string, apiKey: string, body: Record<string, unknown>) =>
    agentRequest('/api/predictions/trade', apiKey, { method: 'POST', body: JSON.stringify(body) }),
  setWallet: (agentId: string, apiKey: string, walletAddress: string) =>
    agentRequest(`/api/agents/${agentId}/wallet`, apiKey, { method: 'PUT', body: JSON.stringify({ walletAddress }) }),
  deposit: (agentId: string, apiKey: string, txHash: string) =>
    agentRequest(`/api/agents/${agentId}/deposit`, apiKey, { method: 'POST', body: JSON.stringify({ txHash }) }),
  withdraw: (agentId: string, apiKey: string, amount: number) =>
    agentRequest(`/api/agents/${agentId}/withdraw`, apiKey, { method: 'POST', body: JSON.stringify({ amount }) }),
};

export function setActiveWorkspace(id: string | null): void {
  activeWorkspaceId = id;
  if (id === null) {
    localStorage.removeItem('activeWorkspaceId');
  } else {
    localStorage.setItem('activeWorkspaceId', id);
  }
}

async function request(path: string, user: User, options: RequestInit = {}, skipWorkspaceHeader = false) {
  const token = await user.getIdToken();
  const wsHeader: Record<string, string> = (!skipWorkspaceHeader && activeWorkspaceId) ? { 'X-Workspace-Id': activeWorkspaceId } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...wsHeader,
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
  createMetric: (user: User, body: { name: string; description: string; value: number; formula: string; timePreference?: { enabled: boolean; halfLife: number }; marketRangeMax?: number }) =>
    request('/api/metrics', user, { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (user: User, id: string, body: { name: string; description: string; value: number; formula: string; oldValue: number; updateNote: string; timePreference?: { enabled: boolean; halfLife: number } | null; marketRangeMax?: number }) =>
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
  getMyAgents: (user: User) => request('/api/agents/mine', user),
  registerAgent: (user: User, agentId: string) =>
    request('/api/agents/register', user, { method: 'POST', body: JSON.stringify({ agentId }) }),
  approveAgent: (user: User, id: string) =>
    request(`/api/agents/${id}/approve`, user, { method: 'PUT' }),
  setAgentRole: (user: User, id: string, role: string) =>
    request(`/api/agents/${id}/role`, user, { method: 'PUT', body: JSON.stringify({ role }) }),
  spendAgent: (user: User, id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, user, { method: 'POST', body: JSON.stringify({ amount, type, reason }) }),
  getTreasury: (user: User) => request('/api/agents/treasury', user, {}, true), // skip workspace header — treasury is always platform-level
  depositForAgent: (user: User, agentId: string, txHash: string) =>
    request(`/api/agents/${agentId}/deposit`, user, { method: 'POST', body: JSON.stringify({ txHash }) }),
  withdrawFromAgent: (user: User, agentId: string, amount: number) =>
    request(`/api/agents/${agentId}/withdraw`, user, { method: 'POST', body: JSON.stringify({ amount }) }),
  setAgentWallet: (user: User, agentId: string, walletAddress: string) =>
    request(`/api/agents/${agentId}/wallet`, user, { method: 'PUT', body: JSON.stringify({ walletAddress }) }),

  // Markets & Trading
  getMarkets: (user: User, taskId?: string) => {
    const qs = taskId ? `?taskId=${taskId}` : '';
    return request(`/api/predictions/markets${qs}`, user);
  },
  getMarketDetail: (user: User, id: string) => request(`/api/predictions/markets/${id}`, user),
  getMarketTrades: (user: User, id: string) => request(`/api/predictions/markets/${id}/trades`, user),
  getMarketLiquidityEvents: (user: User, id: string) => request(`/api/predictions/markets/${id}/liquidity-events`, user),
  createMarket: (user: User, metricId: string, targetDate: string) =>
    request('/api/predictions/markets', user, { method: 'POST', body: JSON.stringify({ metricId, targetDate }) }),
  deleteMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}`, user, { method: 'DELETE' }),
  voidMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}/void`, user, { method: 'POST' }),
  resolveMarket: (user: User, id: string) =>
    request(`/api/predictions/markets/${id}/resolve`, user, { method: 'POST' }),
  refreshMarkets: (user: User, taskId?: string) =>
    request('/api/predictions/markets/refresh', user, {
      method: 'POST',
      body: JSON.stringify(taskId ? { taskId } : {}),
    }),
  resolvePredictions: (user: User, targetDate?: string) =>
    request('/api/predictions/resolve', user, { method: 'POST', body: JSON.stringify({ targetDate }) }),
  trade: (user: User, body: Record<string, unknown>) =>
    request('/api/predictions/trade', user, { method: 'POST', body: JSON.stringify(body) }),
  getPositions: (user: User, marketId?: string, agentId?: string) => {
    const params = new URLSearchParams();
    if (marketId) params.set('marketId', marketId);
    if (agentId) params.set('agentId', agentId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return request(`/api/predictions/positions${qs}`, user);
  },
  injectLiquidity: (user: User, marketId: string, amount: number) =>
    request(`/api/predictions/markets/${marketId}/liquidity`, user, { method: 'POST', body: JSON.stringify({ amount }) }),
  injectLiquidityBulk: (user: User, agentId: string, amount: number, taskId?: string) =>
    request('/api/predictions/markets/liquidity/bulk', user, { method: 'POST', body: JSON.stringify({ agentId, amount, ...(taskId && { taskId }) }) }),

  // Tasks
  getTasks: (user: User) => request('/api/tasks', user),
  getTask: (user: User, id: string) => request(`/api/tasks/${id}`, user),
  createTask: (user: User, body: { title: string; description: string; price: number }) =>
    request('/api/tasks', user, { method: 'POST', body: JSON.stringify(body) }),
  testTask: (user: User, id: string) =>
    request(`/api/tasks/${id}/test`, user, { method: 'POST' }),
  approveTask: (user: User, id: string) =>
    request(`/api/tasks/${id}/approve`, user, { method: 'POST' }),
  declineTask: (user: User, id: string) =>
    request(`/api/tasks/${id}/decline`, user, { method: 'POST' }),
  getTaskMessages: (user: User, id: string) => request(`/api/tasks/${id}/messages`, user),
  sendTaskMessage: (user: User, id: string, content: string) =>
    request(`/api/tasks/${id}/messages`, user, { method: 'POST', body: JSON.stringify({ content }) }),

  // Hooks (public, no auth)
  getHooksStatus: async (): Promise<{ active: boolean; lastPolledAt?: string; intervalMs?: number; nextPollAt?: string }> => {
    const res = await fetch(`${API_BASE}/api/events/hooks/status`);
    if (!res.ok) throw new Error(`Hooks status request failed: ${res.status}`);
    return res.json();
  },

  // Marketplace (public, no auth)
  getStats: async (): Promise<{ marketsActive: number; agentsActive: number; tradesThisWeek: number }> => {
    const res = await fetch(`${API_BASE}/api/marketplace/stats`);
    if (!res.ok) throw new Error(`Stats request failed: ${res.status}`);
    return res.json();
  },
  getMarketplace: async (limit = 50): Promise<MarketplaceListing[]> => {
    const res = await fetch(`${API_BASE}/api/marketplace?limit=${limit}`);
    if (!res.ok) throw new Error(`Marketplace request failed: ${res.status}`);
    return res.json();
  },
  getMarketplaceWorkspace: async (workspaceId: string): Promise<{ workspaceId: string; name: string; visibility: string; markets: MarketplaceListing[] }> => {
    const res = await fetch(`${API_BASE}/api/marketplace/${encodeURIComponent(workspaceId)}`);
    if (!res.ok) throw new Error(`Marketplace workspace request failed: ${res.status}`);
    return res.json();
  },
  getPublicWorkspaces: async (): Promise<Array<{ workspaceId: string; name: string; visibility: string }>> => {
    const res = await fetch(`${API_BASE}/api/marketplace/workspaces/public`);
    if (!res.ok) throw new Error(`Public workspaces request failed: ${res.status}`);
    return res.json();
  },
  joinWorkspace: (user: User, workspaceId: string) =>
    request(`/api/marketplace/${encodeURIComponent(workspaceId)}/join`, user, { method: 'POST' }),

  // User auth / profile
  getProfile: (user: User) => request('/api/auth/me', user),
  upsertProfile: (user: User, email?: string) =>
    request('/api/auth/profile', user, { method: 'POST', body: JSON.stringify({ email }) }),
  deleteAccount: (user: User) =>
    request('/api/auth/me', user, { method: 'DELETE' }),
  exportAccount: (user: User) => request('/api/auth/me/export', user),

  // Workspaces
  createWorkspace: (user: User, name: string) =>
    request('/api/workspaces', user, { method: 'POST', body: JSON.stringify({ name }) }),
  listWorkspaces: (user: User) => request('/api/workspaces', user),
  getWorkspace: (user: User, id: string) => request(`/api/workspaces/${id}`, user),
  getWorkspaceStats: (user: User, id: string) => request(`/api/workspaces/${id}/stats`, user),
  updateWorkspaceSettings: (user: User, id: string, body: { name?: string }) =>
    request(`/api/workspaces/${id}/settings`, user, { method: 'PUT', body: JSON.stringify(body) }),
  inviteMember: (user: User, workspaceId: string, uid: string, role: string) =>
    request(`/api/workspaces/${workspaceId}/members`, user, { method: 'POST', body: JSON.stringify({ uid, role }) }),
  removeMember: (user: User, workspaceId: string, uid: string) =>
    request(`/api/workspaces/${workspaceId}/members/${encodeURIComponent(uid)}`, user, { method: 'DELETE' }),

  // Permission groups
  listGroups: (user: User) => request('/api/groups', user),
  createGroup: (user: User, name: string) =>
    request('/api/groups', user, { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (user: User, id: string, body: { name?: string; agentIds?: string[]; permissions?: Record<string, { read: boolean; trade: boolean }> }) =>
    request(`/api/groups/${id}`, user, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (user: User, id: string) =>
    request(`/api/groups/${id}`, user, { method: 'DELETE' }),
};
