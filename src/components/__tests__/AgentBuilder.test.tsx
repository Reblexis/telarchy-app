import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../lib/api';
import { AgentBuilder } from '../AgentBuilder';

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../lib/api', () => ({
  api: Object.fromEntries(
    [
      'getPublicWorkspaces',
      'getMyAgents',
      'createAgent',
      'mintAgentKey',
      'joinWorkspace',
      'joinWorkspaceWithKey',
      'listAgentKeys',
      'revokeAgentKey',
      'updateAgentKey',
      'transferCredits',
    ].map(k => [k, vi.fn()]),
  ),
}));
const copy = vi.fn();
const mount = (path = '/for-agents?workspace=ws-one') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AgentBuilder />
    </MemoryRouter>,
  );
const choose = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  auth.user = null;
  Object.assign(navigator, { clipboard: { writeText: copy } });
  copy.mockResolvedValue(undefined);
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
    { workspaceId: 'ws-one', name: 'One', slug: 'telarchy', visibility: 'public' },
  ]);
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'human', authUserId: 'user-one', balance: 20 }] as never);
  vi.mocked(api.createAgent).mockResolvedValue({
    agentId: 'my-bot',
    apiKey: 'bootstrap-secret',
    keyId: 'bootstrap',
    initialCredits: 5,
  });
  vi.mocked(api.mintAgentKey).mockResolvedValue({
    keyId: 'key-one',
    apiKey: 'actual-secret-key',
    scopes: ['workspace:read'],
    workspaceId: 'ws-one',
    workspaceLocked: true,
  });
  vi.mocked(api.joinWorkspaceWithKey).mockResolvedValue({ role: 'trader' });
  vi.mocked(api.listAgentKeys).mockResolvedValue([]);
});
async function connect(identity = 'bot') {
  auth.user = { id: 'user-one' };
  const view = mount();
  await screen.findByText('Your balance: 20 cr');
  choose('Bot name', 'my-bot');
  choose('Starting credits', '5');
  fireEvent.click(screen.getByRole('button', { name: 'Create bot & get key' }));
  await screen.findByText('actual-secret-key');
  return view;
}
test('ANONYMOUS COPY DOES NOT CREATE AN ACCOUNT, KEY, MEMBERSHIP OR TRANSFER', async () => {
  mount();
  await waitFor(() => expect((screen.getByLabelText('Setup prompt') as HTMLTextAreaElement).value).toContain('ws-one'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  await screen.findByText('Prompt copied');
  for (const name of [
    'createAgent',
    'mintAgentKey',
    'joinWorkspace',
    'joinWorkspaceWithKey',
    'transferCredits',
  ] as const)
    expect(api[name]).not.toHaveBeenCalled();
  expect(copy.mock.calls[0][0]).toContain('ws-one');
  expect(screen.getByRole('link', { name: 'Log in to connect' })).toHaveAttribute(
    'href',
    expect.stringContaining('next='),
  );
});
test('ONLY A NAME AND CREDITS ARE ASKED BEFORE COPYING, AND THE PROMPT ASKS FOR A FULL-ACCESS BOT', async () => {
  mount('/for-agents');
  expect(screen.queryByRole('radiogroup')).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Get your API key' })).toBeNull();
  expect(screen.queryByLabelText('Permissions')).toBeNull();
  expect(screen.queryByLabelText('Workspace')).toBeNull();
  expect(screen.queryByLabelText('Strategy')).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  await screen.findByText('Prompt copied');
  expect(screen.getByRole('status')).toHaveTextContent('Nothing is running yet.');
  expect(copy.mock.calls[0][0]).toContain('separate bot');
  expect(copy.mock.calls[0][0]).toContain('full access to this identity');
});
test('NAME AND CREDITS SURVIVE RELOAD', async () => {
  const view = mount();
  choose('Bot name', 'scout');
  choose('Starting credits', '40');
  view.unmount();
  mount();
  expect(screen.getByLabelText('Bot name')).toHaveValue('scout');
  expect(screen.getByLabelText('Starting credits')).toHaveValue(40);
});
test('INITIAL SETUP IGNORES WORKSPACE URL CUSTOMIZATION', async () => {
  mount('/for-agents?workspace=missing');
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  await screen.findByText('Prompt copied');
  expect(copy.mock.calls[0][0]).not.toContain('missing');
});
test('FAILED PUBLIC LIST CAN BE RETRIED', async () => {
  vi.mocked(api.getPublicWorkspaces).mockRejectedValueOnce(new Error('Offline'));
  mount();
  await screen.findByText('Offline');
  expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect((screen.getByLabelText('Setup prompt') as HTMLTextAreaElement).value).toContain('ws-one'));
});
test('FAILED COPY LEAVES SELECTABLE PROMPT AND NO FALSE SUCCESS', async () => {
  copy.mockRejectedValueOnce(new Error('Clipboard blocked'));
  mount();
  await waitFor(() => expect((screen.getByLabelText('Setup prompt') as HTMLTextAreaElement).value).toContain('ws-one'));
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  await screen.findByText(/Select the prompt below/);
  expect(screen.queryByText('Prompt copied')).toBeNull();
  expect((screen.getByLabelText('Setup prompt') as HTMLTextAreaElement).value).toContain('ws-one');
});
test('EXPLICIT NEW BOT CREATION SHOWS KEY SEPARATELY AND KEEPS IT OUT OF STORAGE', async () => {
  await connect();
  expect(api.createAgent).toHaveBeenCalledWith(expect.objectContaining({ initialCredits: 5 }), 'ws-one');
  expect(sessionStorage.getItem('telarchy-agent-builder')).not.toContain('actual-secret-key');
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  expect(copy.mock.calls[0][0]).not.toContain('actual-secret-key');
  expect(screen.getByText(/Connection ready. Your agent is not running yet/)).toBeTruthy();
});
test('INSUFFICIENT AND INVALID FUNDING CANNOT SUBMIT', async () => {
  auth.user = { id: 'user-one' };
  mount();
  await screen.findByText('Your balance: 20 cr');
  choose('Bot name', 'my-bot');
  for (const value of ['21', '-1', '']) {
    choose('Starting credits', value);
    expect(screen.getByRole('button', { name: /Create bot/ })).toBeDisabled();
  }
  choose('Starting credits', '0');
  expect(screen.getByRole('button', { name: 'Create bot & get key' })).toBeEnabled();
});
test('BOT CONNECTION HAS FULL ACCESS WITHOUT AN UPGRADE STEP', async () => {
  await connect();
  expect(screen.queryByText('Allow this key to trade')).toBeNull();
  expect(api.mintAgentKey).toHaveBeenCalledWith(
    'my-bot',
    expect.objectContaining({ scopes: ['*'], workspaceLocked: false }),
  );
});
test('ACCOUNT CHANGE HIDES THE KEY', async () => {
  const view = await connect();
  auth.user = null;
  view.rerender(
    <MemoryRouter>
      <AgentBuilder />
    </MemoryRouter>,
  );
  expect(screen.queryByText('actual-secret-key')).toBeNull();
});
test('UNCERTAIN TOPUP CANNOT BE REPEATED BEFORE CHECKING BALANCES', async () => {
  await connect();
  vi.mocked(api.transferCredits).mockRejectedValueOnce(new Error('Network lost'));
  choose('More credits', '3');
  fireEvent.click(screen.getByRole('button', { name: 'Send 3 credits' }));
  await screen.findByText(/Transfer result is uncertain/);
  expect(screen.getByRole('button', { name: 'Send 3 credits' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Check balances' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send 3 credits' })).toBeEnabled());
  expect(api.transferCredits).toHaveBeenCalledTimes(1);
});
test('DOUBLE CLICK DOES NOT CREATE TWO BOTS', async () => {
  let release!: (value: any) => void;
  vi.mocked(api.createAgent).mockImplementationOnce(
    () =>
      new Promise(r => {
        release = r;
      }),
  );
  auth.user = { id: 'user-one' };
  mount();
  await screen.findByText('Your balance: 20 cr');
  choose('Bot name', 'my-bot');
  choose('Starting credits', '5');
  const button = screen.getByRole('button', { name: 'Create bot & get key' });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api.createAgent).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Bot name')).toBeDisabled();
  await act(async () => release({ agentId: 'my-bot', apiKey: 'temp', keyId: 'temp', initialCredits: 0 }));
});

