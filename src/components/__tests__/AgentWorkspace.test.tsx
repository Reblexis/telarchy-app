import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { api } from '../../lib/api';
import { AgentWorkspace } from '../AgentWorkspace';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null, loading: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../AgentBuilder', () => ({
  AgentBuilder: ({ onConnected }: { onConnected: () => void }) => (
    <button onClick={onConnected}>Complete test setup</button>
  ),
}));
vi.mock('../../lib/api', () => ({ api: { getMyAgents: vi.fn(), listAgentKeys: vi.fn(), listWorkspaces: vi.fn() } }));
const renderPage = () => (
  <MemoryRouter>
    <AgentWorkspace />
  </MemoryRouter>
);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api.listWorkspaces).mockResolvedValue([]);
  auth.user = null;
});
test('anonymous visitors get a login link, not an owned-agent request', () => {
  render(
    <MemoryRouter initialEntries={['/agents#manage-agents']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Log in to manage agents and keys' })).toBeTruthy();
  expect(api.getMyAgents).not.toHaveBeenCalled();
});
test('changing accounts removes prior identities and key metadata immediately', async () => {
  auth.user = { id: 'alice' };
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'alice-account', authUserId: 'alice', balance: 20 }] as never);
  vi.mocked(api.listAgentKeys).mockResolvedValue([
    { keyId: 'alice-key', label: 'Alice secret connection', scopes: ['workspace:read'], workspaceId: 'workspace' },
  ] as never);
  const view = render(renderPage());
  await screen.findByText('Alice secret connection');
  vi.mocked(api.getMyAgents).mockReturnValue(new Promise(() => {}));
  auth.user = { id: 'bob' };
  view.rerender(renderPage());
  expect(screen.queryByText('Alice secret connection')).toBeNull();
  expect(screen.queryByText('20 credits available')).toBeNull();
});
test('finishing setup refreshes the management list', async () => {
  auth.user = { id: 'alice' };
  vi.mocked(api.getMyAgents).mockResolvedValue([]);
  render(renderPage());
  await screen.findByText(/No bots yet/);
  vi.mocked(api.getMyAgents).mockResolvedValue([
    { id: 'new-bot', authUserId: null, balance: 0, totalTrades: 0 },
  ] as never);
  fireEvent.click(screen.getByRole('button', { name: 'New bot' }));
  fireEvent.click(screen.getByText('Complete test setup'));
  expect(screen.queryByRole('button', { name: 'Complete test setup' })).toBeNull();
  await screen.findByText('new-bot');
});

test('the account-menu destination scrolls straight to management', async () => {
  const scroll = vi.fn();
  HTMLElement.prototype.scrollIntoView = scroll;
  render(
    <MemoryRouter initialEntries={['/agents#manage-agents']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  await waitFor(() => expect(scroll).toHaveBeenCalled());
});

test('ONE SURFACE: there are no task tabs, signed in or not', () => {
  auth.user = { id: 'alice' };
  vi.mocked(api.getMyAgents).mockResolvedValue([]);
  const view = render(renderPage());
  expect(screen.queryByRole('link', { name: 'Your connections' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Set up an agent' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Complete test setup' })).toBeNull();
  view.unmount();
  auth.user = null;
  render(renderPage());
  expect(screen.queryByRole('link', { name: 'Your connections' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Complete test setup' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Log in to manage agents and keys' })).toBeVisible();
});

test('New bot opens the form inside the Bots section and Cancel closes it', async () => {
  auth.user = { id: 'alice' };
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'alice-account', authUserId: 'alice', balance: 20 }] as never);
  render(renderPage());
  fireEvent.click(await screen.findByRole('button', { name: 'New bot' }));
  expect(screen.getByRole('button', { name: 'Complete test setup' })).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel new bot' }));
  expect(screen.queryByRole('button', { name: 'Complete test setup' })).toBeNull();
});

test('a builder handoff opens the new-bot form directly even when signed in', () => {
  auth.user = { id: 'alice' };
  vi.mocked(api.getMyAgents).mockResolvedValue([]);
  render(
    <MemoryRouter initialEntries={['/agents#agent-setup']}>
      <AgentWorkspace />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: 'Complete test setup' })).toBeVisible();
});
