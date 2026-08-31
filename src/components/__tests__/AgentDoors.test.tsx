import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ownerAgentPrompt, traderAgentPrompt } from '../../lib/agent-prompt';
import { AgentDoors } from '../AgentDoors';

/**
 * The two doors (docs/owner-on-the-floor.md, "Handing it to your own agent").
 *
 * Three things are load-bearing: the words match what the reader may actually
 * do, the permission is chosen before the prompt is written, and the prompt
 * says which permission it got. The rest is layout.
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

const doors = (over: Partial<Parameters<typeof AgentDoors>[0]> = {}) =>
  render(
    <AgentDoors floor={FLOOR} workspaceId="ws-1" state={STATE} canManage signedIn onAskOtto={() => {}} {...over} />,
  );

beforeEach(() => {
  writeText.mockClear();
  mintAgentKey.mockClear();
  mintAgentKey.mockResolvedValue({
    keyId: 'k1',
    apiKey: 'deadbeef00',
    scopes: ['*'],
    workspaceId: 'ws-1',
    workspaceLocked: true,
  } as never);
});

describe('the words', () => {
  test('a manager is offered running the market', () => {
    doors();
    expect(screen.getByText('Have Otto run this market with you')).toBeTruthy();
    expect(screen.getByText('Or run it from your own AI')).toBeTruthy();
  });

  test('a trader is offered trading it, because that is what they can do', () => {
    doors({ canManage: false, state: null });
    expect(screen.getByText('Have Otto trade this market with you')).toBeTruthy();
    expect(screen.getByText('Or trade it from your own AI')).toBeTruthy();
  });

  test('signed out, neither row promises an action neither can take', () => {
    doors({ signedIn: false, canManage: false, state: null });
    expect(screen.getByText('Ask Otto about Harbour Roasters')).toBeTruthy();
    expect(screen.getByText('Or read it from your own AI')).toBeTruthy();
  });

  test('on an empty market the work on offer is the setup', () => {
    doors({ setupWords: true });
    expect(screen.getByText('Have Otto set this market up with you')).toBeTruthy();
    expect(screen.getByText('Or set it up from your own AI')).toBeTruthy();
  });

  test('inside the Otto panel there is no second Otto', () => {
    doors({ onAskOtto: undefined });
    expect(screen.queryByText('Have Otto run this market with you')).toBeNull();
    expect(screen.getByText('Or run it from your own AI')).toBeTruthy();
  });
});

describe('the flow', () => {
  test('asks what the key may do before it writes anything', () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    expect(screen.getByText('What may it do as you?', { exact: false })).toBeTruthy();
    expect(screen.getByText('Only this market')).toBeTruthy();
    expect(writeText).not.toHaveBeenCalled();
  });

  test('"only this market" pins the key to the workspace', async () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('Only this market'));
    await waitFor(() =>
      expect(mintAgentKey).toHaveBeenCalledWith('me', {
        label: 'Harbour Roasters · my own agent',
        scopes: ['*'],
        workspaceId: 'ws-1',
        workspaceLocked: true,
      }),
    );
  });

  test('then both copies stand together, and the key is shown once', async () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('Only this market'));
    expect(await screen.findByText('deadbeef00')).toBeTruthy();
    expect(screen.getByText('shown once')).toBeTruthy();
    expect(screen.getByText('Copy prompt')).toBeTruthy();
    expect(screen.getByText('Copy key')).toBeTruthy();
  });

  test('the prompt it copies says what the key may do', async () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('Only this market'));
    fireEvent.click(await screen.findByText('Copy prompt'));
    expect(writeText).toHaveBeenCalledWith(ownerAgentPrompt(window.location.origin, STATE, 'here'));
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('does anything I can do on THIS market and nothing on any other');
  });

  test('read only tells the agent to hand the call back instead of trying it', async () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('Read only'));
    await waitFor(() =>
      expect(mintAgentKey.mock.calls[0][1]).toMatchObject({ scopes: ['workspace:read', 'account:read'] }),
    );
    fireEvent.click(await screen.findByText('Copy prompt'));
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('READS ONLY');
    expect(copied).toContain('Tell me the exact request you would send');
  });

  test('no key mints nothing and still writes a usable prompt', async () => {
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('No key'));
    expect(mintAgentKey).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByText('Copy prompt'));
    expect(String(writeText.mock.calls[0][0])).toContain('I am not giving you a key');
    expect(screen.queryByText('Copy key')).toBeNull();
  });

  test("a trader's prompt is about trading, on the key they picked", async () => {
    doors({ canManage: false, state: null });
    fireEvent.click(screen.getByText('Or trade it from your own AI'));
    fireEvent.click(screen.getByText('Everything I can do'));
    fireEvent.click(await screen.findByText('Copy prompt'));
    expect(writeText).toHaveBeenCalledWith(traderAgentPrompt(window.location.origin, FLOOR, 'all', 'ws-1'));
    expect(String(writeText.mock.calls[0][0])).toContain('Confirm with me before every trade');
  });

  test('signed out the row copies the reader prompt and offers no key', () => {
    doors({ signedIn: false, canManage: false, state: null });
    fireEvent.click(screen.getByText('Or read it from your own AI'));
    expect(String(writeText.mock.calls[0][0])).toContain('context?format=md');
    expect(screen.queryByText('Only this market')).toBeNull();
    expect(mintAgentKey).not.toHaveBeenCalled();
  });

  test('a refusal is shown rather than swallowed', async () => {
    mintAgentKey.mockRejectedValueOnce(new Error('Cannot grant scopes broader than your own key') as never);
    doors();
    fireEvent.click(screen.getByText('Or run it from your own AI'));
    fireEvent.click(screen.getByText('Everything I can do'));
    expect(await screen.findByText(/Cannot grant scopes broader/)).toBeTruthy();
  });
});
