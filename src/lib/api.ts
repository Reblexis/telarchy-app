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

// Custom server state — URL is cached in localStorage for resilience across page loads.
let customApiUrl: string | null = activeWorkspaceId
  ? localStorage.getItem(`customApiUrl_${activeWorkspaceId}`)
  : null;

const CUSTOM_SERVER_PATHS = ['/api/metrics', '/api/predictions', '/api/tasks', '/api/events', '/api/groups', '/api/updates'];

function isWorkspaceScopedPath(path: string): boolean {
  return CUSTOM_SERVER_PATHS.some(prefix => path.startsWith(prefix));
}

export function setCustomApiUrl(url: string | null): void {
  customApiUrl = url;
  if (!activeWorkspaceId) return;
  if (url) {
    localStorage.setItem(`customApiUrl_${activeWorkspaceId}`, url);
  } else {
    localStorage.removeItem(`customApiUrl_${activeWorkspaceId}`);
  }
}

export function getCustomApiKey(workspaceId: string): string | null {
  return localStorage.getItem(`customApiKey_${workspaceId}`);
}

export function setCustomApiKey(workspaceId: string, key: string | null): void {
  if (key) {
    localStorage.setItem(`customApiKey_${workspaceId}`, key);
  } else {
    localStorage.removeItem(`customApiKey_${workspaceId}`);
  }
}

