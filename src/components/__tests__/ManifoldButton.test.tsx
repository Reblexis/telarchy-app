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
  api: { startManifoldImport: vi.fn(), claimManifoldImport: vi.fn() },
}));

import { api } from '../../lib/api';
import { ManifoldButton } from '../ManifoldButton';

const renderIt = () =>
  render(
    <MemoryRouter>
      <ManifoldButton signedIn={true} onRequireSignup={() => {}} variant="row" />
    </MemoryRouter>,
  );

/** Open the dialog and get as far as the code step. */
const toCodeStep = async () => {
  renderIt();
  fireEvent.click(screen.getByText('Import'));
  fireEvent.change(screen.getByLabelText('Manifold username'), { target: { value: 'Tumbles' } });
  fireEvent.click(screen.getByText('Next'));
  await screen.findByText('telarchy-abc123');
};

beforeEach(() => {
  vi.mocked(api.startManifoldImport).mockResolvedValue({ code: 'telarchy-abc123', username: 'Tumbles' } as never);
  vi.mocked(api.claimManifoldImport).mockResolvedValue({ username: 'Tumbles', granted: 5000 } as never);
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
    fireEvent.click(screen.getByText('Verify and import'));
    await waitFor(() => expect(screen.getByText(/Imported @Tumbles/)).toBeInTheDocument());
    expect(screen.getByText('You can take the code out of your Manifold bio now.')).toBeInTheDocument();
  });

  test('the first step says only what stops a wasted trip', async () => {
    renderIt();
    fireEvent.click(screen.getByText('Import'));
    expect(screen.getByText(/At least 90 days old, not a bot/)).toBeInTheDocument();
    // The price is a link, not a paragraph: the earn page owns that number.
    expect(screen.getByText('What it pays')).toBeInTheDocument();
  });
});
