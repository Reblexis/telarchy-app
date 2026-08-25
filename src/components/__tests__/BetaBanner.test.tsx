import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The stripe that says "this is not the published site".
 *
 * The detection has to be the hostname, and this is the test that pins why:
 * the candidate revision and the revision that later serves telarchy.com are
 * the SAME build, so no build-time flag can tell them apart. Where the page is
 * served from can.
 */

const getRelease = vi.fn(async () => ({
  serving: 'api-00380',
  candidate: { revision: 'api-00381', url: 'https://candidate---api.run.app' },
  running: 'api-00381',
  isServing: false,
  error: null,
}));
const publishRelease = vi.fn(async () => ({ ok: true }));
/** Which store this build writes to, read through the api client like every
 *  other call the frontend makes (AGENTS.md, "Frontend goes through the
 *  public API"). */
const getPublicConfig = vi.fn(async () => ({ store: 'production' }));

vi.mock('../../lib/api', () => ({
  api: {
    getRelease: () => getRelease(),
    publishRelease: () => publishRelease(),
    getPublicConfig: () => getPublicConfig(),
  },
}));

// The banner asks only once it has a session, and asks AGAIN when one
// appears: it lives outside the router, so it never remounts, and a check
// made on the login page would be the only check it ever made.
let mockUser: { id: string } | null = { id: 'user-admin' };
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: mockUser, loading: false }) }));

import { BetaBanner, isPublishedOrigin } from '../BetaBanner';

function setHost(hostname: string, pathname = '/') {
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname, pathname },
    writable: true,
  });
}

const realLocation = window.location;
beforeEach(() => {
  getRelease.mockClear();
  publishRelease.mockClear();
  getPublicConfig.mockClear();
  getPublicConfig.mockResolvedValue({ store: 'production' });
  mockUser = { id: 'user-admin' };
});
afterEach(() => {
  Object.defineProperty(window, 'location', { value: realLocation, writable: true });
});

describe('where the stripe shows', () => {
  test('telarchy.com is the published site and wears no stripe', () => {
    setHost('telarchy.com', '/');
    expect(isPublishedOrigin()).toBe(true);
    const { container } = render(<BetaBanner />);
    expect(container).toBeEmptyDOMElement();
    // It must not even ask: a public visitor triggering an admin call on every
    // page load is a 403 per pageview in the logs.
    expect(getRelease).not.toHaveBeenCalled();
  });

  test('www counts as the published site too', () => {
    setHost('www.telarchy.com');
    expect(isPublishedOrigin()).toBe(true);
  });

  test('the candidate revision wears it', async () => {
    setHost('candidate---api-ksc7usrtbq-uc.a.run.app');
    expect(isPublishedOrigin()).toBe(false);
    render(<BetaBanner />);
    expect(screen.getByText('Beta')).toBeTruthy();
    // Before the release call answers it claims nothing, then it commits.
    expect(screen.getByText(/may differ/)).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Not published/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Publish this build')).toBeTruthy());
  });

  test('a local dev server wears it as well', () => {
    setHost('localhost');
    expect(isPublishedOrigin()).toBe(false);
  });
});

describe('the button', () => {
  test('is not offered on a revision that is already serving', async () => {
    setHost('candidate---api.run.app');
    getRelease.mockResolvedValueOnce({
      serving: 'api-00381',
      candidate: null,
      running: 'api-00381',
      isServing: true,
      error: null,
    });
    render(<BetaBanner />);
    await waitFor(() => expect(getRelease).toHaveBeenCalled());
    expect(screen.queryByText('Publish this build')).toBeNull();
  });

  test('is not offered to someone who cannot read the release', async () => {
    setHost('candidate---api.run.app');
    getRelease.mockRejectedValueOnce(new Error('403'));
    render(<BetaBanner />);
    await waitFor(() => expect(getRelease).toHaveBeenCalled());
    expect(screen.queryByText('Publish this build')).toBeNull();
    // The stripe still shows: "you are not on the real site" is worth saying
    // to anyone who finds the URL.
    expect(screen.getByText('Beta')).toBeTruthy();
  });
});

