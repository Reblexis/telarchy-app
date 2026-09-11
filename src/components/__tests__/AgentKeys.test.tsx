import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../lib/api';
import { AgentKeys } from '../AgentKeys';

vi.mock('../../lib/api', () => ({
  api: Object.fromEntries(
    ['listAgentKeys', 'mintAgentKey', 'updateAgentKey', 'revokeAgentKey', 'getPublicWorkspaces'].map(k => [k, vi.fn()]),
  ),
}));
const key = {
  keyId: 'key-one',
  label: 'Production',
  scopes: ['*'],
  workspaceId: 'ws-one',
  createdAt: '2026-09-01',
  lastUsedAt: null,
  hashPrefix: '12345678',
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
    { workspaceId: 'ws-one', name: 'Telarchy', slug: 'telarchy' },
  ] as any);
  vi.mocked(api.listAgentKeys).mockResolvedValue([key]);
  vi.mocked(api.mintAgentKey).mockResolvedValue({
    keyId: 'new',
    apiKey: 'secret-once',
    scopes: ['workspace:read'],
    workspaceId: 'ws-one',
    workspaceLocked: true,
  });
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
const mount = () => render(<AgentKeys agentId="bot-one" identity="me" />);
test('shows existing key metadata without pretending it can reveal the secret', async () => {
  mount();
  await screen.findByText('Production');
  expect(screen.getByText('Full access')).toBeTruthy();
  expect(screen.queryByText(/Default workspace/)).toBeNull();
  expect(screen.queryByText('Technical details')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh keys' })).toBeNull();
  expect(screen.getByText('Full access')).toHaveAttribute('title', 'Can use every permission this account has.');
  expect(screen.queryByText('Can use every permission this account has.')).toBeNull();
  expect(screen.queryByText('Copy key')).toBeNull();
});
test('renaming a key preserves custom permissions', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Production' }));
  fireEvent.change(screen.getByLabelText('Key label'), { target: { value: 'Laptop' } });
  fireEvent.click(screen.getByText('Save key'));
  await waitFor(() => expect(api.updateAgentKey).toHaveBeenCalledWith('bot-one', 'key-one', { label: 'Laptop' }));
});
test('permission changes replace scopes only after an explicit save', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Production' }));
  fireEvent.change(screen.getByLabelText('Key permissions'), { target: { value: 'read' } });
  expect(api.updateAgentKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Save key'));
  await waitFor(() =>
    expect(api.updateAgentKey).toHaveBeenCalledWith('bot-one', 'key-one', {
      label: 'Production',
      scopes: ['workspace:read'],
    }),
  );
});
test('revoking identifies the key and requires confirmation', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke Production' }));
  expect(api.revokeAgentKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Confirm revoke'));
  await waitFor(() => expect(api.revokeAgentKey).toHaveBeenCalledWith('bot-one', 'key-one'));
});
async function mint() {
  mount();
  fireEvent.click(await screen.findByText('Create key'));
  fireEvent.click(screen.getByText('Create account key'));
  await screen.findByText('secret-once');
}
test('new keys are locked, read-only by default, and shown only until dismissed', async () => {
  await mint();
  expect(api.mintAgentKey).toHaveBeenCalledWith(
    'bot-one',
    expect.objectContaining({ workspaceId: 'ws-one', workspaceLocked: true, scopes: ['workspace:read'] }),
  );
  fireEvent.click(screen.getByText('Dismiss key'));
  expect(screen.queryByText('secret-once')).toBeNull();
});
test('clipboard failure leaves the key selectable', async () => {
  await mint();
  vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('blocked'));
  fireEvent.click(screen.getByText('Copy key'));
  await screen.findByText(/Copy failed/);
  expect(screen.getByText('secret-once')).toBeTruthy();
});
test('a failed revoke stays visible and does not remove the row', async () => {
  vi.mocked(api.revokeAgentKey).mockRejectedValue(new Error('Access denied'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Revoke Production' }));
  fireEvent.click(screen.getByText('Confirm revoke'));
  await screen.findByText('Access denied');
  expect(screen.getByText('Production')).toBeTruthy();
});
test('a response after unmount cannot disclose a key or fetch another account', async () => {
  let release!: (v: any) => void;
  vi.mocked(api.mintAgentKey).mockImplementation(
    () =>
      new Promise(r => {
        release = r;
      }),
  );
  const view = mount();
  fireEvent.click(await screen.findByText('Create key'));
  fireEvent.click(screen.getByText('Create account key'));
  await waitFor(() => expect(api.mintAgentKey).toHaveBeenCalled());
  view.unmount();
  await act(async () => release({ apiKey: 'old-account-secret' }));
  expect(api.listAgentKeys).toHaveBeenCalledTimes(1);
});

test.each([
  { scopes: [], title: 'No permissions', explanation: 'This key has no API permissions.' },
  {
    scopes: ['workspace:read'],
    title: 'Research only',
    explanation: 'Can read market data. Cannot trade or make changes.',
  },
  {
    scopes: ['workspace:trade'],
    title: 'Trading only',
    explanation: 'Can place trades using this account’s credits. No market-reading permission.',
  },
  {
    scopes: ['workspace:read', 'workspace:trade'],
    title: 'Research and trading',
    explanation: 'Can read market data and trade using this account’s credits.',
  },
  {
    scopes: ['account:keys'],
    title: 'Custom permissions',
    explanation: 'Custom access: account:keys.',
  },
])('explains $title without claiming extra access', async ({ scopes, title, explanation }) => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([{ ...key, scopes }]);
  mount();
  expect(await screen.findByText(title)).toBeVisible();
  expect(screen.getByText(title)).toHaveAttribute('title', explanation);
});

test('failed key loading has a recovery action instead of a permanent refresh control', async () => {
  vi.mocked(api.listAgentKeys).mockRejectedValueOnce(new Error('offline'));
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Try loading again' }));
  expect(await screen.findByText('Production')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Try loading again' })).toBeNull();
});

test('uncertain creation can be checked without blindly minting another key', async () => {
  vi.mocked(api.mintAgentKey).mockRejectedValueOnce(new Error('response lost'));
  mount();
  fireEvent.click(await screen.findByText('Create key'));
  fireEvent.click(screen.getByText('Create account key'));
  const check = await screen.findByRole('button', { name: 'Check creation status' });
  expect(screen.getByText('Create account key')).toBeDisabled();
  fireEvent.click(check);
  await waitFor(() => expect(screen.getByText('Create account key')).toBeEnabled());
  expect(api.mintAgentKey).toHaveBeenCalledTimes(1);
});

test('a first key uses Telarchy without workspace settings', async () => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([]);
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Create key', exact: true }));
  expect(screen.queryByLabelText('Workspace')).toBeNull();
  expect(screen.queryByLabelText('Workspace ID')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Create account key' }));
  await waitFor(() =>
    expect(api.mintAgentKey).toHaveBeenCalledWith(
      'bot-one',
      expect.objectContaining({ workspaceId: 'ws-one', workspaceLocked: true }),
    ),
  );
});

test('key creation stays before the existing list, including on busy accounts', async () => {
  mount();
  const label = await screen.findByText('Production');
  const create = screen.getByRole('button', { name: 'Create key', exact: true });
  expect(create.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test('personal keys retain runtime instructions with their actual trading access', async () => {
  render(
    <MemoryRouter>
      <AgentKeys agentId="human-id" identity="me" />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Run Production' }));
  fireEvent.click(screen.getByRole('button', { name: 'Set up manually' }));
  expect(screen.getByText('After the preview: allow live trading')).toBeVisible();
  expect((screen.getByLabelText('Setup prompt') as HTMLTextAreaElement).value).toContain(
    'Use my existing connection "human-id"',
  );
});

test('bot setup without a key opens the key form without creating credentials', async () => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([]);
  render(<AgentKeys agentId="bot-one" setupRequested={1} />);
  expect(await screen.findByLabelText('New key label')).toBeVisible();
  expect(api.mintAgentKey).not.toHaveBeenCalled();
});

test('new bot keys have full access without permission settings', async () => {
  render(<AgentKeys agentId="bot-one" />);
  fireEvent.click(await screen.findByText('Create key'));
  expect(screen.queryByLabelText('New key permissions')).toBeNull();
  fireEvent.click(screen.getByText('Create bot key'));
  await waitFor(() =>
    expect(api.mintAgentKey).toHaveBeenCalledWith(
      'bot-one',
      expect.objectContaining({ scopes: ['*'], workspaceLocked: false }),
    ),
  );
});
test.each(['manage', 'full'])('personal %s permission changes unlock workspace reach explicitly', async access => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Production' }));
  fireEvent.change(screen.getByLabelText('Key permissions'), { target: { value: access } });
  fireEvent.click(screen.getByText('Save key'));
  await waitFor(() =>
    expect(api.updateAgentKey).toHaveBeenCalledWith(
      'bot-one',
      'key-one',
      expect.objectContaining({
        workspaceLocked: false,
        scopes: access === 'full' ? ['*'] : ['workspace:read', 'workspace:trade', 'workspace:manage'],
      }),
    ),
  );
});
test('older restricted bot keys keep a Restricted label; only unlocked wildcard keys read as full bot access', async () => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([
    { ...key, keyId: 'wide', label: 'Wide', scopes: ['*'], workspaceLocked: false },
    { ...key, keyId: 'locked', label: 'Locked', scopes: ['*'], workspaceLocked: true },
    { ...key, keyId: 'narrow', label: 'Narrow', scopes: ['workspace:read'], workspaceLocked: false },
  ] as any);
  render(<AgentKeys agentId="bot-one" identity="bot" />);
  await screen.findByText('Wide');
  expect(screen.getAllByText('Full bot access')).toHaveLength(1);
  expect(screen.getAllByText('Restricted key')).toHaveLength(2);
});

test('bot keys have no per-key runtime action; personal keys have Run', async () => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([{ ...key, workspaceLocked: false }] as any);
  const bot = render(<AgentKeys agentId="bot-one" identity="bot" />);
  await screen.findByText('Production');
  expect(screen.queryByRole('button', { name: /Set up runtime for|^Run / })).toBeNull();
  bot.unmount();
  render(<AgentKeys agentId="me" identity="me" />);
  await screen.findByText('Production');
  fireEvent.click(screen.getByRole('button', { name: 'Run Production' }));
  expect(await screen.findByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
});

test('a create request from the section heading opens the key form without a duplicate button', async () => {
  const { rerender } = render(<AgentKeys agentId="me" identity="me" showCreate={false} createRequested={0} />);
  await screen.findByText('Production');
  expect(screen.queryByLabelText('New key label')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create key' })).toBeNull();
  rerender(<AgentKeys agentId="me" identity="me" showCreate={false} createRequested={1} />);
  expect(screen.getByLabelText('New key label')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel new key' }));
  expect(screen.queryByLabelText('New key label')).toBeNull();
});

test('the runtime key chooser defaults to the newest full-access key and names its access', async () => {
  vi.mocked(api.listAgentKeys).mockResolvedValue([
    {
      ...key,
      keyId: 'old-narrow',
      label: 'Old narrow',
      scopes: ['workspace:read'],
      workspaceLocked: true,
      createdAt: '2026-01-01',
    },
    {
      ...key,
      keyId: 'older-full',
      label: 'Older full',
      scopes: ['*'],
      workspaceLocked: false,
      createdAt: '2026-02-01',
    },
    {
      ...key,
      keyId: 'newer-full',
      label: 'Newer full',
      scopes: ['*'],
      workspaceLocked: false,
      createdAt: '2026-03-01',
    },
  ] as any);
  render(<AgentKeys agentId="bot-one" identity="bot" runtimeOnly setupRequested={1} />);
  expect(await screen.findByLabelText('Use key')).toHaveValue('newer-full');
  expect(screen.getByText('Full bot access')).toBeVisible();
});
