import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { getEarnTable: vi.fn() } }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('../TradePage', () => ({ TopBar: () => null }));

import { api } from '../../lib/api';
import { EarnPage } from '../EarnPage';

const rules = [
  {
    key: 'manifold_link',
    label: 'Link an established Manifold account',
    credits: 5000,
    kind: 'cap' as const,
    note: 'Aged 90 days, traded recently, not a bot.',
  },
  {
    key: 'signup_email',
    label: 'Sign up with an email and password',
    credits: 100,
    kind: 'flat' as const,
    note: 'An address costs a farmer almost nothing.',
  },
  { key: 'signup_agent', label: 'Register through the API (a bot)', credits: 0, kind: 'flat' as const, note: '' },
];

const renderPage = () =>
  render(
    <MemoryRouter>
      <EarnPage />
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.mocked(api.getEarnTable).mockResolvedValue({ rules } as never);
});

describe('/earn', () => {
  test('lists each way to earn with its price and the reason for it', async () => {
    renderPage();
    expect(await screen.findByText('Link an established Manifold account')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
    // The reason is the argument, not decoration: a price with no stated
    // basis reads as a game reward.
    expect(screen.getByText('Aged 90 days, traded recently, not a bot.')).toBeInTheDocument();
  });

  test('signup ways come first, then descending price', async () => {
    renderPage();
    await screen.findByText('Sign up with an email and password');
    const labels = screen.getAllByText(/Sign up with an email|Register through the API|Link an established/);
    expect(labels.map(l => l.textContent)).toEqual([
      'Sign up with an email and password',
      'Register through the API (a bot)',
      'Link an established Manifold account',
    ]);
  });

  test('a zero price reads as none rather than 0, and a capped one says up to', async () => {
    renderPage();
    await screen.findByText('Register through the API (a bot)');
    expect(screen.getByText('none')).toBeInTheDocument();
    expect(screen.getByText('up to')).toBeInTheDocument();
  });
});
