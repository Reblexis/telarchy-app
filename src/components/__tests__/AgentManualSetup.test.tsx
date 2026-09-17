import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AgentManualSetup, manualCommands } from '../AgentManualSetup';

test.each(['unix', 'windows'] as const)(
  'the %s first run never trades, never touches a key, and sets no variables',
  os => {
    const commands = manualCommands(os, '');
    expect(commands.preview).toContain('agent.py');
    expect(commands.preview).not.toContain('--live');
    expect(commands.preview).not.toContain('--login');
    expect(commands.preview).not.toMatch(/TELARCHY_|export |\$env:/);
  },
);
test.each(['unix', 'windows'] as const)('connecting on %s is one command that asks for the key itself', os => {
  const commands = manualCommands(os, '');
  expect(commands.login.split('\n')).toHaveLength(1);
  expect(commands.login).toMatch(/agent\.py --login$/);
  // A hidden prompt followed by more pasted lines reads those lines as the key.
  expect(JSON.stringify(commands)).not.toMatch(/getpass|Read-Host|TELARCHY_KEY/);
});
test('the four command blocks: preview, login, preview again, live; only live trades', () => {
  const commands = manualCommands('unix', '');
  expect(commands.login).toBe('.venv/bin/python agent.py --login');
  expect(commands.connected).toBe('.venv/bin/python agent.py');
  expect(commands.live).toBe('.venv/bin/python agent.py --live');
  expect(commands.keepRunning).toBe('.venv/bin/python agent.py --live --every 30');
  expect(commands.preview.split('\n').at(-1)).toBe('.venv/bin/python agent.py');
  expect(manualCommands('windows', '').live).toBe('.\\.venv\\Scripts\\python.exe agent.py --live');
});
test('a chosen workspace rides on every run as a quoted flag; none chosen means none named', () => {
  const chosen = manualCommands('unix', 'ws-one');
  for (const block of [chosen.preview, chosen.connected, chosen.live, chosen.keepRunning])
    expect(block).toContain("--workspace 'ws-one'");
  expect(JSON.stringify(manualCommands('unix', ''))).not.toContain('--workspace');
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
  expect(screen.getByText(/you can stop here/)).toBeVisible();
  expect(screen.queryByText(/--live/)).toBeNull();
  view.rerender(
    <MemoryRouter>
      <AgentManualSetup workspace="" access="trade" identity="me" connectionForm={<p>Connection form</p>} />
    </MemoryRouter>,
  );
  expect(screen.queryByText(/you can stop here/)).toBeNull();
  expect(screen.getAllByText(/--live/)[0]).not.toBeVisible();
  fireEvent.click(screen.getByText('After the preview: trade for real'));
  expect(screen.getAllByText(/--live/)[0]).toBeVisible();
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
  expect(screen.getByRole('heading', { name: /Connect your key/ })).toBeVisible();
  expect(screen.getByText(/only once/)).toBeVisible();
  expect(screen.queryByText(/Create a key when/)).toBeNull();
  expect(screen.getByRole('button', { name: 'Copy existing key' })).toBeVisible();
});