test('manual setup sits beside copying and reuses the connection form', async () => {
  mount('/agents');
  fireEvent.click(screen.getByRole('button', { name: 'Set up manually' }));
  expect(screen.getByRole('region', { name: 'Manual setup' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Copy preview commands' })).toBeEnabled();
  expect(screen.queryByLabelText('Workspace')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Hide manual setup' }));
  expect(screen.queryByRole('region', { name: 'Manual setup' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeEnabled();
});

test('KEY CREATION IS VISIBLE IMMEDIATELY AND REVEALS THE COPYABLE KEY WITHOUT DISCLOSURES', async () => {
  auth.user = { id: 'user-one' };
  mount();
  await screen.findByText('Your balance: 20 cr');
  expect(screen.queryByLabelText('Workspace')).toBeNull();
  expect(screen.getByLabelText('Bot name')).toBeVisible();
  expect(api.createAgent).not.toHaveBeenCalled();
  choose('Bot name', 'my-bot');
  choose('Starting credits', '0');
  fireEvent.click(screen.getByRole('button', { name: 'Create bot & get key' }));
  expect(await screen.findByText('actual-secret-key')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));
  expect(copy).toHaveBeenCalledWith('actual-secret-key');
});

test('MINIMAL SETUP uses Telarchy automatically, an optional name and 100 starting credits', async () => {
  auth.user = { id: 'user-one' };
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'human', authUserId: 'user-one', balance: 500 }] as never);
  vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
    { workspaceId: 'ws-one', name: 'Telarchy', slug: 'telarchy', visibility: 'public' },
  ]);
  mount('/agents?workspace=ignored');
  await screen.findByText('Your balance: 500 cr');
  expect(screen.queryByLabelText('Workspace')).toBeNull();
  expect(screen.getByLabelText('Bot name')).toHaveValue('');
  expect(screen.getByLabelText('Starting credits')).toHaveValue(100);
  fireEvent.click(screen.getByRole('button', { name: 'Create bot & get key' }));
  await screen.findByText('actual-secret-key');
  expect(api.createAgent).toHaveBeenCalledWith(
    expect.objectContaining({ agentId: expect.stringMatching(/^bot-/), initialCredits: 100 }),
    'ws-one',
  );
});

test('creation-only setup leaves runtime instructions with the connections', async () => {
  auth.user = { id: 'user-one' };
  render(
    <MemoryRouter>
      <AgentBuilder creationOnly />
    </MemoryRouter>,
  );
  await screen.findByRole('button', { name: 'Create bot & get key' });
  expect(screen.queryByRole('button', { name: 'Copy setup prompt' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Set up manually' })).toBeNull();
});

test('THE FORM IS BOT-ONLY: no identity or permission choice, just a name and credits under a New bot heading', async () => {
  auth.user = { id: 'user-one' };
  mount('/agents');
  await screen.findByText('Your balance: 20 cr');
  expect(screen.queryByRole('radio')).toBeNull();
  expect(screen.queryByLabelText('Permissions')).toBeNull();
  expect(screen.queryByText('Create a connection')).toBeNull();
  expect(screen.getByRole('heading', { name: 'New bot' })).toBeVisible();
  expect(screen.getByLabelText('Bot name')).toBeVisible();
  expect(screen.getByLabelText('Starting credits')).toHaveValue(100);
});
