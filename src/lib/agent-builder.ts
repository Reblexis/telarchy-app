import { api } from './api';

export interface BuilderOptions {
  identity: 'bot' | 'me';
  access: Access;
  workspace: string;
  botName: string;
  credits: string;
}
export const defaults: BuilderOptions = {
  identity: 'bot',
  access: 'read',
  workspace: '',
  botName: '',
  credits: '100',
};

/** Nonsecret preferences only. Never spread untrusted storage into state. */
export function readOptions(value: unknown): BuilderOptions {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pick = <T extends string>(key: string, choices: T[], fallback: T): T =>
    choices.includes(o[key] as T) ? (o[key] as T) : fallback;
  return {
    identity: pick('identity', ['bot', 'me'], 'bot'),
    access: pick('access', ['read', 'trade', 'manage', 'full'], 'read'),
    workspace: typeof o.workspace === 'string' ? o.workspace.slice(0, 200) : '',
    botName: typeof o.botName === 'string' ? o.botName.slice(0, 64) : '',
    credits:
      typeof o.credits === 'string' &&
      o.credits.trim() !== '' &&
      Number.isFinite(Number(o.credits)) &&
      Number(o.credits) >= 0
        ? o.credits
        : '100',
  };
}

/**
 * The setup prompt is a pointer, not the instructions (docs/audience-pages.md,
 * "Agent-builder setup"): it sends the coding assistant to the build guide and
 * names only what that guide cannot know. Every rule is written once, there.
 */
export function builderPrompt(base: string, o: BuilderOptions, connectedAgentId?: string): string {
  const identity = connectedAgentId
    ? o.identity === 'me'
      ? `my own account (${JSON.stringify(connectedAgentId)}), already set up, not a new participant`
      : `my bot ${JSON.stringify(connectedAgentId)}, already created and funded`
    : o.identity === 'bot'
      ? 'a separate bot with its own balance and record, still to be created'
      : 'my own account, not a new participant';
  const access = {
    read: 'research only, no trades and no changes',
    trade: 'read and trade in that workspace only',
    manage: 'read, trade and manage my workspaces',
    full: 'full access to this identity',
  }[o.access];
  return [
    `Set up a Telarchy trading agent for me by following the setup guide at ${base}/guides/build-agent.`,
    '',
    `- Identity: ${identity}.`,
    `- Workspace: ${o.workspace ? JSON.stringify(o.workspace) : 'help me choose a public workspace'}.`,
    `- Access: ${access}.`,
  ].join('\n');
}

export type Access = 'read' | 'trade' | 'manage' | 'full';
export const accessPresets = [
  { value: 'read', label: 'Research', detail: 'Read market data. No spending or changes.' },
  { value: 'trade', label: 'Trading', detail: 'Read markets and trade with your balance.' },
  { value: 'manage', label: 'Workspace management', detail: 'Read, trade and manage your workspaces.' },
  { value: 'full', label: 'Full access', detail: 'Everything you can do: settings, balances, keys and creating bots.' },
] as const;
export const scopesForAccess = (access: Access): string[] =>
  access === 'full'
    ? ['*']
    : access === 'manage'
      ? [...tradingScopes, 'workspace:manage']
      : access === 'trade'
        ? tradingScopes
        : ['workspace:read'];
export const accessForScopes = (scopes: string[]): Access =>
  scopes.includes('*')
    ? 'full'
    : scopes.includes('workspace:manage')
      ? 'manage'
      : scopes.includes('workspace:trade')
        ? 'trade'
        : 'read';
export const tradingScopes = ['workspace:read', 'workspace:trade'];
/** Ephemeral checkpoints, held in memory only. A failed funding response must
 * be reconciled by ownership lookup, never replayed as a second transfer. */
export interface Connection {
  label: string;
  attempted?: boolean;
  /** The chosen/generated identifier survives uncertain creation responses. */
  botId?: string;
  ownerJoined?: boolean;
  agentId?: string;
  key?: Awaited<ReturnType<typeof api.mintAgentKey>>;
  joined?: 'trader' | 'viewer';
  access?: Access;
  complete?: boolean;
}
export async function connectBuilder(
  o: BuilderOptions,
  access: Access,
  c: Connection,
  current: () => boolean,
): Promise<void> {
  const guard = () => {
    if (!current()) throw new Error('The signed-in account changed. Reopen setup to continue.');
  };
  guard();
  if (c.complete) return;
  if (!o.workspace) throw new Error('Choose a workspace.');
  const amount = Number(o.credits);
  if (
    o.identity === 'bot' &&
    (o.botName.trim().length > 64 || o.credits.trim() === '' || !Number.isFinite(amount) || amount < 0)
  )
    throw new Error('Use a name of at most 64 characters and a nonnegative credit amount.');
  if (!c.agentId && o.identity === 'bot') {
    const name = o.botName.trim();
    c.botId ??= /^[a-zA-Z0-9_-]{3,64}$/.test(name) ? name : `bot-${crypto.randomUUID().slice(0, 12)}`;
    const owned = await api.getMyAgents();
    guard();
    const existing = owned.find(a => a.id === c.botId && a.authUserId === null);
    if (c.attempted) {
      if (!existing)
        throw new Error(
          'Could not confirm whether creation completed. Check My agents in your account before starting another setup.',
        );
      c.agentId = existing.id;
    } else {
      if (owned.some(a => a.id === c.botId))
        throw new Error('That name already belongs to one of your participants. Choose a new name.');
      if (!c.ownerJoined) {
        await api.joinWorkspace(o.workspace);
        guard();
        c.ownerJoined = true;
      }
      c.attempted = true;
      const created = await api.createAgent(
        {
          agentId: c.botId,
          ...(name && name !== c.botId ? { nickname: name } : {}),
          initialCredits: amount,
          keyLabel: c.label,
          keyScopes: ['workspace:read'],
        },
        o.workspace,
      );
      guard();
      c.agentId = created.agentId;
    }
  }
  c.agentId ??= 'me';
  guard();
  const requestedAccess: Access = o.identity === 'bot' ? 'full' : access;
  if (!c.key) {
    c.key = await api.mintAgentKey(c.agentId, {
      label: c.label,
      scopes:
        requestedAccess === 'full' || requestedAccess === 'manage'
          ? scopesForAccess(requestedAccess)
          : ['workspace:read'],
      workspaceId: o.workspace,
      workspaceLocked: requestedAccess === 'read' || requestedAccess === 'trade',
    });
    guard();
  }
  if (!c.joined) {
    c.joined = (await api.joinWorkspaceWithKey(o.workspace, c.key.apiKey)).role;
    guard();
  }
  if (!c.access) {
    if (requestedAccess === 'full' || requestedAccess === 'manage') c.access = requestedAccess;
    else if (access === 'trade' && c.joined === 'trader') {
      await api.updateAgentKey(c.agentId, c.key.keyId, { scopes: tradingScopes });
      guard();
      c.access = 'trade';
    } else c.access = 'read';
  }
  // Include keys whose create/mint response was lost. Only this setup's unique
  // label is eligible, so recovery never revokes an unrelated key.
  const keys: Array<{ keyId: string; label: string | null }> = await api.listAgentKeys(c.agentId);
  guard();
  for (const key of keys)
    if (key.label === c.label && key.keyId !== c.key.keyId) {
      await api.revokeAgentKey(c.agentId, key.keyId);
      guard();
    }
  if (o.identity === 'me' && o.botName.trim()) {
    await api.updateAgentKey(c.agentId, c.key.keyId, { label: o.botName.trim() });
    guard();
  }
  c.complete = true;
}
