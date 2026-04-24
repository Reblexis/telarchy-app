export interface ActivityItem {
  id: string;
  type: string;
  timestamp: string;
  actor: { id: string; label: string } | null;
  marketId?: string;
  metricId?: string;
  taskId?: string;
  data: Record<string, unknown>;
}

export interface AgentHeartbeat {
  agentId: string;
  status: string;
  workspaceId: string | null;
  workspaceName: string | null;
  strategy: string | null;
  lastCycleStartedAt: string | null;
  lastCycleEndedAt: string | null;
  nextCycleAt: string | null;
  pollIntervalSeconds: number;
  workspacesVisited: number;
  lastTraded: number;
  lastSkipped: number;
  lastErrors: number;
  lastError: string | null;
  balance: number | null;
  updatedAt: string;
}

export interface AgentTraceEntry {
  marketId: string;
  metric: string;
  targetDate: string;
  rangeMin: number;
  rangeMax: number;
  consensus: number;
  estimate: number;
  confidence: number;
  distance: number;
  threshold: number;
  reasoning: string;
  outcome: string;
  cost?: number;
  resultingConsensus?: number;
  error?: string;
}

export interface AgentTrace {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  agentId: string;
  strategy: string;
  startedAt: string;
  endedAt: string;
  model: string | null;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  cacheWrite: number;
  candidates: number;
  traded: number;
  skipped: number;
  errors: number;
  costUsd: number;
  entries: AgentTraceEntry[];
  createdAt: string;
}

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
  } else {
    localStorage.setItem('activeWorkspaceId', id);
  }
}

async function request(path: string, options: RequestInit = {}, skipWorkspaceHeader = false) {
  return requestWithWorkspace(path, options, { skipWorkspaceHeader });
}

type RequestWorkspaceOptions = {
  skipWorkspaceHeader?: boolean;
  workspaceId?: string;
};

let consentRecoveryInFlight: Promise<void> | null = null;

async function recoverConsent(): Promise<void> {
  if (!consentRecoveryInFlight) {
    consentRecoveryInFlight = fetch(`${API_BASE}/api/auth/consent`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted: true }),
    }).then(res => {
      sessionStorage.removeItem('pendingConsent');
      if (!res.ok) throw new Error(`Consent recovery failed: ${res.status}`);
    }).finally(() => { consentRecoveryInFlight = null; });
  }
  return consentRecoveryInFlight;
}

