import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The Manifold link flow (redesigned 2026-08-31, owner ask: "redesign it
 * to only put the code into manifold bio and also say you don't have to
 * keep it there ... in the linking process not in the earn offer i dont
 * want you to be too spammy again").
 *
 * Two things worth pinning, both about WHERE words go rather than how the
 * import works: the code is the subject of its step, and the "you can
 * take it out again" reassurance is said once, on success, because that
 * is the only moment it is true and actionable.
 */

vi.mock('../../lib/api', () => ({
  api: { startRecordLink: vi.fn(), claimRecordLink: vi.fn() },
}));

import { api } from '../../lib/api';
import { type LinkProvider, ManifoldButton, POLYMARKET } from '../ManifoldButton';

const renderIt = (provider?: LinkProvider) =>
  render(
    <MemoryRouter>
      <ManifoldButton signedIn={true} onRequireSignup={() => {}} variant="row" provider={provider} />
    </MemoryRouter>,
  );

/** Open the dialog and get as far as the code step. */
const toCodeStep = async (provider?: LinkProvider) => {
  renderIt(provider);
  fireEvent.click(screen.getByText('Link'));
  fireEvent.change(screen.getByLabelText(`${provider?.label ?? 'Manifold'} username`), {
    target: { value: 'Tumbles' },
  });
  fireEvent.click(screen.getByText('Next'));
  await screen.findByText('telarchy-abc123');
};

beforeEach(() => {
  vi.mocked(api.startRecordLink).mockResolvedValue({
    code: 'telarchy-abc123',
    handle: 'Tumbles',
    proofField: 'bio',
  } as never);
  vi.mocked(api.claimRecordLink).mockResolvedValue({
    handle: 'Tumbles',
    granted: 5000,
  } as never);
});

describe('the Manifold link flow', () => {
  test('the code is the subject of the step, with one place to put it', async () => {
    await toCodeStep();
    expect(screen.getByText('telarchy-abc123')).toBeInTheDocument();
    expect(screen.getByText('Copy')).toBeInTheDocument();
    expect(screen.getByText(/Put this anywhere in @Tumbles/)).toBeInTheDocument();
  });

  test('THE REMOVAL LINE IS NOT SHOWN BEFORE THE LINK EXISTS', async () => {
    // It is not actionable yet, and saying it twice is the spam the owner
    // asked to stop.
    await toCodeStep();
    expect(screen.queryByText(/take the code out/i)).toBeNull();
  });

  test('it is said once the import succeeds, which is when it is true', async () => {
    await toCodeStep();
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText(/Linked @Tumbles/)).toBeInTheDocument());
    expect(screen.getByText('You can take the code out of your Manifold bio now.')).toBeInTheDocument();
  });

  test('THE SAME DIALOG SERVES ANOTHER PROVIDER, named throughout', async () => {
    // The registry's whole promise: adding a platform is a descriptor,
    // not a second dialog (docs/record-links.md).
    await toCodeStep(POLYMARKET);
    expect(api.startRecordLink).toHaveBeenCalledWith('polymarket', 'Tumbles');
    expect(screen.getByText('Polymarket')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText(/Linked @Tumbles/)).toBeInTheDocument());
    expect(api.claimRecordLink).toHaveBeenCalledWith('polymarket');
    expect(screen.getByText('You can take the code out of your Polymarket bio now.')).toBeInTheDocument();
  });

  test('THE FIRST STEP INVITES ANY ACCOUNT, and says what the GRANT needs', async () => {
    // Owner ask 2026-09-01: linking is open to anyone who can prove they
    // hold the account. The conditions are about the credits, and copy
    // that states them as entry requirements turns people away from a
    // badge they are entitled to.
    renderIt();
    fireEvent.click(screen.getByText('Link'));
    expect(screen.getByText(/Link any account you can prove is yours/)).toBeInTheDocument();
    expect(screen.getByText(/To also earn credits/)).toBeInTheDocument();
    // The price is a link, not a paragraph: the earn page owns that number.
    expect(screen.getByText('What it pays')).toBeInTheDocument();
  });

  test('a link that earns nothing still reports the link, and why it paid zero', async () => {
    (api.claimRecordLink as ReturnType<typeof vi.fn>).mockResolvedValue({
      handle: 'Tumbles',
      granted: 0,
      why: 'That Manifold account is 4 days old; the import needs 90.',
    });
    await toCodeStep();
    fireEvent.click(screen.getByText('Verify'));
    await waitFor(() => expect(screen.getByText(/Linked @Tumbles/)).toBeInTheDocument());
    expect(screen.getByText(/4 days old/)).toBeInTheDocument();
  });
});

/**
 * Independence (docs/record-links.md, "Independent of the provider, and it
 * says so"; Manifold's ask of 2026-09-03): the flow says Telarchy is not
 * affiliated with the provider before a handle is typed, says what it
 * reads and keeps, and never uses a verb that suggests a transfer.
 */
describe('THE LINK FLOW SAYS TELARCHY IS NOT AFFILIATED WITH THE PROVIDER', () => {
  test('the first step carries the line, naming the provider, before any handle is typed', () => {
    renderIt();
    fireEvent.click(screen.getByText('Link'));
    expect(screen.getByText(/not affiliated with or endorsed by Manifold/)).toBeInTheDocument();
    expect(screen.getByText(/reads your public Manifold profile once/)).toBeInTheDocument();
    expect(screen.getByText(/nothing else from Manifold is stored/)).toBeInTheDocument();
  });

  test('the line names another provider when the dialog serves it', () => {
    renderIt(POLYMARKET);
    fireEvent.click(screen.getByText('Link'));
    expect(screen.getByText(/not affiliated with or endorsed by Polymarket/)).toBeInTheDocument();
  });

  test('THE VERB IS LINK, NEVER IMPORT OR BRING: the door, the title and the verify button', async () => {
    await toCodeStep();
    expect(screen.getAllByText('Link your Manifold account').length).toBeGreaterThan(0);
    expect(screen.getByText('Verify')).toBeInTheDocument();
    expect(screen.queryByText(/import/i)).toBeNull();
    expect(screen.queryByText(/bring your/i)).toBeNull();
  });
});
