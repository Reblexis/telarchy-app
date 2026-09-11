import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';
import { PageTopBar } from '../PageTopBar';

vi.mock('../TopBarAuth', () => ({ TopBarAuth: () => <button>Account</button> }));

test.each(['/agents', '/guides/build-agent'])('navigation controls remain available on %s', path => {
  render(
    <MemoryRouter basename="/beta" initialEntries={[`/beta${path}`]}>
      <PageTopBar />
    </MemoryRouter>,
  );
  expect(screen.getByRole('link', { name: 'Join our Discord' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Report a bug or send feedback' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Agents and API keys' })).toHaveAttribute('href', '/beta/agents');
  expect(screen.getByRole('button', { name: 'Account' })).toBeVisible();
});
