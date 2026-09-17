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
const ACCESS_PHRASE = {
  read: 'research only, no trades',
  trade: 'read and trade where my key permits',
  manage: 'read, trade and manage',
  full: 'full access to this identity',
} as const;
// Written once, in the guide the prompt points at; the prompt repeats none of it.
const GUIDE_RULES = [
  'dry run',
  'credit per trade',
  'reference-agent',
  'TELARCHY_KEY',
  '/api/feedback',
  'stop commands',
];
for (const identity of ['bot', 'me'] as const)
  for (const access of ['read', 'trade', 'manage', 'full'] as const)
    test(`THE PROMPT ONLY POINTS AT THE SETUP GUIDE AND NAMES THIS SETUP: ${identity}/${access}`, () => {
      const text = builderPrompt('https://example.test/beta', { ...opts, identity, access });
      expect(text).toContain('https://example.test/beta/guides/build-agent');
      expect(text).not.toContain('ws-one');
      expect(text).not.toContain('Workspace:');
      expect(text.split('\n')).toHaveLength(1);
      expect(text).toContain(identity === 'bot' ? 'separate bot' : 'my own account');
      expect(text).toContain(ACCESS_PHRASE[access]);
      for (const rule of GUIDE_RULES) expect(text).not.toContain(rule);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(80);
      expect(text).not.toContain('bootstrap-secret');
    });
test('A CONNECTED BOT IS NEVER CREATED OR FUNDED AGAIN BY ITS PROMPT', () => {
  const text = builderPrompt('https://example.test', { ...opts, access: 'full' }, 'bot-one');
  expect(text).toContain('"bot-one"');
  expect(text).toContain('already created and funded');
  expect(text).not.toContain('separate bot');
});
test("A PERSONAL KEY'S PROMPT NEVER CALLS THE ACCOUNT A BOT", () => {
  const text = builderPrompt('https://example.test', { ...opts, identity: 'me', access: 'trade' }, 'human-id');
  expect(text).toContain('"human-id"');
  expect(text).toContain('my own account');
  expect(text).not.toContain('my bot');
  expect(text).not.toContain('funded');
});
test('NO WORKSPACE REQUIRED TO START WITH A PROMPT', () => {
  const text = builderPrompt('https://example.test', defaults);
  expect(text).not.toContain('Workspace:');
  expect(text).toBe(builderPrompt('https://example.test', { ...defaults, workspace: 'ignored' }));
  expect(text).not.toContain('""');
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
test('A BOT NAME TAKES ANY TEXT: IT IS FITTED INTO A HANDLE, NEVER REFUSED FOR ITS CHARACTERS', async () => {
  await connectBuilder({ ...opts, botName: '  My Bot!! v2 ' }, 'read', checkpoint, () => true);
  const sent = vi.mocked(api.createAgent).mock.calls[0][0] as { agentId: string; nickname?: string };
  expect(sent.nickname).toBe('My-Bot-v2');
  expect(sent.agentId).toMatch(/^bot-/);
});
test('A FITTED HANDLE STARTS WITH A LETTER OR DIGIT AND IS AT MOST 30 CHARACTERS', async () => {
  await connectBuilder({ ...opts, botName: `__-été ${'x'.repeat(50)}` }, 'read', checkpoint, () => true);
  const sent = vi.mocked(api.createAgent).mock.calls[0][0] as { nickname?: string };
  expect(sent.nickname).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{2,29}$/);
  expect(sent.nickname!.endsWith('-')).toBe(false);
});
for (const botName of ['!!', 'é', 'a b'.slice(0, 2), '🤖🤖🤖'])
  test(`A NAME TOO SHORT TO MAKE A HANDLE CREATES THE BOT WITH NONE: ${JSON.stringify(botName)}`, async () => {
    await connectBuilder({ ...opts, botName }, 'read', checkpoint, () => true);
    expect(vi.mocked(api.createAgent).mock.calls[0][0]).not.toHaveProperty('nickname');
  });
test('A REFUSED CREATION IS NOT AN UNCERTAIN ONE: NO FINISH CONNECTION, THE NEXT NAME IS TRIED', async () => {
  vi.mocked(api.createAgent).mockRejectedValueOnce(Object.assign(new Error('nickname is taken'), { status: 409 }));
  await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow(/taken/);
  expect(checkpoint.attempted).toBeFalsy();
  await connectBuilder({ ...opts, botName: 'other-bot' }, 'read', checkpoint, () => true);
  expect(api.createAgent).toHaveBeenCalledTimes(2);
  expect(vi.mocked(api.createAgent).mock.calls[1][0]).toMatchObject({ agentId: 'other-bot' });
  expect(checkpoint.complete).toBe(true);
});
for (const status of [500, 502, undefined])
  test(`A CREATION WHOSE ANSWER NEVER ARRIVED STAYS UNCERTAIN AND IS NEVER SENT TWICE: ${status}`, async () => {
    vi.mocked(api.createAgent).mockRejectedValueOnce(Object.assign(new Error('lost'), { status }));
    await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow();
    expect(checkpoint.attempted).toBe(true);
    await expect(connectBuilder(opts, 'read', checkpoint, () => true)).rejects.toThrow(/confirm/);
    expect(api.createAgent).toHaveBeenCalledTimes(1);
  });
