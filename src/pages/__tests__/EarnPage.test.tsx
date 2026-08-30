import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({
  api: { getEarnTable: vi.fn(), getMyEarn: vi.fn(), syncEarnLinks: vi.fn() },
}));
const linkSocial = vi.fn();
vi.mock('../../lib/auth-client', () => ({ authClient: { linkSocial: (...a: unknown[]) => linkSocial(...a) } }));
let authUser: { id: string } | null = null;
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: authUser, loading: false }) }));
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
  authUser = null;
  linkSocial.mockReset();
  linkSocial.mockResolvedValue({ error: null });
  vi.mocked(api.getEarnTable).mockResolvedValue({ rules } as never);
  vi.mocked(api.syncEarnLinks).mockResolvedValue({ granted: 0, paid: [], takenElsewhere: [] } as never);
  vi.mocked(api.getMyEarn).mockResolvedValue({
    earned: 300,
    available: 5200,
    rules: [
      { ...rules[1], key: 'signup_user', label: 'Create an account', claimed: true },
      {
        key: 'link_oauth',
        label: 'Connect a Google or GitHub account',
        credits: 200,
        kind: 'flat',
        note: '',
        claimed: false,
      },
      { ...rules[0], claimed: false },
    ],
  } as never);
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

describe('/earn, signed in', () => {
  test('shows the tally and marks what is already earned', async () => {
    authUser = { id: 'u1' };
    renderPage();
    expect(await screen.findByText('300')).toBeInTheDocument();
    expect(screen.getByText('5,200')).toBeInTheDocument();
    expect(screen.getAllByText('✓ earned').length).toBe(1);
  });

  test('the one link earn offers either provider, and either starts the link', async () => {
    // One row, two doors: whichever they finish claims the same earn
    // (owner decision 2026-08-30), so a second account earns nothing.
    authUser = { id: 'u1' };
    renderPage();
    const github = await screen.findByRole('button', { name: 'GitHub' });
    const google = screen.getByRole('button', { name: 'Google' });
    github.click();
    await waitFor(() => expect(linkSocial).toHaveBeenCalledWith({ provider: 'github', callbackURL: '/earn' }));
    // And the other door closes while the redirect is in flight: two
    // consent screens at once would leave the second link unpaid.
    await waitFor(() => expect(google).toBeDisabled());
    expect(linkSocial).toHaveBeenCalledTimes(1);
  });

  test('coming back from a provider, the sync runs first and reports the credit', async () => {
    // The link exists before it is paid for, so the page reconciles on
    // load; otherwise a returning reader sees no credits and links again.
    authUser = { id: 'u1' };
    vi.mocked(api.syncEarnLinks).mockResolvedValue({
      granted: 200,
      paid: ['link_github'],
      takenElsewhere: [],
    } as never);
    renderPage();
    expect(await screen.findByText('+200 credits')).toBeInTheDocument();
  });

  test('an account already used elsewhere says so, rather than failing silently', async () => {
    authUser = { id: 'u1' };
    vi.mocked(api.syncEarnLinks).mockResolvedValue({
      granted: 0,
      paid: [],
      takenElsewhere: ['link_google'],
    } as never);
    renderPage();
    expect(await screen.findByText(/already earned this on another Telarchy account/)).toBeInTheDocument();
  });
});