async function requestWithWorkspace(
  path: string,
  options: RequestInit = {},
  requestOptions: RequestWorkspaceOptions = {},
  retryAfterConsent = true,
) {
  const { skipWorkspaceHeader = false, workspaceId } = requestOptions;
  const effectiveWorkspaceId = skipWorkspaceHeader ? null : (workspaceId ?? activeWorkspaceId);
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
  if (res.status === 403 && data?.needsConsent && retryAfterConsent && path !== '/api/auth/consent') {
    await recoverConsent();
    return requestWithWorkspace(path, options, requestOptions, false);
  }
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
  getAgentTrades: (agentId: string, limit = 100) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/trades?limit=${limit}`),
  getAgentMarketPnl: (agentId: string) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/market-pnl`),
  getMyAgents: () => request('/api/agents/mine'),
  registerAgent: (agentId: string) =>
    request('/api/agents/register', { method: 'POST', body: JSON.stringify({ agentId }) }),
  spendAgent: (id: string, amount: number, type: 'betting' | 'tokens', reason: string) =>
    request(`/api/agents/${id}/spend`, { method: 'POST', body: JSON.stringify({ amount, type, reason }) }),
  getTreasury: () => request('/api/agents/treasury', {}, true),
  /** No auth — same treasury address as minted deposits use; 503 if server has no treasury key. */
  getDepositAddress: () =>
    request('/api/agents/deposit-address', {}, true) as Promise<{
      address: string;
      chain: string;
      asset: string;
      usdcContract: string;
    }>,
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
  getMarkets: (taskId?: string, workspaceId?: string, opts?: { includeResolved?: boolean }) => {
    const params = new URLSearchParams();
    if (taskId) params.set('taskId', taskId);
    if (opts?.includeResolved) params.set('includeResolved', 'true');
    const qs = params.toString() ? `?${params}` : '';
    return requestWithWorkspace(`/api/predictions/markets${qs}`, {}, { workspaceId });
  },
  getMarketDetail: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}`, {}, { workspaceId }),
  getMarketTrades: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/trades`, {}, { workspaceId }),
  getMarketLiquidityEvents: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/liquidity-events`, {}, { workspaceId }),
  getMarketPositions: (id: string, workspaceId?: string) =>
    requestWithWorkspace(`/api/predictions/markets/${id}/positions`, {}, { workspaceId }),
  createMarket: (metricId: string, targetDate: string) =>
    request('/api/predictions/markets', { method: 'POST', body: JSON.stringify({ metricId, targetDate }) }),
  deleteMarket: (id: string) =>
    request(`/api/predictions/markets/${id}`, { method: 'DELETE' }),
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

  getHooksStatus: (): Promise<{ active: boolean; lastPolledAt?: string; intervalMs?: number; nextPollAt?: string }> =>
    request('/api/events/hooks/status'),

  // Admin activity feed (workspace-scoped; requires `manage` capability)
  getAdminActivity: (
    params: {
      since?: string;
      until?: string;
      limit?: number;
      types?: string[];
      participantId?: string;
      marketId?: string;
      metricId?: string;
      taskId?: string;
    },
    workspaceId?: string,
  ): Promise<{
    activities: ActivityItem[];
    supportedTypes: string[];
    nextCursor: string;
  }> => {
    const q = new URLSearchParams();
    if (params.since) q.set('since', params.since);
    if (params.until) q.set('until', params.until);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.types?.length) q.set('types', params.types.join(','));
    if (params.participantId) q.set('participantId', params.participantId);
    if (params.marketId) q.set('marketId', params.marketId);
    if (params.metricId) q.set('metricId', params.metricId);
    if (params.taskId) q.set('taskId', params.taskId);
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/admin/activity${qs}`, {}, { workspaceId });
  },

  // Agent telemetry (heartbeats + decision traces; requires `manage`)
  getAgentHeartbeats: (workspaceId?: string): Promise<{ heartbeats: AgentHeartbeat[]; isPlatformAdmin?: boolean }> =>
    requestWithWorkspace('/api/admin/agent-heartbeats', {}, { workspaceId }),

  getAgentTraces: (
    params: { agentId?: string; since?: string; limit?: number; scopeWorkspaceId?: string | 'all' },
    workspaceId?: string,
  ): Promise<{ traces: AgentTrace[]; scope?: string; isPlatformAdmin?: boolean }> => {
    const q = new URLSearchParams();
    if (params.agentId) q.set('agentId', params.agentId);
    if (params.since) q.set('since', params.since);
    if (params.limit) q.set('limit', String(params.limit));
    if (params.scopeWorkspaceId) q.set('workspaceId', params.scopeWorkspaceId);
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/admin/agent-traces${qs}`, {}, { workspaceId });
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
  recordConsent: () =>
    request('/api/auth/consent', { method: 'POST', body: JSON.stringify({ accepted: true }) }),
  deleteAccount: () =>
    request('/api/auth/me', { method: 'DELETE' }),
  exportAccount: () => request('/api/auth/me/export'),

  // Workspaces
  createWorkspace: (body: { name: string; template?: 'startup' | 'personal' | 'blank'; templateParams?: { revenueRangeMax?: number }; visibility?: 'public' | 'unlisted' | 'private' } | string) => {
    const payload = typeof body === 'string' ? { name: body } : body;
    return request('/api/workspaces', { method: 'POST', body: JSON.stringify(payload) }, true);
  },
  listWorkspaces: () => request('/api/workspaces', {}, true),
  getWorkspace: (id: string) => request(`/api/workspaces/${id}`),
  getWorkspaceStats: (id: string) => request(`/api/workspaces/${id}/stats`),
  updateWorkspaceSettings: (id: string, body: { name?: string; autoFundNewMarkets?: boolean; newMarketLiquidityCredits?: number; visibility?: 'public' | 'unlisted' | 'private' }) =>
    request(`/api/workspaces/${id}/settings`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteWorkspace: (id: string) =>
    request(`/api/workspaces/${id}`, { method: 'DELETE' }),
  // Sources (text + external bridges, unified)
  listSources: () => request('/api/sources'),
  getSource: (id: string) => request(`/api/sources/${id}`),
  createTextSource: (body: { name: string; description?: string; content?: string }) =>
    request('/api/sources', { method: 'POST', body: JSON.stringify({ ...body, type: 'text' }) }),
  updateSource: (id: string, body: { name?: string; description?: string; content?: string }) =>
    request(`/api/sources/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteSource: (id: string) =>
    request(`/api/sources/${id}`, { method: 'DELETE' }),
  getSourceTree: (id: string, path?: string, ref?: string) => {
    const params = new URLSearchParams();
    if (path) params.set('path', path);
    if (ref) params.set('ref', ref);
    const qs = params.toString();
    return request(`/api/sources/${id}/tree${qs ? `?${qs}` : ''}`);
  },
  getSourceFile: (id: string, path: string, ref?: string) => {
    const params = new URLSearchParams({ path });
    if (ref) params.set('ref', ref);
    return request(`/api/sources/${id}/file?${params}`);
  },
  getGitHubRepos: (state: string) =>
    request(`/api/sources/github/repos?state=${encodeURIComponent(state)}`),
  connectGitHub: (body: { state: string; repos: string[] }) =>
    request('/api/sources/github/connect', { method: 'POST', body: JSON.stringify(body) }),

  // Permission groups
  listGroups: () => request('/api/groups'),
  createGroup: (name: string) =>
    request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: string, body: { name?: string; memberIds?: string[]; permissions?: Record<string, { read: boolean; trade: boolean }>; sourcePermissions?: Record<string, { read: boolean }>; capabilities?: string[] }) =>
    request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (id: string) =>
    request(`/api/groups/${id}`, { method: 'DELETE' }),
};
