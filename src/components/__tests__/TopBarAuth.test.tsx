import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The page has to ask before it tells someone they are signed out.
 *
 * Owner, 2026-08-24: "why when i click it i get signed out? im signed in in
 * telarchy.com/beta but suddenly not in the manage site?" Nothing was wrong
 * with the session. The operator door, About, Contact and the legal pages
 * rendered "Log in" unconditionally, so a signed-in visitor was told they
 * were not.
 */

let mockAuth: { user: { id: string } | null; loading: boolean } = { user: null, loading: false };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => mockAuth }));

import { TopBarAuth } from '../TopBarAuth';

const renderAt = (path = '/northwind') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopBarAuth />
    </MemoryRouter>,
  );

beforeEach(() => {
  mockAuth = { user: null, loading: false };
});

describe('the corner of the top bar', () => {
  test('offers the door to someone who is signed out, and remembers where they were', () => {
    renderAt('/northwind');
    const link = screen.getByRole('link', { name: 'Log in' });
    expect(link.getAttribute('href')).toBe('/login?next=%2Fnorthwind');
  });

  test('does not tell a signed-in visitor to log in', () => {
    mockAuth = { user: { id: 'u1' }, loading: false };
    renderAt();
    expect(screen.queryByRole('link', { name: 'Log in' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Account' })).toBeTruthy();
  });

  test('says nothing at all while the session check is still out', () => {
    // user is null while it is pending, so anything that reads null as
    // "signed out" makes "Log in" flash and vanish on every page load.
    mockAuth = { user: null, loading: true };
    renderAt();
    expect(screen.queryByRole('link')).toBeNull();
  });
});
