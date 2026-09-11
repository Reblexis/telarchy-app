import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { AgentNavLink } from '../AgentNavLink';

const auth = vi.hoisted(() => ({ user: null as { id: string } | null }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
test('signed-out visitors can find agent setup directly from the top bar', () => {
  auth.user = null;
  render(
    <MemoryRouter>
      <AgentNavLink />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Agents and API keys' })).toHaveAttribute('href', '/agents');
});
test('signed-in visitors go directly to management and beta links stay in beta', () => {
  auth.user = { id: 'person' };
  render(
    <MemoryRouter basename="/beta" initialEntries={['/beta/agents']}>
      <AgentNavLink />
    </MemoryRouter>,
  );
  const link = screen.getByRole('link', { name: 'Agents and API keys' });
  expect(link).toHaveAttribute('href', '/beta/agents');
  expect(link).toHaveAttribute('aria-current', 'page');
});
