import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

/**
 * Otto on the operator door (docs/operator-setup.md).
 *
 * The behaviour worth pinning is what the page believes about the world. Otto
 * is a model: he can say "your floor is live" when nothing was created. The
 * door to a floor may therefore only come from `opened`, which the server
 * reads back from the database, never from his prose.
 */

type Reply = {
  answer: string;
  opened: Array<{ name: string; slug: string | null }>;
  handoff: string;
  settled?: string[];
  open?: string[];
  checklist?: { blocking: string[]; items: Array<{ id: string; label: string; status: 'done' | 'open'; note: string }> } | null;
};
const askSetup = vi.fn(async (): Promise<Reply> => ({ answer: 'Opened it.', opened: [], handoff: '' }));
vi.mock('../../lib/api', () => ({ api: { askSetup: (m: unknown, s: unknown) => askSetup(m as never, s as never) } }));

import { SetupChat } from '../SetupChat';

const renderChat = (signedIn = true) =>
  render(<MemoryRouter><SetupChat signedIn={signedIn} /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  // jsdom has no scrollIntoView; the log scrolls itself on every turn.
  Element.prototype.scrollIntoView = vi.fn();
  askSetup.mockClear();
  askSetup.mockResolvedValue({ answer: 'Opened it.', opened: [], handoff: '' });
});

describe('the setup conversation', () => {
  test('sends the whole conversation, so a follow-up means something', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'I run an arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalled());

    askSetup.mockResolvedValue({ answer: 'Then disputes it is.', opened: [], handoff: '' });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'monthly disputes then');
    await user.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(2));
    const second = askSetup.mock.calls[1][0] as Array<{ role: string; content: string }>;
    expect(second).toHaveLength(3);
    expect(second[0].content).toBe('I run an arbitration protocol');
    expect(second[1].role).toBe('assistant');
  });

  test('the door to a floor appears only when the server says one exists', async () => {
    const user = userEvent.setup();
    renderChat();

    // He CLAIMS to have opened it and the server reports nothing opened.
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'set me up');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(screen.getByText('Opened it.')).toBeTruthy());
    expect(screen.queryByRole('link', { name: /kleros/i })).toBeNull();

    askSetup.mockResolvedValue({ answer: 'Done.', opened: [{ name: 'Kleros', slug: 'kleros' }], handoff: '' });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go on then');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The receipt names the floor and its address, and the link goes there.
    expect(await screen.findByText('Kleros')).toBeTruthy();
    expect(screen.getByText('telarchy.com/kleros')).toBeTruthy();
    expect(screen.getByRole('link', { name: /kleros/i }).getAttribute('href')).toBe('/kleros');
  });

  test('a failure is shown rather than swallowed', async () => {
    askSetup.mockRejectedValueOnce(new Error('That is a lot of questions.'));
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'hello');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/a lot of questions/i)).toBeTruthy();
  });

  test('signed out, he says he cannot open anything and offers the door', () => {
    renderChat(false);
    expect(screen.getByText(/create nothing/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /create an account/i })).toBeTruthy();
  });
});

describe('the handoff to your own agent', () => {
  test('appears once the server sends one, and carries what it said', async () => {
    askSetup.mockResolvedValue({
      answer: 'Which number?',
      opened: [],
      handoff: 'You are picking up a Telarchy setup.\nworkspace id ws-42',
    });
    const user = userEvent.setup();
    renderChat();

    // Nothing to hand off before the conversation starts. Asserted on the
    // rail's own control rather than its heading text, because the hero's
    // copy now also mentions your own agent.
    expect(screen.queryByRole('button', { name: /copy prompt/i })).toBeNull();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByRole('button', { name: /copy prompt/i })).toBeTruthy();
    expect(screen.getByText(/workspace id ws-42/)).toBeTruthy();
  });

  test('is replaced by the newest one, never appended to', async () => {
    const user = userEvent.setup();
    renderChat();

    askSetup.mockResolvedValue({ answer: 'One.', opened: [], handoff: 'FIRST HANDOFF' });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('FIRST HANDOFF');

    askSetup.mockResolvedValue({ answer: 'Two.', opened: [], handoff: 'SECOND HANDOFF' });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'b');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('SECOND HANDOFF')).toBeTruthy();
    // A stale prompt is worse than none: an agent would act on the old ids.
    expect(screen.queryByText('FIRST HANDOFF')).toBeNull();
  });

  test('copying puts the prompt on the clipboard', async () => {
    askSetup.mockResolvedValue({ answer: 'ok', opened: [], handoff: 'PASTE ME' });
    const user = userEvent.setup();
    // AFTER setup(): userEvent installs its own clipboard stub, so a stub
    // defined before this line is the one that gets replaced.
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('PASTE ME');
    await user.click(screen.getByRole('button', { name: /copy prompt/i }));

    expect(writeText).toHaveBeenCalledWith('PASTE ME');
    expect(await screen.findByRole('button', { name: /copied/i })).toBeTruthy();
  });
});

