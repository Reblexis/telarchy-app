import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ownerAgentPrompt } from '../../lib/agent-prompt';
import { AgentHandoff, AgentKeyOffer } from '../AgentHandoff';

/**
 * Handing the market to the operator's own agent
 * (docs/owner-on-the-floor.md, "Handing it to your own agent").
 *
 * Two things are load-bearing and both are tested here: the prompt carries
 * this market's real state rather than a template, and the key is never in
 * the prompt.
 */

const mintAgentKey = vi.fn(async () => ({
  keyId: 'k1',
  apiKey: 'deadbeef00',
  scopes: ['*'],
  workspaceId: 'ws-1',
  workspaceLocked: true,
}));
vi.mock('../../lib/api', () => ({ api: { mintAgentKey: (...a: unknown[]) => mintAgentKey(...(a as [])) } }));

const writeText = vi.fn(async () => {});
Object.assign(navigator, { clipboard: { writeText } });

const STATE = {
  workspaceId: 'ws-1',
  name: 'Harbour Roasters',
  idOrSlug: 'harbour-roasters',
  visibility: 'unlisted',
  metrics: [
    { name: 'Monthly bags roasted', value: 4200, markets: [{ targetDate: '2026-09', pool: 150 }] },
    { name: 'Wholesale accounts', value: null, markets: [] },
  ],
};

const FLOOR = { idOrSlug: 'harbour-roasters', name: 'Harbour Roasters' };

beforeEach(() => {
  writeText.mockClear();
  mintAgentKey.mockClear();
});

describe('the prompt', () => {
  test('names this market, what exists and what has no market yet', () => {
    const p = ownerAgentPrompt('https://telarchy.com', STATE);
    expect(p).toContain('Harbour Roasters');
    expect(p).toContain('ws-1');
    expect(p).toContain('https://telarchy.com/harbour-roasters');
    expect(p).toContain('"Monthly bags roasted", now reads 4,200, priced on 2026-09 with 150 credits behind it');
    // The one that would silently do nothing: a metric with no date.
    expect(p).toContain('"Wholesale accounts", never reported, and NO date, so it has no market');
  });

  test('says what the agent should ask before it does anything', () => {
    const p = ownerAgentPrompt('https://telarchy.com', STATE);
    expect(p).toMatch(/Ask me what I want before you change anything/);
    expect(p).toMatch(/Confirm with me before anything that spends credits/);
  });

  test('carries the traps that cost the operator money', () => {
    const p = ownerAgentPrompt('https://telarchy.com', STATE);
    expect(p).toContain('A metric with no horizon opens no market');
    expect(p).toContain('auto-funded with 0.5 credits');
    expect(p).toContain('walled wallet');
  });

  test('and never a key: a prompt is pasted where a secret must not go', () => {
    const p = ownerAgentPrompt('https://telarchy.com', STATE);
    expect(p).not.toMatch(/[0-9a-f]{32}/);
    expect(p).toContain('I will paste an API key');
  });

  test('an empty market says so, because that is the first thing to fix', () => {
    const p = ownerAgentPrompt('https://telarchy.com', { ...STATE, metrics: [] });
    expect(p).toContain('No metric yet, so there is nothing to trade');
  });
});

describe('the button', () => {
  test('copies the owner prompt and then offers a key', async () => {
    render(<AgentHandoff floor={FLOOR} state={STATE} canManage signedIn />);
    fireEvent.click(screen.getByText('Copy a prompt for your own AI'));
    expect(writeText).toHaveBeenCalledWith(ownerAgentPrompt(window.location.origin, STATE));
    expect(await screen.findByText('What may it do as you?')).toBeTruthy();
  });

  test('a visitor gets the reader prompt and no key offer', () => {
    render(<AgentHandoff floor={FLOOR} state={null} canManage={false} signedIn={false} />);
    fireEvent.click(screen.getByText('Copy a prompt for your own AI'));
    const copied = writeText.mock.calls[0][0] as unknown as string;
    expect(copied).toContain('context?format=md');
    expect(screen.queryByText('What may it do as you?')).toBeNull();
  });
});

describe('the key offer', () => {
  test('"only on this market" mints a wildcard key pinned to the workspace', async () => {
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('Only on this market'));
    await waitFor(() =>
      expect(mintAgentKey).toHaveBeenCalledWith('me', {
        label: 'Harbour Roasters · my own agent',
        scopes: ['*'],
        workspaceId: 'ws-1',
        workspaceLocked: true,
      }),
    );
    expect(await screen.findByText('deadbeef00')).toBeTruthy();
    expect(screen.getByText(/works on this market and nowhere else/)).toBeTruthy();
  });

  test('"everything I can do" is not pinned', async () => {
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('Everything I can do'));
    await waitFor(() => expect(mintAgentKey.mock.calls[0][1]).toMatchObject({ scopes: ['*'], workspaceLocked: false }));
  });

  test('"read only" can read and nothing else', async () => {
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('Read only'));
    await waitFor(() =>
      expect(mintAgentKey.mock.calls[0][1]).toMatchObject({ scopes: ['workspace:read', 'account:read'] }),
    );
  });

  test('"no key" mints nothing at all', async () => {
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('No key'));
    await waitFor(() => expect(screen.queryByText('What may it do as you?')).toBeNull());
    expect(mintAgentKey).not.toHaveBeenCalled();
  });

  test('the key is shown once, with the header to send it in', async () => {
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('Only on this market'));
    expect(await screen.findByText('Your key, shown once')).toBeTruthy();
    expect(screen.getByText('X-Agent-Key')).toBeTruthy();
    expect(screen.getByText(/We cannot show it again/)).toBeTruthy();
  });

  test('a refusal is shown rather than swallowed', async () => {
    mintAgentKey.mockRejectedValueOnce(new Error('Cannot grant scopes broader than your own key') as never);
    render(<AgentKeyOffer workspaceId="ws-1" name="Harbour Roasters" />);
    fireEvent.click(screen.getByText('Everything I can do'));
    expect(await screen.findByText(/Cannot grant scopes broader/)).toBeTruthy();
  });
});