describe('when the session appears', () => {
  test('signed out, it does not ask at all', async () => {
    setHost('candidate---api.run.app');
    mockUser = null;
    render(<BetaBanner />);
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(getRelease).not.toHaveBeenCalled();
    expect(screen.queryByText('Publish this build')).toBeNull();
  });

  test('signing in makes it ask, and the button arrives', async () => {
    setHost('candidate---api.run.app');
    mockUser = null;
    const { rerender } = render(<BetaBanner />);
    expect(getRelease).not.toHaveBeenCalled();

    // What logging in on the beta looks like from here.
    mockUser = { id: 'user-admin' };
    rerender(<BetaBanner />);
    await waitFor(() => expect(getRelease).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText('Publish this build')).toBeTruthy());
  });
});

describe('the beta on the real domain', () => {
  test('telarchy.com/beta is not the published site', () => {
    setHost('telarchy.com', '/beta');
    expect(isPublishedOrigin()).toBe(false);
  });

  test('and neither is anything under it', () => {
    setHost('telarchy.com', '/beta/lookpilot');
    expect(isPublishedOrigin()).toBe(false);
  });

  test('a market whose slug merely starts with beta is still the real site', () => {
    // /betamax is a workspace, not the beta. The boundary is the path
    // SEGMENT, which is the same boundary the server proxies on.
    setHost('telarchy.com', '/betamax');
    expect(isPublishedOrigin()).toBe(true);
  });

  test('the stripe shows there, with the button for an admin', async () => {
    setHost('telarchy.com', '/beta/');
    render(<BetaBanner />);
    expect(screen.getByText('Beta')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('Publish this build')).toBeTruthy());
  });
});

describe('the stripe says which of three states it is in', () => {
  test('a build waiting: the site is on the previous one', async () => {
    setHost('telarchy.com', '/beta/');
    render(<BetaBanner />);
    await waitFor(() => expect(screen.getByText(/still serving the previous build/)).toBeTruthy());
  });

  test('nothing waiting: this IS what the site serves', async () => {
    setHost('telarchy.com', '/beta/');
    getRelease.mockResolvedValueOnce({
      serving: 'api-1',
      candidate: null,
      running: 'api-1',
      isServing: true,
      error: null,
    });
    render(<BetaBanner />);
    await waitFor(() => expect(screen.getByText(/Nothing is waiting/)).toBeTruthy());
    expect(screen.queryByText('Publish this build')).toBeNull();
  });

  test('cannot tell: it does not claim either way', async () => {
    setHost('telarchy.com', '/beta/');
    getRelease.mockRejectedValueOnce(new Error('403'));
    render(<BetaBanner />);
    await waitFor(() => expect(screen.getByText(/may differ/)).toBeTruthy());
  });
});

/**
 * Which store the stripe says it is on (owner ask 2026-08-20). The loud case
 * is the dangerous one: a beta wired to the live database looks identical to
 * a safe one until something is written.
 */
describe('the store the beta writes to', () => {
  test('names what is separate and what is not', async () => {
    getPublicConfig.mockResolvedValue({ store: 'beta' });
    setHost('telarchy.com', '/beta/lookpilot');
    render(<BetaBanner />);
    // "own data, real account", not "own database": the auth client is pinned
    // to the origin's /api/auth, so account writes made on the beta are live
    // even though every workspace and trade is the beta's own. The old wording
    // invited someone to test an account feature and change their real one.
    expect(await screen.findByText(/own data, real account/i)).toBeTruthy();
  });

  test('says LIVE, loudly, when it shares production', async () => {
    getPublicConfig.mockResolvedValue({ store: 'production' });
    setHost('telarchy.com', '/beta/lookpilot');
    render(<BetaBanner />);
    const tag = await screen.findByText('LIVE database');
    expect(tag.className).toContain('is-live');
  });
});
