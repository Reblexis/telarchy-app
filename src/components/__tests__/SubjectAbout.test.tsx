import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { updateWorkspaceSettings: vi.fn() } }));

import { SubjectAbout } from '../SubjectAbout';

/**
 * "What is <name>?" is where a visitor's question forms, so it carries the
 * way to ask one (owner direction 2026-08-21: make Otto obvious). The button
 * is for every visitor, including the owner mid-edit, which is the case that
 * would otherwise put two controls in one row fighting for the same click.
 */
const base = {
  workspaceId: 'ws1',
  name: 'LookPilot',
  value: 'A webcam head tracker.',
  defaultText: 'default copy',
  canManage: false,
  onSaved: () => {},
};

describe('the What is section', () => {
  test('offers Otto beside the question', () => {
    const onAsk = vi.fn();
    render(<SubjectAbout {...base} onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: /ask otto/i }));
    expect(onAsk).toHaveBeenCalled();
  });

  test('has no Otto where the page did not offer one', () => {
    render(<SubjectAbout {...base} />);
    expect(screen.queryByRole('button', { name: /ask otto/i })).toBeNull();
  });

  test('steps out of the way while the owner is editing', () => {
    const onAsk = vi.fn();
    render(<SubjectAbout {...base} canManage onAsk={onAsk} />);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.queryByRole('button', { name: /ask otto/i })).toBeNull();
  });
});
