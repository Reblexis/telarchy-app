import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * A floor closed to outside proposals offers no way to propose to anyone who
 * could not post (docs/ui-conventions.md, "The proposals board";
 * docs/guides/proposals.md, "Closing the floor to outside proposals"; owner
 * ask 2026-09-13: "it shouldnt even show as avilable").
 */

vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard, proposingOffered } from '../JobsBoard';

const base = {
  proposals: [],
  unit: '',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  horizonDate: '2099',
  workspaceName: 'Snake',
};

function board(props: Partial<React.ComponentProps<typeof JobsBoard>> = {}) {
  return render(
    <MemoryRouter>
      <JobsBoard {...base} {...props} />
    </MemoryRouter>,
  );
}

describe('who is offered the propose line', () => {
  test('an open floor offers it to everyone', () => {
    expect(proposingOffered(false, false)).toBe(true);
    expect(proposingOffered(undefined, false)).toBe(true);
    expect(proposingOffered(false, true)).toBe(true);
  });

  test('a closed floor offers it only to a viewer holding manage', () => {
    expect(proposingOffered(true, false)).toBe(false);
    expect(proposingOffered(true, true)).toBe(true);
  });
});

describe('THE PROPOSE LINE IS NOT DRAWN WHERE PROPOSING IS CLOSED', () => {
  test('a signed-in trader on a closed floor sees no propose line', () => {
    board({ canPropose: false });
    expect(screen.queryByText(/\+ Propose/)).toBeNull();
  });

  test('a signed-out visitor on a closed floor sees no signup door dressed as a propose line', () => {
    board({ canPropose: false, signedIn: false });
    expect(screen.queryByText(/\+ Propose/)).toBeNull();
  });

  test('the owner of a closed floor still sees it', () => {
    board({ canPropose: true, canManage: true });
    expect(screen.getByText(/\+ Propose/)).toBeTruthy();
  });

  test('a board told nothing draws it, as before (regression guard)', () => {
    board();
    expect(screen.getByText(/\+ Propose/)).toBeTruthy();
  });
});
