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
    expect(screen.getByText('last trade 2026-08-30')).toBeVisible();
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

test('AN ONLY BOT STARTS OPEN: prompt, credits and keys are one press away, nothing is named Set up or Manage', async () => {
  getMyAgents.mockResolvedValue([me, agent()]);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  render(
    <MemoryRouter>
      <MyAgents onCreate={() => {}} />
    </MemoryRouter>,
  );
  await screen.findByText('bot-one');
  expect(screen.getByRole('button', { name: 'Actions for bot-one' })).toHaveAttribute('aria-expanded', 'true');
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
  expect(prompt).not.toContain('Workspace:');
  expect(prompt.split('\n')).toHaveLength(1);
  expect(createAgent).not.toHaveBeenCalled();
});

test("the Keys toggle opens that bot's keys inside its row, with New key", async () => {
  getMyAgents.mockResolvedValue([me, agent(), agent({ id: 'bot-two' })]);
  render(
    <MemoryRouter>
      <MyAgents />
    </MemoryRouter>,
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Actions for bot-two' }));
  fireEvent.click(screen.getByRole('button', { name: 'Keys for bot-two' }));
  expect(screen.getByRole('button', { name: 'Keys for bot-two' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByRole('button', { name: 'Keys for bot-one' })).toBeNull();
  expect(await screen.findByText('Research assistant')).toBeVisible();
  expect(screen.getAllByRole('button', { name: 'New key' })).toHaveLength(2);
});

test('ROW FACTS: credits, earned and trades are labelled cells, not sentences', async () => {
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
  expect(screen.getByTitle('Trades')).not.toHaveTextContent('last');
  expect(screen.getByText('last trade 2026-09-01')).toBeVisible();
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

test('A BOT CREATED HERE IS THE FIRST ROW, OPEN, WITH ITS KEY ABOVE THE ACTIONS, so nobody hunts for the key', async () => {
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
  expect(screen.getByRole('button', { name: 'Actions for new-bot' })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'Actions for bot-one' })).toHaveAttribute('aria-expanded', 'false');
  const run = screen.getByRole('button', { name: 'Copy setup prompt' });
  expect(key.compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

/* docs/audience-pages.md, "Agent page hierarchy": bots are hairline rows, one
   open at a time (owner pick 2026-09-18, direction B of the design canvas). */
describe('bots are rows that open, not cards', () => {
  const three = () =>
    getMyAgents.mockResolvedValue([
      me,
      agent({ balance: 40 }),
      agent({ id: 'bot-two', earned: -3, totalTrades: 2, lastTradeAt: '2026-09-02T10:00:00Z' }),
      agent({ id: 'bot-three', earned: 7, totalTrades: 9 }),
    ]);
  const mount = () =>
    render(
      <MemoryRouter>
        <MyAgents onCreate={() => {}} />
      </MemoryRouter>,
    );
  const toggle = (id: string) => screen.getByRole('button', { name: `Actions for ${id}` });

  test('WITH SEVERAL BOTS EVERY ROW STARTS CLOSED, and the numbers are still all on screen', async () => {
    three();
    mount();
    await screen.findByText('bot-three');
    for (const id of ['bot-one', 'bot-two', 'bot-three']) expect(toggle(id)).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Copy setup prompt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Send credits' })).toBeNull();
    expect(screen.queryByText(/last trade/)).toBeNull();
    expect(screen.getAllByTitle('Credits left').map(e => e.textContent)).toEqual([
      expect.stringContaining('40'),
      expect.stringContaining('25'),
      expect.stringContaining('25'),
    ]);
    expect(screen.getAllByTitle('Credits earned, the number the leaderboard ranks on')[1]).toHaveTextContent('-3');
    expect(screen.getAllByTitle('Trades')[2]).toHaveTextContent('9');
    expect(screen.getByText('no trades yet')).toBeVisible();
  });

  test('ONE ROW OPEN AT A TIME: opening a second closes the first, pressing the open one closes it', async () => {
    three();
    mount();
    await screen.findByText('bot-three');
    fireEvent.click(toggle('bot-two'));
    expect(toggle('bot-two')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: 'Copy setup prompt' })).toHaveLength(1);
    expect(screen.getByText('last trade 2026-09-02')).toBeVisible();
    fireEvent.click(toggle('bot-three'));
    expect(toggle('bot-two')).toHaveAttribute('aria-expanded', 'false');
    expect(toggle('bot-three')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByRole('button', { name: 'Copy setup prompt' })).toHaveLength(1);
    expect(screen.queryByText('last trade 2026-09-02')).toBeNull();
    fireEvent.click(toggle('bot-three'));
    expect(toggle('bot-three')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'Copy setup prompt' })).toBeNull();
  });

  test('a press anywhere on the row opens it, but the name is a link to the profile and opens nothing', async () => {
    three();
    mount();
    fireEvent.click(await screen.findByRole('link', { name: 'bot-two' }));
    expect(toggle('bot-two')).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(screen.getAllByTitle('Credits left')[1]);
    expect(toggle('bot-two')).toHaveAttribute('aria-expanded', 'true');
  });

  test('closing a row puts away what was open inside it: the send form does not come back on reopening', async () => {
    three();
    mount();
    await screen.findByText('bot-three');
    fireEvent.click(toggle('bot-one'));
    fireEvent.click(screen.getByRole('button', { name: 'Send credits' }));
    expect(screen.getByLabelText('Credits to send to bot-one')).toBeVisible();
    fireEvent.click(toggle('bot-one'));
    expect(screen.queryByLabelText('Credits to send to bot-one')).toBeNull();
    fireEvent.click(toggle('bot-one'));
    expect(screen.queryByLabelText('Credits to send to bot-one')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send credits' })).toBeVisible();
  });

  test('ONE CAPTION ROW FOR THE WHOLE TABLE: Bot, Credits, Earned, Trades, however many bots', async () => {
    three();
    const { container } = mount();
    await screen.findByText('bot-three');
    const heads = container.querySelectorAll('.agent-rows-head');
    expect(heads).toHaveLength(1);
    expect([...heads[0].children].map(c => c.textContent)).toEqual(['Bot', 'Credits', 'Earned', 'Trades', '']);
    expect(container.querySelectorAll('.agent-row')).toHaveLength(3);
    expect(container.querySelector('.agent-card, .agent-cards')).toBeNull();
  });

  test('NO BOT ROW CARRIES A FILLED BUTTON: the prompt button is outlined and the rest are text', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    const { container } = mount();
    await screen.findByText('bot-one');
    expect(container.querySelector('.agent-bots .agent-primary, .agent-bots .pubws-cta')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toHaveClass('agent-row-copy');
    for (const name of ['Set up manually', 'Send credits', 'Keys for bot-one'])
      expect(screen.getByRole('button', { name })).toHaveClass('agent-row-text');
  });

  test('a bot that never traded shows no last-trade line in its open row', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    mount();
    await screen.findByText('bot-one');
    expect(screen.getByRole('button', { name: 'Copy setup prompt' })).toBeVisible();
    expect(screen.queryByText(/last trade/)).toBeNull();
    expect(screen.getAllByText('no trades yet')).toHaveLength(1);
  });

  test('an unreadable last-trade date prints nothing rather than Invalid Date', async () => {
    getMyAgents.mockResolvedValue([me, agent({ totalTrades: 4, earned: 1, lastTradeAt: 'not-a-date' })]);
    mount();
    await screen.findByText('bot-one');
    expect(screen.queryByText(/last trade|Invalid/)).toBeNull();
  });
});
