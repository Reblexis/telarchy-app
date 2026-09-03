import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * The Manifold update card (docs/manifold-update.md): shows the text as the
 * server wrote it, copies it, and never lets him post a stale or missing one.
 */
vi.mock('../../lib/api', () => ({ api: { manifoldUpdate: vi.fn() } }));

import { api } from '../../lib/api';
import { ManifoldUpdate } from '../ManifoldUpdate';

const TEXT =
  'UPDATE:\n\nStatus: 12 linked Manifolders.\n\nBy settled profit:\n\n1. vi0 ($773.20 | +933.11cr settled)\n';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('the Manifold update card', () => {
  test('shows the text exactly as the server wrote it, read-only', async () => {
    vi.mocked(api.manifoldUpdate).mockResolvedValue({
      text: TEXT,
      linked: 12,
      seasonId: 's0',
      generatedAt: '2026-09-03T18:00:00Z',
    });
    render(<ManifoldUpdate />);
    const box = (await screen.findByLabelText('Manifold update')) as HTMLTextAreaElement;
    expect(box.value).toBe(TEXT);
    expect(box.readOnly).toBe(true);
  });

  test('Copy puts the text on the clipboard and says so', async () => {
    vi.mocked(api.manifoldUpdate).mockResolvedValue({
      text: TEXT,
      linked: 12,
      seasonId: 's0',
      generatedAt: '2026-09-03T18:00:00Z',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ManifoldUpdate />);
    await screen.findByLabelText('Manifold update');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TEXT));
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  test('a failed read shows the error and no Copy button', async () => {
    vi.mocked(api.manifoldUpdate).mockRejectedValue(new Error('Standings unavailable'));
    render(<ManifoldUpdate />);
    expect(await screen.findByText('Standings unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });

  test('Refresh reads it again', async () => {
    vi.mocked(api.manifoldUpdate).mockResolvedValue({
      text: TEXT,
      linked: 12,
      seasonId: 's0',
      generatedAt: '2026-09-03T18:00:00Z',
    });
    render(<ManifoldUpdate />);
    await screen.findByLabelText('Manifold update');
    vi.mocked(api.manifoldUpdate).mockResolvedValue({
      text: 'UPDATE:\n\nStatus: 13 linked Manifolders.\n',
      linked: 13,
      seasonId: 's0',
      generatedAt: '2026-09-03T18:05:00Z',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() =>
      expect((screen.getByLabelText('Manifold update') as HTMLTextAreaElement).value).toContain('13 linked'),
    );
    expect(api.manifoldUpdate).toHaveBeenCalledTimes(2);
  });
});
