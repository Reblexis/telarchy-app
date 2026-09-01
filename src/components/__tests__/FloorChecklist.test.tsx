import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * What is still open, on the floor (docs/owner-on-the-floor.md).
 *
 * The checklist has been computed since 2026-08-23 and rendered nowhere but
 * inside Otto's setup conversation, so an owner who closed that tab never saw
 * it again (notes/self-serve-owner-review-2026-09-01.md). These tests pin the
 * three rules that keep it worth reading: only the owner, only what is open,
 * and gone entirely when nothing is.
 */

const setupChecklist = vi.fn();
vi.mock('../../lib/api', () => ({ api: { setupChecklist: (...a: unknown[]) => setupChecklist(...(a as [])) } }));

import { FloorChecklist } from '../FloorChecklist';

const items = [
  { id: 'number', label: 'The number', status: 'done' as const, note: 'Monthly revenue, 2 open market(s).' },
  {
    id: 'freshness',
    label: 'Who updates it',
    status: 'open' as const,
    note: 'Nothing has updated the number since it was created, and no key or source exists to do it.',
  },
  {
    id: 'liquidity',
    label: 'Liquidity',
    status: 'open' as const,
    note: 'Auto-funding 0.5 credits per market, which is too thin to price anything.',
  },
];

beforeEach(() => {
  setupChecklist.mockReset();
  setupChecklist.mockResolvedValue({ workspace: { id: 'ws' }, items, blocking: [] });
});

describe('the floor checklist', () => {
  test('shows every open decision with what the database says about it', async () => {
    render(<FloorChecklist workspaceId="ws" canManage={true} />);
    expect(await screen.findByText('Who updates it')).toBeInTheDocument();
    expect(screen.getByText(/no key or source exists to do it/)).toBeInTheDocument();
    expect(screen.getByText('Liquidity')).toBeInTheDocument();
    expect(screen.getByText(/too thin to price anything/)).toBeInTheDocument();
  });

  test('lists nothing that is settled, and says how many are', async () => {
    render(<FloorChecklist workspaceId="ws" canManage={true} />);
    await screen.findByText('Who updates it');
    expect(screen.queryByText('The number')).toBeNull();
    expect(screen.getByText('1 of 3 decided')).toBeInTheDocument();
  });

  test('a floor with nothing open shows no panel at all', async () => {
    setupChecklist.mockResolvedValue({
      workspace: { id: 'ws' },
      items: items.map(i => ({ ...i, status: 'done' as const })),
      blocking: [],
    });
    const { container } = render(<FloorChecklist workspaceId="ws" canManage={true} />);
    await waitFor(() => expect(setupChecklist).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  test('a visitor without manage is never shown it, and it is never even asked for', async () => {
    const { container } = render(<FloorChecklist workspaceId="ws" canManage={false} />);
    await waitFor(() => expect(container.textContent).toBe(''));
    expect(setupChecklist).not.toHaveBeenCalled();
  });

  // The floor is the product; a checklist that cannot load must not take it
  // down or show an owner an error they did not ask for.
  test('a refused or broken read leaves the floor alone', async () => {
    setupChecklist.mockRejectedValue(new Error('Forbidden'));
    const { container } = render(<FloorChecklist workspaceId="ws" canManage={true} />);
    await waitFor(() => expect(setupChecklist).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });
});
