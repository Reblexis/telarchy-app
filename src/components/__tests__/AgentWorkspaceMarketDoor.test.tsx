import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
      "agent.py --workspace 'lookpilot'",
    );
  });
});

/* Persona run 2026-09-17, the bot author: "I found a starter bot, but I still
   cannot tell it where to read the chess game." The guide link stood under the
   floor's door until the door became a bare row (docs/audience-pages.md, "The
   door from a market"); the form the door opens carries it now. */
describe('a fed market links to its own bot guide on the form its door opens', () => {
  const GUIDE = 'https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md';
  const NAME = 'How to trade chess with a bot: the game feed, a dry run, a reference bot';
  test('the chess door shows "How to trade chess with a bot", opening the guide in a new tab', async () => {
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      workspaceId: 'ws-chess',
      name: 'Chess',
      slug: 'chess',
      liveFeed: { kind: 'chess', url: 'https://chess.example.com' },
    } as never);
    mount('/agents?market=chess#agent-setup');
    const link = await screen.findByRole('link', { name: NAME });
    expect(link).toHaveAttribute('href', GUIDE);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toMatch(/noopener/);
    expect(link.closest('#agent-setup')).toBeTruthy();
  });
  test('a market with no feed, a feed with no guide, and the plain form carry no such link', async () => {
    mount();
    await screen.findByLabelText('Bot name');
    expect(screen.queryByRole('link', { name: /How to trade/ })).toBeNull();
    vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
      workspaceId: 'ws-snake',
      name: 'Snake',
      slug: 'snake',
      liveFeed: { kind: 'snake', url: 'https://snake.example.com' },
    } as never);
    mount('/agents?market=snake#agent-setup');
    await waitFor(() => expect(screen.getAllByLabelText('Bot name').length).toBe(2));
    expect(screen.queryByRole('link', { name: /How to trade/ })).toBeNull();
  });
  test('the plain Agents page, with no market in the address, carries no guide link', async () => {
    vi.mocked(api.getPublicWorkspaces).mockResolvedValue([] as never);
    mount('/agents#agent-setup');
    await screen.findByLabelText('Bot name');
    expect(screen.queryByRole('link', { name: /How to trade/ })).toBeNull();
  });
});

/* Owner report 2026-09-18: the guide link sat beside "New bot", squeezed the
   heading onto two lines and ran under Cancel. */
test('THE GUIDE LINK TAKES ITS OWN LINE UNDER THE HEADING, never beside it or under Cancel', async () => {
  vi.mocked(api.getMarketplaceWorkspace).mockResolvedValue({
    workspaceId: 'ws-chess',
    name: 'Chess',
    slug: 'chess',
    liveFeed: { kind: 'chess', url: 'https://chess.example.com' },
  } as never);
  mount('/agents?market=chess#agent-setup');
  const link = await screen.findByRole('link', { name: /How to trade chess with a bot/ });
  const heading = screen.getByRole('heading', { name: 'New bot' });
  expect(link.parentElement).toBe(heading.parentElement);
  expect(heading.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const css = readFileSync(join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))), 'style.css'), 'utf8');
  const head = css.match(/\.agents-page \.agent-new-bot \.builder-heading\s*\{([^}]*)\}/);
  expect(head).toBeTruthy();
  expect(head![1]).toMatch(/flex-wrap:\s*wrap/);
  const guide = css.match(/\.agents-page \.agent-new-bot \.builder-feed-guide\s*\{([^}]*)\}/);
  expect(guide).toBeTruthy();
  expect(guide![1]).toMatch(/flex-basis:\s*100%/);
});
