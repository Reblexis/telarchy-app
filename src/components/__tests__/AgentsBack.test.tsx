import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AgentsPage } from '../../pages/AgentsPage';
import { AgentNavLink } from '../AgentNavLink';

vi.mock('../PageTopBar', () => ({ PageTopBar: () => null }));
vi.mock('../AgentWorkspace', () => ({ AgentWorkspace: () => null }));
test('Back returns to the source page including its query and fragment', () => {
  render(
    <MemoryRouter initialEntries={['/lookpilot?view=trades#market']}>
      <Routes>
        <Route path="/lookpilot" element={<AgentNavLink />} />
        <Route path="/agents" element={<AgentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('link', { name: 'Agents and API keys' }));
  expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/lookpilot?view=trades#market');
});
test('direct entry returns to the floor within the preview base', () => {
  render(
    <MemoryRouter basename="/beta" initialEntries={['/beta/agents']}>
      <AgentsPage />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/beta');
});