async function customRequest(
  path: string,
  options: RequestInit = {},
  workspaceId = activeWorkspaceId,
  apiUrl = customApiUrl,
) {
  const apiKey = workspaceId ? getCustomApiKey(workspaceId) : null;
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { 'X-API-Key': apiKey } : {}),
      ...(workspaceId ? { 'X-Workspace-Id': workspaceId } : {}),
      ...(options.headers as Record<string, string>),
    },
  });
  if (res.status === 204) return null;
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Custom server unavailable (${res.status}).`);
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Custom server error');
  return data;
}

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
  getProfile: (_agentId: string, apiKey: string) =>
    agentRequest('/api/agents/me', apiKey),
  getDashboard: (_agentId: string, apiKey: string) =>
    agentRequest('/api/agents/me/dashboard', apiKey),
  getMarkets: (agentId: string, apiKey: string) =>
    agentRequest('/api/predictions/markets', apiKey),
  getPositions: (agentId: string, apiKey: string, marketId?: string) => {
    const qs = marketId ? `?marketId=${marketId}` : '';
    return agentRequest(`/api/predictions/positions${qs}`, apiKey);
  },
  trade: (agentId: string, apiKey: string, body: Record<string, unknown>) =>
    agentRequest('/api/predictions/trade', apiKey, { method: 'POST', body: JSON.stringify(body) }),
  setWallet: (_agentId: string, apiKey: string, walletAddress: string) =>
    agentRequest('/api/agents/me/wallet', apiKey, { method: 'PUT', body: JSON.stringify({ walletAddress }) }),
  deposit: (_agentId: string, apiKey: string, txHash: string) =>
    agentRequest('/api/agents/me/deposit', apiKey, { method: 'POST', body: JSON.stringify({ txHash }) }),
  withdraw: (_agentId: string, apiKey: string, amount: number) =>
    agentRequest('/api/agents/me/withdraw', apiKey, { method: 'POST', body: JSON.stringify({ amount }) }),
};

export function setActiveWorkspace(id: string | null): void {
  activeWorkspaceId = id;
  if (id === null) {
    localStorage.removeItem('activeWorkspaceId');
    customApiUrl = null;
  } else {
    localStorage.setItem('activeWorkspaceId', id);
    customApiUrl = localStorage.getItem(`customApiUrl_${id}`);
  }
}

async function request(path: string, options: RequestInit = {}, skipWorkspaceHeader = false) {
  return requestWithWorkspace(path, options, { skipWorkspaceHeader });
}

type RequestWorkspaceOptions = {
  skipWorkspaceHeader?: boolean;
  workspaceId?: string;
};

async function requestWithWorkspace(
  path: string,
  options: RequestInit = {},
  requestOptions: RequestWorkspaceOptions = {},
) {
  const { skipWorkspaceHeader = false, workspaceId } = requestOptions;
  const effectiveWorkspaceId = skipWorkspaceHeader ? null : (workspaceId ?? activeWorkspaceId);
  const effectiveCustomApiUrl = effectiveWorkspaceId
    ? localStorage.getItem(`customApiUrl_${effectiveWorkspaceId}`)
    : null;

  if (effectiveWorkspaceId && effectiveCustomApiUrl && isWorkspaceScopedPath(path)) {
    return customRequest(path, options, effectiveWorkspaceId, effectiveCustomApiUrl);
  }
  const wsHeader: Record<string, string> = effectiveWorkspaceId ? { 'X-Workspace-Id': effectiveWorkspaceId } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
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
  getMetrics: () => request('/api/metrics'),
  createMetric: (body: { name: string; description: string; value: number; formula: string; timePreference?: { enabled: boolean; halfLife: number }; marketRangeMax?: number }) =>
    request('/api/metrics', { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (id: string, body: { name: string; description: string; value: number; formula: string; oldValue: number; updateNote: string; timePreference?: { enabled: boolean; halfLife: number } | null; marketRangeMax?: number }) =>
    request(`/api/metrics/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMetric: (id: string) =>
    request(`/api/metrics/${id}`, { method: 'DELETE' }),
  getMetricLogs: (metricId: string) =>
    request(`/api/metrics/${metricId}/logs`),
  getUpdates: (limit?: number) =>
    request(`/api/updates${limit ? `?limit=${limit}` : ''}`),
  getStatus: () => request('/api/status'),

  // Agents
  getParticipant: () => request('/api/agents/me'),
  getAgents: () => request('/api/agents'),
  getMyAgents: () => request('/api/agents/mine'),
  registerAgent: (agentId: string) =>
    request('/api/agents/register', { method: 'POST', body: JSON.stringify({ agentId }) }),
  approveAgent: (id: string) =>
    request(`/api/agents/${id}/approve`, { method: 'PUT' }),
  setAgentRole: (id: string, role: string) =>
    request(`/api/agents/${id}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  spendAgent: (id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, { method: 'POST', body: JSON.stringify({ amount, type, reason }) }),
  getTreasury: () => request('/api/agents/treasury', {}, true),
  depositForMe: (txHash: string) =>
    request('/api/agents/me/deposit', { method: 'POST', body: JSON.stringify({ txHash }) }),
  depositForAgent: (agentId: string, txHash: string) =>
    request(`/api/agents/${agentId}/deposit`, { method: 'POST', body: JSON.stringify({ txHash }) }),
  withdrawFromMe: (amount: number) =>
    request('/api/agents/me/withdraw', { method: 'POST', body: JSON.stringify({ amount }) }),
  withdrawFromAgent: (agentId: string, amount: number) =>
    request(`/api/agents/${agentId}/withdraw`, { method: 'POST', body: JSON.stringify({ amount }) }),
  setMyWallet: (walletAddress: string) =>
    request('/api/agents/me/wallet', { method: 'PUT', body: JSON.stringify({ walletAddress }) }),
  setAgentWallet: (agentId: string, walletAddress: string) =>
    request(`/api/agents/${agentId}/wallet`, { method: 'PUT', body: JSON.stringify({ walletAddress }) }),

  // Markets & Trading
  getMarkets: (taskId?: string, workspaceId?: string) => {
    const qs = taskId ? `?taskId=${taskId}` : '';
    return requestWithWorkspace(`/api/predictions/markets${qs}`, {}, { workspaceId });
  },
  getMarketDetail: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}`, {}, { workspaceId }),
  getMarketTrades: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/trades`, {}, { workspaceId }),
  getMarketLiquidityEvents: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/liquidity-events`, {}, { workspaceId }),
  createMarket: (metricId: string, targetDate: string) =>
    request('/api/predictions/markets', { method: 'POST', body: JSON.stringify({ metricId, targetDate }) }),
  deleteMarket: (id: string) =>
    request(`/api/predictions/markets/${id}`, { method: 'DELETE' }),
  voidMarket: (id: string) =>
    request(`/api/predictions/markets/${id}/void`, { method: 'POST' }),
  resolveMarket: (id: string) =>
    request(`/api/predictions/markets/${id}/resolve`, { method: 'POST' }),
  refreshMarkets: (taskId?: string) =>
    request('/api/predictions/markets/refresh', {
      method: 'POST',
      body: JSON.stringify(taskId ? { taskId } : {}),
    }),
  resolvePredictions: (targetDate?: string) =>
    request('/api/predictions/resolve', { method: 'POST', body: JSON.stringify({ targetDate }) }),
  trade: (body: Record<string, unknown>, workspaceId?: string) =>
    requestWithWorkspace('/api/predictions/trade', { method: 'POST', body: JSON.stringify(body) }, { workspaceId }),
  getPositions: (marketId?: string, agentId?: string, workspaceId?: string) => {
    const params = new URLSearchParams();
    if (marketId) params.set('marketId', marketId);
    if (agentId) params.set('agentId', agentId);
    const qs = params.toString() ? `?${params.toString()}` : '';
    return requestWithWorkspace(`/api/predictions/positions${qs}`, {}, { workspaceId });
  },
  injectLiquidity: (marketId: string, amount: number) =>
    request(`/api/predictions/markets/${marketId}/liquidity`, { method: 'POST', body: JSON.stringify({ amount }) }),
  injectLiquidityBulk: (amount: number, taskId?: string) =>
    request('/api/predictions/markets/liquidity/bulk', { method: 'POST', body: JSON.stringify({ amount, ...(taskId && { taskId }) }) }),

  // Tasks
  getTasks: () => request('/api/tasks'),
  getTask: (id: string) => request(`/api/tasks/${id}`),
  createTask: (body: { title: string; description: string; price: number }) =>
    request('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  testTask: (id: string) =>
    request(`/api/tasks/${id}/test`, { method: 'POST' }),
  approveTask: (id: string) =>
    request(`/api/tasks/${id}/approve`, { method: 'POST' }),
  declineTask: (id: string) =>
    request(`/api/tasks/${id}/decline`, { method: 'POST' }),
  getTaskMessages: (id: string) => request(`/api/tasks/${id}/messages`),
  sendTaskMessage: (id: string, content: string) =>
    request(`/api/tasks/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

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
  joinWorkspace: (workspaceId: string) =>
    request(`/api/marketplace/${encodeURIComponent(workspaceId)}/join`, { method: 'POST' }),

  // User auth / profile
  getProfile: () => request('/api/auth/me'),
  upsertProfile: (email?: string) =>
    request('/api/auth/profile', { method: 'POST', body: JSON.stringify({ email }) }),
  deleteAccount: () =>
    request('/api/auth/me', { method: 'DELETE' }),
  exportAccount: () => request('/api/auth/me/export'),

  // Workspaces
  createWorkspace: (name: string) =>
    request('/api/workspaces', { method: 'POST', body: JSON.stringify({ name }) }),
  listWorkspaces: () => request('/api/workspaces'),
  getWorkspace: (id: string) => request(`/api/workspaces/${id}`),
  getWorkspaceStats: (id: string) => request(`/api/workspaces/${id}/stats`),
  updateWorkspaceSettings: (id: string, body: { name?: string; customApiUrl?: string | null }) =>
    request(`/api/workspaces/${id}/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  // Permission groups
  listGroups: () => request('/api/groups'),
  createGroup: (name: string) =>
    request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: string, body: { name?: string; memberIds?: string[]; agentIds?: string[]; uids?: string[]; permissions?: Record<string, { read: boolean; trade: boolean }> }) =>
    request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (id: string) =>
    request(`/api/groups/${id}`, { method: 'DELETE' }),
};
