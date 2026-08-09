import type { TimePreference } from '../types';

export interface ActivityItem {
  id: string;
  type: string;
  timestamp: string;
  actor: { id: string; label: string } | null;
  marketId?: string;
  metricId?: string;
  proposalId?: string;
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

/** Desired-state row for an out-of-process agent runner (see /agents). */
export interface AgentControl {
  agentId: string;
  desiredState: 'enabled' | 'paused';
  triggerRequestedAt: string | null;
  triggerAckedAt: string | null;
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

export interface LeaderboardEntry {
  rank: number | null;
  id: string;
  nickname: string | null;
  calibration: number | null;
  accuracy: number | null;
  totalEarnings: number;
  resolvedMarkets: number;
  totalTrades: number;
  lastTradeAt: string | null;
}

export interface PublicProfilePosition {
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  proposalId: string | null;
  metricName: string | null;
  targetDate: string | null;
  direction: 'higher' | 'lower';
  shares: number;
  totalCost: number;
  status: 'open' | 'conditional' | 'closed' | 'resolved';
  probabilityHigher: number | null;
  consensus: number | null;
  actualValue: number | null;
}

export interface PublicProfileTrade {
  id: string;
  workspaceId: string;
  workspaceName: string;
  marketId: string;
  proposalId: string | null;
  metricName: string | null;
  targetDate: string | null;
  direction: 'higher' | 'lower';
  kind: 'buy' | 'sell';
  shares: number;
  cost: number;
  createdAt: string;
}

export interface PublicParticipantProfile {
  id: string;
  nickname: string | null;
  intent: string | null;
  /** Freeform public description: who this participant is and what it is in
   *  Telarchy to do. Set via POST /api/auth/profile (max 500 chars). */
  bio: string | null;
  joinedAt: string;
  /** The participant that created this one via POST /api/agents with an
   *  agent key; null for humans and self-registered bots. */
  parent: { id: string; nickname: string | null } | null;
  /** Participants this one created the same way (its sub-agents). */
  children: Array<{ id: string; nickname: string | null }>;
  stats: {
    rank: number | null;
    calibration: number | null;
    accuracy: number | null;
    totalEarnings: number;
    resolvedMarkets: number;
    totalTrades: number;
    lastTradeAt: string | null;
  };
  activeWorkspaces: Array<{ id: string; name: string }>;
  openPositions: PublicProfilePosition[];
  recentTrades: PublicProfileTrade[];
  /** Daily balance snapshots (credits) plus a live "now" point. Snapshots are
   *  written by the hourly resolve cron, one per UTC day. */
  balanceHistory: Array<{ at: string; balance: number }>;
  /** Cumulative realized PnL over time: per resolved market, net trade cash +
   *  resolution payout at resolvedAt. Viewer-scoped like openPositions. */
  pnlHistory: Array<{ at: string; cumulative: number }>;
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
  /** Present on /api/marketplace/featured; absent on other marketplace endpoints. */
  tradedVolume?: number;
  rangeMin: number;
  rangeMax: number;
}

export interface ProposalStats {
  total: number;
  approved: number;
  declined: number;
  declinedSpam: number;
  withdrawn: number;
  pending: number;
}

/**
 * What a logged-out visitor sees at /marketplace/:workspaceId. Deliberately
 * counts, not contents: metric names and market consensus are public, but
 * logged metric values, proposal text, and chat still require membership.
 */
export interface PublicWorkspace {
  workspaceId: string;
  name: string;
  slug: string | null;
  ownerId: string | null;
  /** Equal to ownerId when the owner never set a nickname; do not print a raw
   *  participant id as if it were a name. */
  ownerHandle: string | null;
  description: string | null;
  /** The owner's public commitment about what they will do with the number. */
  charter: string | null;
  visibility: string;
  proposalReward: number;
  spamPenalty: number;
  /** What pressing join actually grants, per the Public group's capabilities. */
  joinAs: 'trader' | 'viewer';
  /** Per-participant buy cap per market in credits; 0 = none. Shown so the
   *  fairness bound is a stated rule, not something taken on faith. */
  maxPositionCostPerMarket: number;
  /** The platform signup grant, so the page can say what you start with. */
  signupCredits: number;
  metricCount: number;
  openMarketCount: number;
  participantCount: number;
  proposalStats: ProposalStats;
  markets: PublicWorkspaceMarket[];
  /** The ballot: present only when the workspace's Public group grants read
   *  (an Open workspace, where contents are one free self-join away anyway). */
  proposals?: PublicProposal[];
  decided?: PublicDecidedProposal[];
  /** Hero-metric logged history (oldest first), the evidence a forecaster
   *  prices against. Same Open-workspace disclosure rule as the ballot. */
  heroHistory?: Array<{ at: string; value: number }>;
  /** The metric's own description: the owner's provenance statement. */
  heroMetricDescription?: string | null;
  tradesThisWeek?: number;
  /** The market's call after each trade of the hero market (the amber line). */
  marketHistory?: Array<{ at: string; consensus: number | null }>;
}

export interface PublicProposalMarketPair {
  metricName: string;
  targetDate: string;
  resolvesOn: string;
  approvedConsensus: number | null;
  declinedConsensus: number | null;
  /** approved minus declined consensus: the priced causal impact of approving. */
  delta: number | null;
  /** The approved branch's id and price shape, so a client can make the
   *  conditional market its main view and trade it directly. */
  approvedMarketId: string | null;
  declinedMarketId: string | null;
  approvedProbability: number | null;
  approvedLiquidity: number | null;
  rangeMin: number;
  rangeMax: number;
}

export interface PublicProposal {
  id: string;
  title: string;
  description: string;
  proposedByName: string | null;
  createdAt: string;
  /** Total conditional pairs; `markets` carries only the largest-impact few. */
  marketPairCount: number;
  markets: PublicProposalMarketPair[];
}

export interface PublicDecidedProposal {
  id: string;
  title: string;
  status: 'approved' | 'declined';
  resolvedAt: string | null;
  declineReason: string | null;
}

/** A market row on the public workspace page. No workspace fields: the page
 *  already knows which workspace it is showing. */
export interface PublicWorkspaceMarket {
  marketId: string;
  metricId: string;
  metricName: string;
  targetDate: string;
  resolvesOn: string;
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

const activeWorkspaceListeners = new Set<() => void>();

export function setActiveWorkspace(id: string | null): void {
  if (id === activeWorkspaceId) return;
  activeWorkspaceId = id;
  if (id === null) {
    localStorage.removeItem('activeWorkspaceId');
  } else {
    localStorage.setItem('activeWorkspaceId', id);
  }
  // Notify subscribers (useWorkspace instances) so the sidebar and any other
  // workspace-aware UI refetch for the new workspace without a full page reload.
  // Guarded by the no-op early-return above so re-setting the same id (e.g. the
  // profile echo inside the fetch) cannot cause a refetch loop.
  activeWorkspaceListeners.forEach(l => {
    try { l(); } catch (e) { console.error('active-workspace listener failed', e); }
  });
}

/** The last-used / URL-driven active workspace id. Used to upgrade flat routes
 *  (/metrics) to the namespaced /{ownerHandle}/{slug}/metrics form. */
export function getActiveWorkspace(): string | null {
  return activeWorkspaceId;
}

/** Subscribe to active-workspace changes. Returns an unsubscribe function. */
export function onActiveWorkspaceChange(cb: () => void): () => void {
  activeWorkspaceListeners.add(cb);
  return () => { activeWorkspaceListeners.delete(cb); };
}

/**
 * Fired after any successful mutating API call. Mutations are how credits
 * move (trades, liquidity top-ups, proposal subsidies, rewards), so listeners
 * (the sidebar balance counter) refetch instead of waiting for a route
 * change. Deliberately coarse: one cheap GET /agents/me per mutation burst
 * beats enumerating every spend endpoint and missing one.
 */
const mutationListeners = new Set<() => void>();
export function onApiMutation(cb: () => void): () => void {
  mutationListeners.add(cb);
  return () => { mutationListeners.delete(cb); };
}

function notifyMutation() {
  for (const cb of mutationListeners) {
    try { cb(); } catch (err) { console.error('onApiMutation listener failed', err); }
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
  if ((options.method ?? 'GET') !== 'GET') notifyMutation();
  return data;
}

export const api = {
  getMetrics: () => request('/api/metrics'),
  createMetric: (body: { name: string; description: string; value: number; formula: string; timePreference?: TimePreference; marketRangeMax?: number }) =>
    request('/api/metrics', { method: 'POST', body: JSON.stringify(body) }),
  updateMetric: (id: string, body: { name: string; description: string; value: number; formula: string; oldValue: number; updateNote: string; timePreference?: TimePreference | null; marketRangeMax?: number }) =>
    request(`/api/metrics/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMetric: (id: string) =>
    request(`/api/metrics/${id}`, { method: 'DELETE' }),
  reorderMetrics: (ids: string[]) =>
    request('/api/metrics/reorder', { method: 'POST', body: JSON.stringify({ ids }) }),
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
  getMarkets: (proposalId?: string, workspaceId?: string, opts?: { status?: 'open' | 'closed' | 'resolved' | 'voided' | 'all'; includeResolved?: boolean; includeVoided?: boolean; kind?: 'baseline' | 'conditional' | 'all' }) => {
    const params = new URLSearchParams();
    if (proposalId) params.set('proposalId', proposalId);
    if (opts?.status) params.set('status', opts.status);
    if (opts?.includeResolved) params.set('includeResolved', 'true');
    if (opts?.includeVoided) params.set('includeVoided', 'true');
    if (opts?.kind && opts.kind !== 'baseline') params.set('kind', opts.kind);
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
  refreshMarkets: (proposalId?: string) =>
    request('/api/predictions/markets/refresh', {
      method: 'POST',
      body: JSON.stringify(proposalId ? { proposalId } : {}),
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
  injectLiquidityBulk: (amount: number, proposalId?: string) =>
    request('/api/predictions/markets/liquidity/bulk', { method: 'POST', body: JSON.stringify({ amount, ...(proposalId && { proposalId }) }) }),

  // Proposals
  getProposals: (status?: string) => request(`/api/proposals${status ? `?status=${encodeURIComponent(status)}` : ''}`),
  getProposal: (id: string) => request(`/api/proposals/${id}`),
  createProposal: (body: { title: string; description: string; liquiditySubsidy?: number }) =>
    request('/api/proposals', { method: 'POST', body: JSON.stringify(body) }),
  approveProposal: (id: string) =>
    request(`/api/proposals/${id}/approve`, { method: 'POST' }),
  /** `declineReason` is published permanently on the proposal. Required by the
   *  backend when the workspace has a charter, since that is the promise. */
  declineProposal: (id: string, declineReason?: string) =>
    request(`/api/proposals/${id}/decline`, {
      method: 'POST',
      body: JSON.stringify({ declineReason: declineReason?.trim() || null }),
    }),
  getProposalMessages: (id: string) => request(`/api/proposals/${id}/messages`),
  sendProposalMessage: (id: string, content: string) =>
    request(`/api/proposals/${id}/messages`, { method: 'POST', body: JSON.stringify({ content }) }),

  getMarketMessages: (marketId: string) =>
    request(`/api/predictions/markets/${encodeURIComponent(marketId)}/messages`),
  sendMarketMessage: (marketId: string, content: string) =>
    request(`/api/predictions/markets/${encodeURIComponent(marketId)}/messages`,
      { method: 'POST', body: JSON.stringify({ content }) }),

  getHooksStatus: (): Promise<{ active: boolean; lastPolledAt?: string; intervalMs?: number; nextPollAt?: string }> =>
    request('/api/events/hooks/status'),

  // Member-friendly workspace activity feed (requires `read` capability).
  // Hides deposits/withdrawals and anonymizes trade actors for non-admins.
  getActivity: (
    params: {
      since?: string;
      until?: string;
      limit?: number;
      types?: string[];
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
    const qs = q.toString() ? `?${q}` : '';
    return requestWithWorkspace(`/api/activity${qs}`, {}, { workspaceId });
  },

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
      proposalId?: string;
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
    if (params.proposalId) q.set('proposalId', params.proposalId);
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

  // Agent control plane (platform admin / master key; see /agents)
  getAgentControls: (): Promise<{ controls: AgentControl[] }> =>
    request('/api/admin/agent-controls'),

  setAgentControl: (params: { agentId: string; desiredState?: 'enabled' | 'paused'; trigger?: boolean }): Promise<AgentControl> =>
    request('/api/admin/agent-control', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

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
  getMarketplaceWorkspace: async (workspaceId: string): Promise<PublicWorkspace> => {
    const res = await fetch(`${API_BASE}/api/marketplace/${encodeURIComponent(workspaceId)}`);
    if (!res.ok) throw new Error(`Marketplace workspace request failed: ${res.status}`);
    return res.json();
  },
  getPublicWorkspaces: async (): Promise<Array<{ workspaceId: string; name: string; visibility: string }>> => {
    const res = await fetch(`${API_BASE}/api/marketplace/workspaces/public`);
    if (!res.ok) throw new Error(`Public workspaces request failed: ${res.status}`);
    return res.json();
  },
  getFeaturedMarkets: async (): Promise<MarketplaceListing[]> => {
    const res = await fetch(`${API_BASE}/api/marketplace/featured`);
    if (!res.ok) throw new Error(`Featured markets request failed: ${res.status}`);
    return res.json();
  },
  getLeaderboard: async (limit = 100): Promise<{ participants: LeaderboardEntry[] }> => {
    const res = await fetch(`${API_BASE}/api/leaderboard?limit=${limit}`);
    if (!res.ok) throw new Error(`Leaderboard request failed: ${res.status}`);
    return res.json();
  },
  /** One market's consensus history on a public workspace: the series the
   *  chart draws, addressable per market so a proposal's conditional branch
   *  can become the page's main view. */
  getPublicMarketHistory: async (workspaceIdOrSlug: string, marketId: string): Promise<Array<{ at: string; consensus: number | null }>> => {
    const res = await fetch(`${API_BASE}/api/marketplace/${encodeURIComponent(workspaceIdOrSlug)}/markets/${encodeURIComponent(marketId)}/history`);
    if (!res.ok) throw new Error(`Market history request failed: ${res.status}`);
    const body = await res.json();
    return body.history ?? [];
  },
  getPublicProfile: async (idOrNickname: string): Promise<PublicParticipantProfile> => {
    const res = await fetch(`${API_BASE}/api/agents/${encodeURIComponent(idOrNickname)}/public`);
    if (res.status === 404) throw new Error('Participant not found');
    if (!res.ok) throw new Error(`Profile request failed: ${res.status}`);
    return res.json();
  },
  joinWorkspace: (workspaceId: string) =>
    request(`/api/marketplace/${encodeURIComponent(workspaceId)}/join`, { method: 'POST' }),

  // User auth / profile
  getProfile: () => request('/api/auth/me'),
  upsertProfile: (opts?: { email?: string; intent?: 'creator' | 'agent' | 'trader'; nickname?: string; bio?: string }) =>
    request('/api/auth/profile', { method: 'POST', body: JSON.stringify(opts ?? {}) }),
  recordConsent: () =>
    request('/api/auth/consent', { method: 'POST', body: JSON.stringify({ accepted: true }) }),
  // Key-first onboarding claim (see /claim page and POST /api/onboard)
  onboardClaimInfo: (token: string) =>
    request(`/api/onboard/claim/${encodeURIComponent(token)}`, {}, true),
  onboardClaim: (token: string) =>
    request('/api/onboard/claim', { method: 'POST', body: JSON.stringify({ token }) }, true),
  deleteAccount: () =>
    request('/api/auth/me', { method: 'DELETE' }),
  exportAccount: () => request('/api/auth/me/export'),

  // Workspaces
  createWorkspace: (body: { name: string; template?: string; templateParams?: { revenueRangeMax?: number; currency?: string }; visibility?: 'public' | 'unlisted' | 'private' } | string) => {
    const payload = typeof body === 'string' ? { name: body } : body;
    return request('/api/workspaces', { method: 'POST', body: JSON.stringify(payload) }, true);
  },
  listWorkspaces: () => request('/api/workspaces', {}, true),
  /** Persist the caller's personal sidebar order for the workspace list.
   *  `ids` is every workspace id in the desired order; ids the caller no longer
   *  belongs to are ignored server-side. Returns { ok, order }. */
  reorderWorkspaces: (ids: string[]): Promise<{ ok: boolean; order: string[] }> =>
    request('/api/workspaces/order', { method: 'PUT', body: JSON.stringify({ ids }) }, true),
  /** Map a GitHub-style /{owner}/{slug} path to a workspace id. Returns the
   *  canonical segments + a `moved` flag (true when the slug is a former,
   *  renamed-away slug and the URL should be replaced). */
  resolveWorkspacePath: (owner: string, slug: string): Promise<{ workspaceId: string; canonicalOwner: string; canonicalSlug: string; moved: boolean }> =>
    request(`/api/workspaces/resolve?owner=${encodeURIComponent(owner)}&slug=${encodeURIComponent(slug)}`, {}, true),
  getWorkspace: (id: string) => request(`/api/workspaces/${id}`),
  getWorkspaceStats: (id: string) => request(`/api/workspaces/${id}/stats`),
  updateWorkspaceSettings: (id: string, body: { name?: string; autoFundNewMarkets?: boolean; newMarketLiquidityCredits?: number; visibility?: 'public' | 'unlisted' | 'private'; proposalReward?: number; spamPenalty?: number; maxPendingProposalsPerParticipant?: number }) =>
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

  // Feedback (bug reports / help requests)
  submitFeedback: (body: { kind: 'bug' | 'help' | 'feedback'; subject: string; body: string; url?: string; email?: string }) =>
    request('/api/feedback', { method: 'POST', body: JSON.stringify(body) }, true),
  listFeedback: (params: { kind?: 'bug' | 'help' | 'feedback'; status?: 'open' | 'triaged' | 'resolved' | 'closed'; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (params.kind) q.set('kind', params.kind);
    if (params.status) q.set('status', params.status);
    if (params.limit) q.set('limit', String(params.limit));
    const qs = q.toString() ? `?${q}` : '';
    return request(`/api/feedback${qs}`, {}, true);
  },
  updateFeedback: (id: string, body: { status?: 'open' | 'triaged' | 'resolved' | 'closed'; adminNotes?: string }) =>
    request(`/api/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }, true),

  // API keys & authenticated agent creation (used by the API page).
  // /api/agents/:id/keys uses :id=me to operate on the calling agent.
  listAgentKeys: (agentId: string) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys`),
  mintAgentKey: (agentId: string, body: { label?: string; scopes?: string[]; workspaceId?: string }) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys`, { method: 'POST', body: JSON.stringify(body) }),
  updateAgentKey: (agentId: string, keyId: string, body: { label?: string | null; scopes?: string[] }) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys/${encodeURIComponent(keyId)}`, { method: 'PATCH', body: JSON.stringify(body) }),
  revokeAgentKey: (agentId: string, keyId: string) =>
    request(`/api/agents/${encodeURIComponent(agentId)}/keys/${encodeURIComponent(keyId)}`, { method: 'DELETE' }),
  /**
   * Authenticated agent creation. The caller becomes the owner (authUserId)
   * for browser sessions. Memberships add the new agent to the named groups
   * in each workspace; caller must hold `manage` capability there. The
   * returned apiKey is shown once and never returned again. Send X-Workspace-Id
   * via the active workspace; backend default workspaceId on the new key is
   * memberships[0].workspaceId or the caller's active workspace.
   */
  createAgent: (body: {
    agentId: string;
    nickname?: string;
    keyLabel?: string;
    keyScopes?: string[];
    memberships?: Array<{ workspaceId: string; groupIds: string[] }>;
  }) => request('/api/agents', { method: 'POST', body: JSON.stringify(body) }),

  // Permission groups
  listGroups: () => request('/api/groups'),
  createGroup: (name: string) =>
    request('/api/groups', { method: 'POST', body: JSON.stringify({ name }) }),
  updateGroup: (id: string, body: { name?: string; memberIds?: string[]; permissions?: Record<string, { read: boolean; trade: boolean }>; sourcePermissions?: Record<string, { read: boolean }>; capabilities?: string[] }) =>
    request(`/api/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (id: string) =>
    request(`/api/groups/${id}`, { method: 'DELETE' }),
};
