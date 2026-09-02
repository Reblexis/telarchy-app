import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, test, vi } from 'vitest';

/**
 * What the propose form suggests you write.
 *
 * Owner direction 2026-08-20: the title should read "I will do a very useful
 * thing for {workspace}" and the pitch "This will affect {metrics} in this way
 * because of these reasons". Both placeholders used to be LookPilot's own copy
 * ("Stream LookPilot to my viewers for an hour", "Links: channel, portfolio,
 * prior work"), which on any other floor suggested the wrong company and, worse,
 * never told a proposer that the thing being priced is a NUMBER. Naming the
 * metric in the prompt is the difference between a pitch and a market can
 * price it.
 */

// Opening the form fetches the account, to warn when a paid proposal has
// nowhere for the money to go. Not what these tests are about.
vi.mock('../../lib/api', () => ({
  api: { getParticipant: async () => ({ payoutHandle: 'paid@example.com' }) },
}));

import { JobsBoard, metricsPhrase } from '../JobsBoard';

const base = {
  proposals: [],
  unit: '$',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  horizonDate: '2026-12',
};

function openForm(props: Partial<React.ComponentProps<typeof JobsBoard>> = {}) {
  render(
    <MemoryRouter>
      <JobsBoard {...base} workspaceName="LookPilot" {...props} />
    </MemoryRouter>,
  );
  // The exact CTA, not a loose regex: "Proposals" is also the board heading.
  fireEvent.click(screen.getByText('+ Propose'));
}

describe("the phrase for a floor's numbers", () => {
  test('one metric reads as itself', () => {
    expect(metricsPhrase(['net revenue'])).toBe('net revenue');
  });

  test('two are joined the way a person says them', () => {
    expect(metricsPhrase(['net revenue', 'weekly traders'])).toBe('net revenue and weekly traders');
  });

  test('three take commas and a final and', () => {
    expect(metricsPhrase(['a', 'b', 'c'])).toBe('a, b and c');
  });

  test('none still makes a sentence, rather than a hole in one', () => {
    expect(metricsPhrase([])).toBe('the number on this page');
    expect(metricsPhrase(['  '])).toBe('the number on this page');
  });
});

describe('the form suggests the right thing', () => {
  test('the title names this workspace, not the one it was written for', () => {
    openForm({ workspaceName: 'Telarchy' });
    expect(screen.getByLabelText('Proposal title').getAttribute('placeholder')).toBe(
      'I will do a very useful thing for Telarchy',
    );
  });

  test('the pitch names the numbers the proposal has to move', () => {
    openForm({ workspaceName: 'LookPilot', metricNames: ['LookPilot net 2026'] });
    expect(screen.getByLabelText('Proposal pitch').getAttribute('placeholder')).toBe(
      'This will affect LookPilot net 2026 in this way because of these reasons',
    );
  });

  test('a floor with two numbers names both', () => {
    openForm({ metricNames: ['net revenue', 'weekly traders'] });
    expect(screen.getByLabelText('Proposal pitch').getAttribute('placeholder')).toContain(
      'net revenue and weekly traders',
    );
  });

  test('before the markets load it still reads as a sentence', () => {
    openForm({ metricNames: [] });
    expect(screen.getByLabelText('Proposal pitch').getAttribute('placeholder')).toBe(
      'This will affect the number on this page in this way because of these reasons',
    );
  });
});

describe('a floor whose metrics are named after the company', () => {
  test('the pitch does not say the company name three times', () => {
    // What TradePage passes: metric labels already stripped of a leading
    // company name by captionLabel, the same treatment the number's caption
    // gets. The raw names here are "LookPilot weekly net revenue" and
    // "LookPilot monthly net revenue".
    openForm({
      workspaceName: 'LookPilot',
      metricNames: ['weekly net revenue', 'monthly net revenue'],
    });
    const pitch = screen.getByLabelText('Proposal pitch').getAttribute('placeholder')!;
    expect(pitch).toBe(
      'This will affect weekly net revenue and monthly net revenue in this way because of these reasons',
    );
    expect(pitch).not.toContain('LookPilot');
  });
});
