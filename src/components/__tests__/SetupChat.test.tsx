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

const askSetup = vi.fn(async () => ({ answer: 'Opened it.', opened: [] as Array<{ name: string; slug: string | null }> }));
vi.mock('../../lib/api', () => ({ api: { askSetup: (m: unknown) => askSetup(m as never) } }));

import { SetupChat } from '../SetupChat';

const renderChat = (signedIn = true) =>
  render(<MemoryRouter><SetupChat signedIn={signedIn} /></MemoryRouter>);

beforeEach(() => {
  // jsdom has no scrollIntoView; the log scrolls itself on every turn.
  Element.prototype.scrollIntoView = vi.fn();
  askSetup.mockClear();
  askSetup.mockResolvedValue({ answer: 'Opened it.', opened: [] });
});

describe('the setup conversation', () => {
  test('sends the whole conversation, so a follow-up means something', async () => {
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByLabelText(/tell otto what you run/i), 'I run an arbitration protocol');
    await user.click(screen.getByRole('button', { name: /send/i }));
    await waitFor(() => expect(askSetup).toHaveBeenCalled());

    askSetup.mockResolvedValue({ answer: 'Then disputes it is.', opened: [] });
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
    expect(screen.queryByRole('link', { name: /go to the floor/i })).toBeNull();

    askSetup.mockResolvedValue({ answer: 'Done.', opened: [{ name: 'Kleros', slug: 'kleros' }] });
    await user.type(screen.getByLabelText(/tell otto what you run/i), 'go on then');
    await user.click(screen.getByRole('button', { name: /send/i }));

    // The receipt names the floor and its address, and the link goes there.
    expect(await screen.findByText('Kleros')).toBeTruthy();
    expect(screen.getByText('telarchy.com/kleros')).toBeTruthy();
    expect(screen.getByRole('link', { name: /go to the floor/i }).getAttribute('href')).toBe('/kleros');
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
