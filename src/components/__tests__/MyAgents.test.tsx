/**
 * The owner's view of the bots they pay for.
 *
 * Three things are load-bearing and the rest is layout: a bot that has done
 * nothing says so rather than showing a confident zero, the earned number is
 * the leaderboard's number, and funding comes out of the owner's own balance
 * with the page reflecting it afterwards.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { MyAgents } from '../MyAgents';

const getMyAgents = vi.fn();
const transferCredits = vi.fn(async () => ({ id: 't1' }));
const createAgent = vi.fn();

vi.mock('../../lib/api', () => ({
  api: {
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

/** Open the create form and fill the id. */
async function openCreate(id = 'new-bot') {
  fireEvent.click(await screen.findByText('Create an agent'));
  fireEvent.change(screen.getByLabelText(/Agent id/), { target: { value: id } });
}

describe('creating one', () => {
  test('THE RULE: the key is shown once, and the page says it cannot be fetched again', async () => {
    // The key is hashed on the server. If the owner closes this without
    // copying it, the bot is unusable and the only fix is a new key. So the
    // warning is part of the feature, not decoration.
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    await openCreate();
    fireEvent.click(screen.getByText('Create'));
    expect(await screen.findByText('tk_live_secret')).toBeInTheDocument();
    expect(screen.getByText(/shown once/i)).toBeInTheDocument();
  });

  test('it funds the bot out of your balance in the same call', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    await openCreate();
    fireEvent.change(screen.getByLabelText(/Starting credits/), { target: { value: '40' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() =>
      expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'new-bot', initialCredits: 40 })),
    );
  });

  test('zero starting credits is allowed, for a bot somebody else will fund', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    await openCreate();
    fireEvent.change(screen.getByLabelText(/Starting credits/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Create'));
    await waitFor(() => expect(createAgent).toHaveBeenCalledWith(expect.objectContaining({ initialCredits: 0 })));
  });

  test('the new bot shows up in the list without a reload', async () => {
    getMyAgents.mockResolvedValueOnce([me]).mockResolvedValue([me, agent({ id: 'new-bot' })]);
    render(<MyAgents />);
    await openCreate();
    fireEvent.click(screen.getByText('Create'));
    // Not the key panel's heading: the ROW, meaning the list actually reloaded.
    await waitFor(() => expect(document.querySelectorAll('.myagents-row')).toHaveLength(1));
    expect(document.querySelector('.myagents-name')?.textContent).toBe('new-bot');
  });

  test('an empty id is refused before the network', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    await openCreate('   ');
    fireEvent.click(screen.getByText('Create'));
    await screen.findByText(/needs an id/i);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('negative starting credits is refused before the network', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    await openCreate();
    fireEvent.change(screen.getByLabelText(/Starting credits/), { target: { value: '-5' } });
    fireEvent.click(screen.getByText('Create'));
    await screen.findByText(/zero or more/i);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('a refusal shows the reason and no key', async () => {
    getMyAgents.mockResolvedValue([me]);
    createAgent.mockRejectedValue(new Error('Insufficient balance: you have 5 credits'));
    render(<MyAgents />);
    await openCreate();
    fireEvent.click(screen.getByText('Create'));
    expect(await screen.findByText(/Insufficient balance: you have 5 credits/)).toBeInTheDocument();
    expect(screen.queryByText('tk_live_secret')).not.toBeInTheDocument();
  });
});

describe('what it says about each agent', () => {
  test('THE COMMON CASE: a bot that has never traded says so, not a confident zero', async () => {
    // 94 owned bots had registered and none had ever traded. "+0.00 earned"
    // would read as a result; "no trades yet" reads as the state it is.
    getMyAgents.mockResolvedValue([me, agent()]);
    render(<MyAgents />);
    expect(await screen.findByText('no trades yet')).toBeInTheDocument();
    expect(screen.queryByText(/0 cr earned/)).not.toBeInTheDocument();
  });

  test('a working bot shows what it earned and when it last acted', async () => {
    getMyAgents.mockResolvedValue([
      me,
      agent({ id: 'bot-good', earned: 12.5, totalTrades: 3, lastTradeAt: '2026-08-30T10:00:00Z' }),
    ]);
    render(<MyAgents />);
    expect(await screen.findByText(/\+12.5 cr earned/)).toBeInTheDocument();
    expect(screen.getByText(/3 trades, last 2026-08-30/)).toBeInTheDocument();
  });

  test('a losing bot is not dressed up', async () => {
    getMyAgents.mockResolvedValue([me, agent({ earned: -8, totalTrades: 2 })]);
    render(<MyAgents />);
    expect(await screen.findByText(/-8 cr earned/)).toBeInTheDocument();
  });

  test('your own participant is not listed as a bot you own', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(<MyAgents />);
    await screen.findByText('bot-one');
    expect(screen.queryByText('me')).not.toBeInTheDocument();
  });

  test('with no bots it explains what one is and how to make it', async () => {
    getMyAgents.mockResolvedValue([me]);
    render(<MyAgents />);
    expect(await screen.findByText(/You have none yet/)).toBeInTheDocument();
    expect(screen.getByText(/initialCredits/)).toBeInTheDocument();
  });
});

describe('funding one', () => {
  test('THE RULE: it sends from you to that bot, then reloads so the balance is true', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(<MyAgents />);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.change(screen.getByLabelText(/Credits to send to bot-one/), { target: { value: '30' } });
    fireEvent.click(screen.getByText('Send'));
    await waitFor(() => expect(transferCredits).toHaveBeenCalledWith('bot-one', 30, expect.any(String)));
    // Reloaded: the balance shown must be the balance after the transfer.
    await waitFor(() => expect(getMyAgents).toHaveBeenCalledTimes(2));
  });

  test('an amount that is not a positive number is refused before the network', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(<MyAgents />);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.change(screen.getByLabelText(/Credits to send/), { target: { value: '0' } });
    fireEvent.click(screen.getByText('Send'));
    await screen.findByText(/above zero/);
    expect(transferCredits).not.toHaveBeenCalled();
  });

  test('a refusal from the API is shown rather than swallowed', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    transferCredits.mockRejectedValue(new Error('Insufficient balance'));
    render(<MyAgents />);
    fireEvent.click(await screen.findByText('Send credits'));
    fireEvent.click(screen.getByText('Send'));
    expect(await screen.findByText(/Insufficient balance/)).toBeInTheDocument();
  });

  test('it says the credits come out of your own balance, and that getting them back is not a button', async () => {
    getMyAgents.mockResolvedValue([me, agent()]);
    render(<MyAgents />);
    expect(await screen.findByText(/out of your own balance/)).toBeInTheDocument();
    expect(screen.getByText(/needs the bot to send them itself/)).toBeInTheDocument();
  });
});
