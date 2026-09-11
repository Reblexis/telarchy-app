import { beforeEach, expect, test, vi } from 'vitest';
import { builderPrompt, type Connection, connectBuilder, defaults, readOptions } from '../agent-builder';
import { api } from '../api';

vi.mock('../api', () => ({
  api: Object.fromEntries(
    [
      'getMyAgents',
      'createAgent',
      'mintAgentKey',
      'joinWorkspace',
      'joinWorkspaceWithKey',
      'updateAgentKey',
      'listAgentKeys',
      'revokeAgentKey',
    ].map(k => [k, vi.fn()]),
  ),
}));
const opts = { ...defaults, workspace: 'ws-one', botName: 'my-bot', credits: '5' };
let checkpoint: Connection;
beforeEach(() => {
  vi.resetAllMocks();
  checkpoint = { label: 'setup-unique' };
  vi.mocked(api.getMyAgents).mockResolvedValue([]);
  vi.mocked(api.createAgent).mockResolvedValue({
    agentId: 'my-bot',
    apiKey: 'bootstrap-secret',
    keyId: 'boot',
    initialCredits: 5,
  });
  vi.mocked(api.mintAgentKey).mockResolvedValue({
    keyId: 'final',
    apiKey: 'secret',
    scopes: ['workspace:read'],
    workspaceId: 'ws-one',
    workspaceLocked: true,
  });
  vi.mocked(api.joinWorkspaceWithKey).mockResolvedValue({ role: 'trader' });
  vi.mocked(api.listAgentKeys).mockResolvedValue([
    { keyId: 'boot', label: 'setup-unique' },
    { keyId: 'final', label: 'setup-unique' },
  ]);
});
for (const identity of ['bot', 'me'] as const)
  for (const access of ['read', 'trade'] as const)
    test(`PROMPT CARRIES IDENTITY AND PERMISSION: ${identity}/${access}`, () => {
      const text = builderPrompt('https://example.test/beta', { ...opts, identity, access });
      expect(text).toContain('https://example.test/beta/guides/build-agent');
      expect(text).toContain('ws-one');
      expect(text).toContain(identity === 'bot' ? 'separate bot' : 'existing identity');
      expect(text).toContain(access === 'read' ? 'Do not place live trades' : 'Review the dry run');
      for (const detail of [
        'deterministic',
        'LLM',
        'tools',
        'from scratch',
        'own server',
        'reference-agent',
        'funding',
      ])
        expect(text).toContain(detail);
      expect(text).not.toContain('bootstrap-secret');
    });
test('NO WORKSPACE REQUIRED TO START WITH A PROMPT', () => {
  const text = builderPrompt('https://example.test', defaults);
  expect(text).toContain('/api/marketplace/workspaces/public');
  expect(text).not.toContain('Workspace id: ""');
});
test('STORAGE IS AN ALLOWLIST, NEVER A KEY STORE', () => {
  expect(readOptions({ ...opts, identity: 'bad', apiKey: 'secret', credits: 'Infinity' })).toEqual({
    ...opts,
    identity: 'bot',
    credits: '100',
  });
  expect(readOptions(null)).toEqual(defaults);
});
test('COPY CONFIG DOES NOT CALL THE API', () => {
  builderPrompt('https://example.test', opts);
  expect(api.createAgent).not.toHaveBeenCalled();
});
test('CREATE AND FUND ONCE, JOIN AS THE BOT, TRADE ONLY AFTER JOIN, CLEAN UP TEMPORARY KEYS', async () => {
  await connectBuilder(opts, 'trade', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledWith(
    { agentId: 'my-bot', initialCredits: 5, keyLabel: 'setup-unique', keyScopes: ['workspace:read'] },
    'ws-one',
  );
  expect(api.mintAgentKey).toHaveBeenCalledWith('my-bot', {
    label: 'setup-unique',
    scopes: ['*'],
    workspaceId: 'ws-one',
    workspaceLocked: false,
  });
  expect(api.joinWorkspace).toHaveBeenCalledWith('ws-one');
  expect(api.joinWorkspaceWithKey).toHaveBeenCalledWith('ws-one', 'secret');
  expect(api.updateAgentKey).not.toHaveBeenCalled();
  expect(api.revokeAgentKey).toHaveBeenCalledWith('my-bot', 'boot');
  expect(checkpoint.complete).toBe(true);
  await connectBuilder(opts, 'trade', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledTimes(1);
});
test('ACT AS ME NEVER CREATES OR FUNDS A BOT', async () => {
  await connectBuilder({ ...opts, identity: 'me' }, 'read', checkpoint, () => true);
  expect(api.createAgent).not.toHaveBeenCalled();
  expect(api.mintAgentKey).toHaveBeenCalledWith('me', expect.objectContaining({ workspaceLocked: true }));
  expect(api.updateAgentKey).toHaveBeenCalledWith('me', 'final', { label: 'my-bot' });
});
for (const credits of ['-1', 'Infinity', 'NaN', '', '1e999'])
  test(`INVALID FUNDING NEVER WRITES: ${credits}`, async () => {
    await expect(connectBuilder({ ...opts, credits }, 'read', checkpoint, () => true)).rejects.toThrow();
    expect(api.createAgent).not.toHaveBeenCalled();
  });
test('ZERO CREDITS IS VALID', async () => {
  await connectBuilder({ ...opts, credits: '0' }, 'read', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ initialCredits: 0 }), 'ws-one');
});
test('AN EXISTING BOT NAME IS NEVER FUNDED BY CREATE', async () => {
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'my-bot', authUserId: null }] as never);
  await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow(/already/);
  expect(api.createAgent).not.toHaveBeenCalled();
});
test('LOST CREATE RESPONSE RECOVERS OWNERSHIP WITHOUT ANOTHER TRANSFER', async () => {
  vi.mocked(api.createAgent).mockRejectedValueOnce(new Error('Network lost'));
  await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow();
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'my-bot', authUserId: null }] as never);
  await connectBuilder(opts, 'read', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledTimes(1);
  expect(checkpoint.complete).toBe(true);
});
test('UNCERTAIN CREATION CANNOT BE BLINDLY REPEATED', async () => {
  vi.mocked(api.createAgent).mockRejectedValueOnce(new Error('Network lost'));
  await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow();
  await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow(/confirm/);
  expect(api.createAgent).toHaveBeenCalledTimes(1);
});
for (const stage of [
  'mintAgentKey',
  'joinWorkspace',
  'joinWorkspaceWithKey',
  'listAgentKeys',
  'revokeAgentKey',
] as const)
  test(`RESUME ${stage} DOES NOT CREATE OR FUND AGAIN`, async () => {
    vi.mocked(api[stage]).mockRejectedValueOnce(new Error('Try again'));
    await expect(connectBuilder(opts, 'trade', checkpoint, () => true)).rejects.toThrow('Try again');
    await connectBuilder(opts, 'trade', checkpoint, () => true);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
    expect(checkpoint.complete).toBe(true);
  });
