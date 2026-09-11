/**
 * The owner's view of the bots they pay for.
 *
 * Three things are load-bearing and the rest is layout: a bot that has done
 * nothing says so rather than showing a confident zero, the earned number is
 * the leaderboard's number, and funding comes out of the owner's own balance
 * with the page reflecting it afterwards.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MyAgents } from '../MyAgents';

const getMyAgents = vi.fn();
const transferCredits = vi.fn(async () => ({ id: 't1' }));
const createAgent = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
    listWorkspaces: vi.fn(async () => []),
    listAgentKeys: vi.fn(async () => [
      { keyId: 'account-read', label: 'Research assistant', scopes: ['workspace:read'], workspaceId: 'demo' },
    ]),
    getMyAgents: (...a: unknown[]) => getMyAgents(...a),
    transferCredits: (...a: unknown[]) => transferCredits(...a),
    createAgent: (...a: unknown[]) => createAgent(...a),
  },
}));

const agent = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'bot-one',
  nickname: null,
  bio: null,
  balance: 25,
  earned: 0,
  settledEarnings: 0,
  openEarnings: 0,
  totalTrades: 0,
  lastTradeAt: null,
  authUserId: null,
  ownerUserId: 'u-1',
  ownerAgentId: null,
  ...over,
});

const me = agent({ id: 'me', authUserId: 'u-1', ownerUserId: null, balance: 500 });

beforeEach(() => {
  getMyAgents.mockReset();
  transferCredits.mockReset();
  createAgent.mockReset();
  transferCredits.mockResolvedValue({ id: 't1' });
  createAgent.mockResolvedValue({ agentId: 'new-bot', apiKey: 'tk_live_secret', initialCredits: 25 });
});

describe('what it says about each agent', () => {
  test('THE COMMON CASE: a bot that has never traded says so, not a confident zero', async () => {
    // 94 owned bots had registered and none had ever traded. "+0.00 earned"
    // would read as a result; "no trades yet" reads as the state it is.
    getMyAgents.mockResolvedValue([me, agent()]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    expect(await screen.findByText('no trades yet')).toBeInTheDocument();
    expect(screen.queryByText(/0 cr earned/)).not.toBeInTheDocument();
  });

  test('a working bot shows what it earned and when it last acted', async () => {
    getMyAgents.mockResolvedValue([
      me,
      agent({ id: 'bot-good', earned: 12.5, totalTrades: 3, lastTradeAt: '2026-08-30T10:00:00Z' }),
    ]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText('bot-good');
    expect(screen.getByTitle('Credits earned, the number the leaderboard ranks on')).toHaveTextContent('+12.5');
    expect(screen.getByTitle('Trades')).toHaveTextContent('last 2026-08-30');
  });

  test('a losing bot is not dressed up', async () => {
    getMyAgents.mockResolvedValue([me, agent({ earned: -8, totalTrades: 2 })]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText('bot-one');
    expect(screen.getByTitle('Credits earned, the number the leaderboard ranks on')).toHaveTextContent('-8');
  });

  test('your own participant is not listed as a bot you own', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText('bot-one');
    expect(screen.queryByText('me')).not.toBeInTheDocument();
  });

  test('with no bots it explains what one is and how to make it', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    expect(await screen.findByText(/No bots yet/)).toBeInTheDocument();
    expect(screen.getByText(/Give an agent its own balance and trading record/)).toBeInTheDocument();
  });
});

describe('funding one', () => {
  test('THE RULE: it sends from you to that bot, then reloads so the balance is true', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText(/no trades yet/);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.change(screen.getByLabelText(/Credits to send to bot-one/), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(transferCredits).toHaveBeenCalledWith('bot-one', 30, expect.any(String)));
    // Reloaded: the balance shown must be the balance after the transfer.
    await waitFor(() => expect(getMyAgents).toHaveBeenCalledTimes(2));
  });

  test('the confirmation names the bot the way the row does, and says the unit', async () => {
    // The row is headed by the nickname; saying "Sent 1 to admin" back at
    // someone who just clicked a row labelled "adminbot" reads as a different
    // bot, and a bare 1 reads as one transfer rather than one credit.
    getMyAgents.mockResolvedValue([me, agent({ id: 'admin', nickname: 'adminbot' })]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText(/no trades yet/);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.change(screen.getByLabelText(/Credits to send/), { target: { value: '1' } });
    fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByText('Sent 1 cr to adminbot')).toBeInTheDocument();
    // The API still gets the id, which is what it resolves.
    expect(transferCredits).toHaveBeenCalledWith('admin', 1, expect.any(String));
  });

  test('an amount that is not a positive number is refused before the network', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText(/no trades yet/);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.change(screen.getByLabelText(/Credits to send/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Send'));
    await screen.findByText(/above zero/);
    expect(transferCredits).not.toHaveBeenCalled();
  });

  test('a refusal from the API is shown rather than swallowed', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    transferCredits.mockRejectedValue(new Error('Insufficient balance'));
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText(/no trades yet/);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByText(/Insufficient balance/)).toBeInTheDocument();
  });

  test('it says the credits come out of your own balance, and that getting them back is not a button', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(
      <MemoryRouter>
        <MyAgents />
      </MemoryRouter>,
    );
    await screen.findByText(/no trades yet/);
    fireEvent.click(await screen.findByRole('button', { name: 'Send credits' }));
    expect(screen.getByText(/From your balance:/)).toBeInTheDocument();
    expect(screen.getByText(/To return credits/)).not.toBeVisible();
    fireEvent.click(screen.getByText('Returning credits'));
    expect(screen.getByText(/To return credits/)).toBeVisible();
  });
});

test('transfer guidance appears at the decision to send, not in the idle overview', async () => {
  getMyAgents.mockResolvedValue([me, agent()]);
  render(
    <MemoryRouter>
      <MyAgents />
    </MemoryRouter>,
  );
  await screen.findByText('bot-one');
  expect(screen.queryByText(/From your balance:/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Send credits' }));
  expect(screen.getByText(/From your balance:/)).toHaveTextContent('500 cr');
});

test.each([
  { id: 'bot-one', nickname: 'Revenue scout', shown: 'Revenue scout', path: 'bot-one' },
  { id: 'bot/one', nickname: null, shown: 'bot/one', path: 'bot%2Fone' },
])('bot name $shown opens its profile and retains the preview base', async ({ id, nickname, shown, path }) => {
  getMyAgents.mockResolvedValue([me, agent({ id, nickname })]);
  render(
    <MemoryRouter basename="/beta" initialEntries={['/beta/agents']}>
      <MyAgents />
    </MemoryRouter>,
  );
  expect(await screen.findByRole('link', { name: shown })).toHaveAttribute('href', `/beta/participants/${path}`);
});

test('A CARD PER BOT: prompt, credits and keys are one press away, nothing is named Set up or Manage', async () => {
  getMyAgents.mockResolvedValue([me, agent()]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  render(
    <MemoryRouter>
      <MyAgents onCreate={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByText('bot-one');
  expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Set up manually' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Send credits' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Keys for bot-one' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('button', { name: /^Set up bot|^Manage|^Open / })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh balances' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy setup prompt' }));
  await screen.findByText('Prompt copied');
  const prompt = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0] as string;
  expect(prompt).toContain('"bot-one"');
  expect(prompt).toContain('full access to this identity');
  expect(createAgent).not.toHaveBeenCalled();
});

test("the Keys toggle opens that bot's keys inside its card, with New key", async () => {
  getMyAgents.mockResolvedValue([me, agent(), agent({ id: 'bot-two' })]);
  render(
    <MemoryRouter>
      <MyAgents />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Keys for bot-two' }));
  expect(screen.getByRole('button', { name: 'Keys for bot-two' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Keys for bot-one' })).toHaveAttribute('aria-expanded', 'false');
  expect(await screen.findByText('Research assistant')).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'New key' })).toHaveLength(2);
});

test('CARD FACTS: credits, earned and trades are labelled cells, not sentences', async () => {
  getMyAgents.mockResolvedValue([
    me,
    agent({ earned: 12.5, totalTrades: 3, lastTradeAt: '2026-09-01T10:00:00Z', balance: 40 }),
  ]);
  render(
    <MemoryRouter>
      <MyAgents />
    </MemoryRouter>,
  );
  await screen.findByText('bot-one');
  expect(screen.getByTitle('Credits left')).toHaveTextContent('40');
  expect(screen.getByTitle('Credits earned, the number the leaderboard ranks on')).toHaveTextContent('+12.5');
  expect(screen.getByTitle('Trades')).toHaveTextContent('3');
  expect(screen.getByTitle('Trades')).toHaveTextContent('last 2026-09-01');
  expect(screen.queryByText(/cr left/)).toBeNull();
  expect(screen.queryByText(/earned$/)).toBeNull();
});

test('New bot on the Bots heading asks for the form; New key opens the inline key form', async () => {
  getMyAgents.mockResolvedValue([me, agent()]);
  const onCreate = vi.fn();
  render(
    <MemoryRouter>
      <MyAgents onCreate={onCreate} />
    </MemoryRouter>,
  );
  await screen.findByText('bot-one');
  fireEvent.click(screen.getByRole('button', { name: 'New bot' }));
  expect(onCreate).toHaveBeenCalledWith('bot');
  expect(await screen.findByText('Research assistant')).toBeVisible();
  expect(screen.queryByLabelText('New key label')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'New key' }));
  expect(screen.getByLabelText('New key label')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Set up an agent acting as me' })).toBeNull();
});

test('a personal key shows its access as a chip with the meaning as a title, no repeated sentence', async () => {
  getMyAgents.mockResolvedValue([me, agent()]);
  render(
    <MemoryRouter>
      <MyAgents />
    </MemoryRouter>,
  );
  expect(await screen.findByText('Research assistant')).toBeVisible();
  expect(screen.getByText('Research only')).toHaveAttribute(
    'title',
    'Can read market data. Cannot trade or make changes.',
  );
  expect(screen.queryByText('Can read market data. Cannot trade or make changes.')).toBeNull();
});

test('the new key remains available when the connections list fails to refresh', async () => {
  getMyAgents.mockRejectedValue(new Error('offline'));
  render(
    <MemoryRouter>
      <MyAgents
        created={{
          userId: 'u-1',
          options: { identity: 'bot', access: 'read', workspace: 'ws', botName: '', credits: '100' },
          connection: {
            agentId: 'new-bot',
            label: 'setup',
            key: {
              keyId: 'new-key',
              apiKey: 'saved-secret',
              scopes: ['workspace:read'],
              workspaceId: 'ws',
              workspaceLocked: true,
            },
          },
        }}
      />
    </MemoryRouter>,
  );
  expect(screen.getByText('saved-secret')).toBeVisible();
  await screen.findByText('offline');
  expect(screen.getByText('saved-secret')).toBeVisible();
});

test('A BOT CREATED HERE IS THE FIRST CARD WITH ITS KEY ABOVE THE ACTIONS, so nobody hunts for the key', async () => {
  getMyAgents.mockResolvedValue([me, agent({ id: 'new-bot' }), agent()]);
  render(
    <MemoryRouter>
      <MyAgents
        created={{
          userId: 'u-1',
          options: { identity: 'bot', access: 'full', workspace: 'ws', botName: '', credits: '100' },
          connection: {
            agentId: 'new-bot',
            label: 'setup',
            key: { keyId: 'new-key', apiKey: 'saved-secret', scopes: ['*'], workspaceId: 'ws', workspaceLocked: false },
          },
        }}
      />
    </MemoryRouter>,
  );
  const key = await screen.findByText('saved-secret');
  const names = screen.getAllByRole('link').map(l => l.textContent);
  expect(names.indexOf('new-bot')).toBeLessThan(names.indexOf('bot-one'));
  const run = screen.getAllByRole('button', { name: 'Copy setup prompt' })[0];
  expect(key.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
