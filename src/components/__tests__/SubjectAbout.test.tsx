import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

vi.mock('../../lib/api', () => ({ api: { updateWorkspaceSettings: vi.fn() } }));

import { SubjectAbout } from '../SubjectAbout';

/**
 * "What is <name>?" is where a visitor's question forms, so it carries the
 * way to act on one (owner direction 2026-08-21: make Otto obvious). Since
 * 2026-08-31 the doors are built by the page and passed in, because the words
 * depend on what the reader may do and a manager's pair lives under the
 * number instead: this component only decides WHERE they go, and that they
 * step aside mid-edit.
 */
const base = {
  workspaceId: 'ws1',
  name: 'LookPilot',
  value: 'A webcam head tracker.',
  defaultText: 'default copy',
  canManage: false,
  onSaved: () => {},
};

const doors = <button type="button">Have Otto trade this market with you</button>;

describe('the What is section', () => {
  test('carries the doors the page handed it, under the words', () => {
    render(<SubjectAbout {...base} doors={doors} />);
    expect(screen.getByRole('button', { name: /have otto trade/i })).toBeTruthy();
  });

  test('has no doors where the page did not offer any', () => {
    render(<SubjectAbout {...base} />);
    expect(screen.queryByRole('button', { name: /otto/i })).toBeNull();
  });

  test('steps out of the way while the owner is editing', () => {
    render(<SubjectAbout {...base} canManage doors={doors} />);
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    expect(screen.queryByRole('button', { name: /have otto trade/i })).toBeNull();
  });
});
