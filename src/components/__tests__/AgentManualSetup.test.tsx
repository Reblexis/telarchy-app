import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AgentManualSetup, manualCommands } from '../AgentManualSetup';

test.each(['unix', 'windows'] as const)('the %s first run never trades or embeds a key', os => {
  const commands = manualCommands(os, 'telarchy');
  expect(commands.preview).toContain('agent.py');
  expect(commands.preview).not.toContain('--live');
  expect(commands.preview).not.toContain('TELARCHY_KEY');
  expect(commands.connected).toContain('TELARCHY_KEY');
  expect(commands.connected).not.toContain('--live');
});
test('workspace names are quoted as data for each terminal', () => {
  expect(manualCommands('unix', "team's $(id)").preview).toContain("'team'\\''s $(id)'");
  expect(manualCommands('windows', "team's $(id)").preview).toContain("'team''s $(id)'");
});
test('research mode never offers live commands; trading requires opening a separate step', () => {
  const view = render(
    <MemoryRouter>
      <AgentManualSetup workspace="" access="read" identity="bot" connectionForm={<p>Connection form</p>} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/public Telarchy workspace/)).toBeVisible();
  expect(screen.queryByText(/--live/)).toBeNull();
  view.rerender(
    <MemoryRouter>
      <AgentManualSetup workspace="" access="trade" identity="me" connectionForm={<p>Connection form</p>} />
    </MemoryRouter>,
  );
  expect(screen.getByText(/--live/)).not.toBeVisible();
  fireEvent.click(screen.getByText('After the preview: allow live trading'));
  expect(screen.getByText(/--live/)).toBeVisible();
});
test('manual instructions remain copyable with a visible fallback on clipboard failure', async () => {
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) } });
  render(
    <MemoryRouter>
      <AgentManualSetup workspace="ws-one" access="read" identity="bot" connectionForm={null} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Copy preview commands' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Select the commands');
  expect(screen.getByText(/git clone/)).toBeVisible();
});

test('choosing Windows updates the visible commands', () => {
  render(
    <MemoryRouter>
      <AgentManualSetup workspace="ws-one" access="read" identity="bot" connectionForm={null} />
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByLabelText('Terminal', { exact: true }), { target: { value: 'windows' } });
  expect(screen.getByText(/git clone/)).toHaveTextContent('py -3 -m venv');
});

test('manual setup recognizes an existing key instead of asking for another connection', () => {
  render(
    <MemoryRouter>
      <AgentManualSetup
        workspace="telarchy"
        access="read"
        identity="me"
        connected
        connectionForm={<button>Copy existing key</button>}
      />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: /Run with your key/ })).toBeVisible();
  expect(screen.queryByText(/Create a key when/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy existing key' })).toBeVisible();
});
