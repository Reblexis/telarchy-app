import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The door from a market (docs/audience-pages.md, "The door from a market";
 * owner ask 2026-09-16, "we alredty have the agents page so i think it would
 * be best to just reuse that").
 *
 * /agents?market=<slug> is the Agents page with the new-bot form open and
 * THAT market preset. The rules: the market is read by its slug and the
 * public list is never fetched; the form says which market; the bot is
 * created, funded and joined in that market; the card's manual commands name
 * the market by its slug and its prompt names no workspace; signed out, the login returns to this same
 * door; a market that cannot be read falls back to the plain form.
 */

const auth = vi.hoisted(() => ({ user: null as null | { id: string }, loading: false }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../lib/api', () => ({
  api: Object.fromEntries(
    [
      'getMarketplaceWorkspace',
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

import { api } from '../../lib/api';
import { AgentWorkspace } from '../AgentWorkspace';

const mount = (path = '/agents?market=lookpilot#agent-setup') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AgentWorkspace />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  auth.user = null;
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
    workspaceId: 'ws-lp',
    name: 'LookPilot',
    slug: 'lookpilot',
  } as never);
  vi.mocked(api.getMyAgents).mockResolvedValue([{ id: 'human', authUserId: 'user-one', balance: 250 }] as never);
  vi.mocked(api.listAgentKeys).mockResolvedValue([]);
  vi.mocked(api.createAgent).mockResolvedValue({
    agentId: 'my-lp-bot',
    apiKey: 'bootstrap-secret',
    keyId: 'bootstrap',
    initialCredits: 100,
  });
  vi.mocked(api.mintAgentKey).mockResolvedValue({
    keyId: 'key-one',
    apiKey: 'actual-secret-key',
    scopes: ['*'],
    workspaceId: 'ws-lp',
    workspaceLocked: false,
  });
  vi.mocked(api.joinWorkspaceWithKey).mockResolvedValue({ role: 'trader' });
});

describe('the form is about that market and nothing is chosen on it', () => {
  test('THE MARKET IS READ BY ITS SLUG, THE FORM DOES NOT CLAIM THE BOT IS SCOPED TO IT, and the public list is never fetched', async () => {
    mount();
    await screen.findByLabelText('Bot name');
    expect(screen.getByRole('heading', { name: 'New bot' })).toBeVisible();
    expect(screen.queryByText(/on LookPilot/)).toBeNull();
    expect(api.getMarketplaceWorkspace).toHaveBeenCalledWith('lookpilot');
    expect(api.getPublicWorkspaces).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Workspace')).toBeNull();
  });

  test('THE FORM WAITS FOR THE MARKET: no bot can be created in the default workspace meanwhile', async () => {
    let release: (v: never) => void = () => {};
    vi.mocked(api.getMarketplaceWorkspace).mockReturnValue(new Promise(r => (release = r)));
    mount();
    expect(screen.queryByLabelText('Bot name')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/market/i);
    release({ workspaceId: 'ws-lp', name: 'LookPilot', slug: 'lookpilot' } as never);
    expect(await screen.findByLabelText('Bot name')).toBeVisible();
  });

  test('a market that cannot be read falls back to the plain form', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockRejectedValue(new Error('404'));
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([
      { workspaceId: 'ws-home', name: 'Telarchy', slug: 'telarchy', visibility: 'public' },
    ]);
    mount();
    expect(await screen.findByRole('heading', { name: 'New bot' })).toBeVisible();
  });

  test('signed out, the login returns to this same door', async () => {
    mount();
    const login = await screen.findByRole('link', { name: 'Log in to connect' });
    expect(decodeURIComponent(login.getAttribute('href') ?? '')).toContain('/agents?market=lookpilot#agent-setup');
  });
});

describe('a bot created from a market lives in that market', () => {
  test('CREATION JOINS AND FUNDS THE BOT IN THAT MARKET, its commands name the market, its prompt does not', async () => {
    auth.user = { id: 'user-one' };
    mount();
    await screen.findByText('Your balance: 250 cr');
    fireEvent.change(screen.getByLabelText('Bot name'), { target: { value: 'my-lp-bot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create bot & get key' }));
    await waitFor(() => expect(api.joinWorkspaceWithKey).toHaveBeenCalledWith('ws-lp', 'actual-secret-key'));
    expect(api.joinWorkspace).toHaveBeenCalledWith('ws-lp');
    expect(api.createAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: 'my-lp-bot', initialCredits: 100 }),
      'ws-lp',
    );
    expect(api.mintAgentKey).toHaveBeenCalledWith(
      'my-lp-bot',
      expect.objectContaining({ workspaceId: 'ws-lp', scopes: ['*'], workspaceLocked: false }),
    );
    // THE PROMPT NAMES NO WORKSPACE, door or no door (owner, 2026-09-16:
    // "the user should specify what workspaces they want to focus on").
    const prompt = (await screen.findByLabelText('Setup prompt')) as HTMLTextAreaElement;
    expect(prompt.value).toContain('"my-lp-bot", already created and funded');
    expect(prompt.value).not.toContain('lookpilot');
    expect(prompt.value).not.toContain('ws-lp');
    expect(prompt.value).not.toContain('actual-secret-key');
    fireEvent.click(screen.getByRole('button', { name: 'Set up manually' }));
    expect(screen.getByRole('region', { name: 'Manual setup' }).textContent).toContain(
      "export TELARCHY_WORKSPACE='lookpilot'",
    );
  });
});
