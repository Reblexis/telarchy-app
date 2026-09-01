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
    liquidityCredits: 100,
    kind: 'flat' as const,
    note: 'An address costs a farmer almost nothing.',
  },
  { key: 'signup_agent', label: 'Register through the API (a bot)', credits: 0, kind: 'flat' as const, note: '' },
  { key: 'trade_profit', label: 'Trade and be right', credits: 0, kind: 'open' as const, note: '' },
  { key: 'daily_trade', label: 'Trade on a new day', credits: 25, kind: 'daily' as const, note: '' },
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
    streak: { days: 3, earnedToday: true, todayCredits: 75, nextCredits: 100 },
    rules: [
      rules[3],
      rules[4],
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

  test('THE RECURRING EARNS COME FIRST, then one-time by descending price', async () => {
    // Trading is how credits are actually made, and a table that opened
    // with signup bonuses told a visitor the opposite (owner ask
    // 2026-08-30: "another way to earn credits is by trading on markets").
    renderPage();
    await screen.findByText('Trade and be right');
    const labels = screen.getAllByText(
      /Trade and be right|Trade on a new day|Sign up with an email|Register through the API|Link an established/,
    );
    expect(labels.map(l => l.textContent)).toEqual([
      'Trade and be right',
      'Trade on a new day',
      'Link an established Manifold account',
      'Sign up with an email and password',
      'Register through the API (a bot)',
    ]);
  });

  test('trading has no number and the streak shows its range', async () => {
    renderPage();
    await screen.findByText('Trade and be right');
    expect(screen.getByText('no limit')).toBeInTheDocument();
    expect(screen.getByText('25-100')).toBeInTheDocument();
  });

  test('a signed-in reader sees the run and what today paid', async () => {
    authUser = { id: 'ann' };
    renderPage();
    await screen.findByText('Trade on a new day');
    expect(screen.getByText('day streak')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('✓ +75 today')).toBeInTheDocument();
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

/**
 * The wallet half of a grant (owner decision 2026-09-01). A price list that
 * showed one purse would understate what a signup is worth, and adding the
 * two into one figure would tell the reader they can trade with depth they
 * cannot.
 */
describe('matched liquidity on the price list', () => {
  test('is a column of its own, never added into the credits', async () => {
    (api.getEarnTable as ReturnType<typeof vi.fn>).mockResolvedValue({ rules });
    renderPage();
    expect(await screen.findByText('Sign up with an email and password')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /liquidity/i })).toBeInTheDocument();
    const row = screen.getByText('Sign up with an email and password').closest('tr') as HTMLElement;
    const cells = [...row.querySelectorAll('td')].map(c => c.textContent);
    expect(cells).toContain('100');
    expect(cells.filter(c => c === '100')).toHaveLength(2);
    expect(cells).not.toContain('200');
  });

  test('a table where nothing is matched shows no column at all', async () => {
    (api.getEarnTable as ReturnType<typeof vi.fn>).mockResolvedValue({
      rules: rules.map(r => ({ ...r, liquidityCredits: 0 })),
    });
    renderPage();
    expect(await screen.findByText('Sign up with an email and password')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /liquidity/i })).toBeNull();
  });
});