test('VIEWER WORKSPACE NEVER GETS A TRADING KEY', async () => {
  vi.mocked(api.joinWorkspaceWithKey).mockResolvedValue({ role: 'viewer' });
  await connectBuilder({ ...opts, identity: 'me', botName: '' }, 'trade', checkpoint, () => true);
  expect(api.updateAgentKey).not.toHaveBeenCalled();
  expect(checkpoint.access).toBe('read');
});
test('ACCOUNT CHANGE STOPS ALL SUBSEQUENT WRITES', async () => {
  let current = true;
  vi.mocked(api.createAgent).mockImplementationOnce(async () => {
    current = false;
    return { agentId: 'my-bot', apiKey: 'secret', keyId: 'boot', initialCredits: 5 };
  });
  await expect(connectBuilder(opts, 'trade', checkpoint, () => current)).rejects.toThrow(/account/);
  expect(api.mintAgentKey).not.toHaveBeenCalled();
});

test('an unnamed bot retains one generated identity across an uncertain creation retry', async () => {
  vi.mocked(api.createAgent).mockRejectedValueOnce(new Error('lost response'));
  await expect(connectBuilder({ ...opts, botName: '' }, 'read', checkpoint, () => true)).rejects.toThrow(
    'lost response',
  );
  const generated = vi.mocked(api.createAgent).mock.calls[0][0].agentId;
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: generated, authUserId: null }] as never);
  await connectBuilder({ ...opts, botName: '' }, 'read', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledTimes(1);
  expect(checkpoint.agentId).toBe(generated);
});

test('a connected prompt reuses the existing bot without funding or creating it again', () => {
  const prompt = builderPrompt('https://example.test', opts, 'existing-bot');
  expect(prompt).toContain('Use my existing connection "existing-bot"');
  expect(prompt).toContain('Do not create another participant');
  expect(prompt).not.toContain('Guide me through choosing its name');
});

test.each(['manage', 'full'] as const)(
  'personal %s access uses the corresponding scope without workspace lock',
  async access => {
    await connectBuilder({ ...opts, identity: 'me', access }, access, checkpoint, () => true);
    expect(api.mintAgentKey).toHaveBeenCalledWith(
      'me',
      expect.objectContaining({
        scopes: access === 'full' ? ['*'] : ['workspace:read', 'workspace:trade', 'workspace:manage'],
        workspaceLocked: false,
      }),
    );
    expect(checkpoint.access).toBe(access);
  },
);
test('new bots always receive full access to their own identity', async () => {
  await connectBuilder(opts, 'read', checkpoint, () => true);
  expect(api.mintAgentKey).toHaveBeenCalledWith(
    'my-bot',
    expect.objectContaining({ scopes: ['*'], workspaceLocked: false }),
  );
  expect(checkpoint.access).toBe('full');
});