describe('what the conversation carries forward', () => {
  test('settled decisions go back with the next turn, so Otto stops re-asking', async () => {
    const user = userEvent.setup();
    renderChat();

    askSetup.mockResolvedValue({
      answer: 'Good.', opened: [], handoff: 'X'.repeat(220), settled: ['floor', 'number'],
    });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'kleros');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(1));
    // Nothing was settled before the first turn.
    expect(askSetup.mock.calls[0][1]).toEqual([]);

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'disputes');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalledTimes(2));
    expect(askSetup.mock.calls[1][1]).toEqual(['floor', 'number']);
  });

  test('the floor state shows what is blocking, not just what is done', async () => {
    askSetup.mockResolvedValue({
      answer: 'Opened.', opened: [], handoff: 'X'.repeat(220),
      checklist: {
        blocking: ['Every market holds zero liquidity, so every trade against them is refused.'],
        items: [
          { id: 'number', label: 'The number', status: 'done', note: 'Monthly disputes, 1 open market.' },
          { id: 'liquidity', label: 'Liquidity', status: 'open', note: 'Every market holds zero.' },
        ],
      },
    });
    const user = userEvent.setup();
    renderChat();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText(/every trade against them is refused/i)).toBeTruthy();
    expect(screen.getByText('The number')).toBeTruthy();
    expect(screen.getByText('Liquidity')).toBeTruthy();
  });
});

describe('the vocabulary a visitor reads', () => {
  test('never says "floor"', async () => {
    // Owner, 2026-08-14: "what the hell is floor, no one will understand
    // that". docs/ui-conventions.md makes it a rule: the word is internal
    // vocabulary, component and class names may keep it, and no string a
    // visitor can read may. When copy needs a word for one public workspace
    // it is "market". Everything this door says was written after that rule
    // and broke it, which is why the test is here rather than in review.
    askSetup.mockResolvedValue({
      answer: 'Which number?', opened: [{ name: 'Kleros', slug: 'kleros' }], handoff: 'X'.repeat(220),
    });
    const user = userEvent.setup();
    const { container } = renderChat(false);
    expect(container.textContent).not.toMatch(/floor/i);

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'a protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Which number?');
    // Includes the receipt, which names what was opened.
    expect(container.textContent).not.toMatch(/floor/i);
  });
});

describe('leaving to make an account', () => {
  test('the conversation is there when they come back', async () => {
    const user = userEvent.setup();
    askSetup.mockResolvedValue({
      answer: 'Then the number is monthly disputes.', opened: [], handoff: 'X'.repeat(220), settled: ['subject'],
    });
    const first = renderChat(false);
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'I run an arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByText('Then the number is monthly disputes.');
    first.unmount();

    // Signing up leaves the page entirely and comes back to it.
    renderChat(true);
    expect(await screen.findByText('Then the number is monthly disputes.')).toBeTruthy();
    expect(screen.getByText('I run an arbitration protocol')).toBeTruthy();
    // And what was settled goes back with the next turn, so Otto does not
    // re-ask what they answered before they had an account.
    askSetup.mockClear();
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'disputes, then');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalled());
    expect(askSetup.mock.calls[0][1]).toEqual(['subject']);
  });

  test('a finished setup is not offered back as unfinished', async () => {
    const user = userEvent.setup();
    askSetup.mockResolvedValue({
      answer: 'Opened.', opened: [{ name: 'Kleros', slug: 'kleros' }], handoff: 'X'.repeat(220),
    });
    const first = renderChat(true);
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await screen.findByRole('link', { name: /kleros/i });
    first.unmount();

    renderChat(true);
    expect(screen.queryByText('Opened.')).toBeNull();
  });
});
