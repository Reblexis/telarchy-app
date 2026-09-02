import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

/**
 * Otto in the corner. What matters: he is closed until asked for (the page's
 * job is the market), a visitor with no idea what to ask is given real
 * questions about THIS company, the WHOLE conversation goes back with each
 * turn so a follow-up means something, and the panel says whose opinions
 * these are.
 */

const askFloor = vi.fn(async () => ({
  answer: 'Webcam head tracking for sims, $14.99 on Steam. I would not pay more.',
}));

vi.mock('../../lib/api', () => ({ api: { askFloor: (...a: unknown[]) => askFloor(...(a as [])) } }));

import { FloorChat } from '../FloorChat';

beforeEach(() => {
  askFloor.mockClear();
  // jsdom has no layout, so the scroll-to-latest is a no-op here.
  Element.prototype.scrollIntoView = vi.fn();
});

const props = { idOrSlug: 'lookpilot', workspaceName: 'LookPilot', metricLabel: 'Revenue this week', signedIn: false };
const openHim = () => fireEvent.click(screen.getByRole('button', { name: /ask otto about lookpilot/i }));

describe('Otto', () => {
  test('is one line until someone wants him', () => {
    render(<FloorChat {...props} />);
    expect(screen.getByRole('button', { name: /ask otto about lookpilot/i })).toBeTruthy();
    // Nothing else of his is on the page.
    expect(screen.queryByLabelText('Ask Otto')).toBeNull();
  });

  test('opens with openers about this company, and answers one', async () => {
    render(<FloorChat {...props} />);
    openHim();
    expect(screen.getByText('What does LookPilot actually do?')).toBeTruthy();
    expect(screen.getByText(/revenue this week/i)).toBeTruthy();

    fireEvent.click(screen.getByText('What does LookPilot actually do?'));
    await waitFor(() =>
      expect(askFloor).toHaveBeenCalledWith('lookpilot', [
        { role: 'user', content: 'What does LookPilot actually do?' },
      ]),
    );
    expect(await screen.findByText(/Webcam head tracking for sims/)).toBeTruthy();
  });

  test('a follow-up carries the whole conversation', async () => {
    render(<FloorChat {...props} />);
    openHim();
    fireEvent.click(screen.getByText('What does LookPilot actually do?'));
    await screen.findByText(/Webcam head tracking for sims/);

    const input = screen.getByLabelText('Ask Otto') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Is that a lot?' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() =>
      expect(askFloor).toHaveBeenLastCalledWith('lookpilot', [
        { role: 'user', content: 'What does LookPilot actually do?' },
        { role: 'assistant', content: 'Webcam head tracking for sims, $14.99 on Steam. I would not pay more.' },
        { role: 'user', content: 'Is that a lot?' },
      ]),
    );
  });

  test('says whose opinions these are', () => {
    render(<FloorChat {...props} />);
    openHim();
    expect(screen.getByText(/not advice from LookPilot/)).toBeTruthy();
  });

  test('a refusal is shown, not swallowed', async () => {
    askFloor.mockImplementationOnce(async () => {
      throw new Error('That is a lot of questions.');
    });
    render(<FloorChat {...props} />);
    openHim();
    fireEvent.click(screen.getByText('Which proposal would you take?'));
    expect(await screen.findByText('That is a lot of questions.')).toBeTruthy();
  });
});

/**
 * The floor owns his open state because two doors lead to one conversation:
 * the corner dock and the "Ask Otto" button beside "What is <name>?" (owner
 * direction 2026-08-21). Two Ottos on one page, each with half the
 * conversation, is the failure this pins.
 */
describe('the second door', () => {
  test('opens from the page, not only from his own dock', () => {
    const { rerender } = render(<FloorChat {...props} open={false} onOpenChange={() => {}} />);
    expect(screen.queryByLabelText('Ask Otto')).toBeNull();

    rerender(<FloorChat {...props} open onOpenChange={() => {}} />);
    expect(screen.getByLabelText('Ask Otto')).toBeTruthy();
    // The dock is gone while the panel is up: one of him, not two.
    expect(screen.queryByRole('button', { name: /ask otto about lookpilot/i })).toBeNull();
  });

  test('tells the page when he is closed, so the page agrees with him', () => {
    const onOpenChange = vi.fn();
    render(<FloorChat {...props} open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

/**
 * Signed in, he is not an answer service: he acts with that person's own
 * account (owner direction 2026-08-21). The copy has to say which of the two
 * he is, because offering an action to someone who will get a 401 is the
 * failure that wastes their time.
 */
describe('what he says he can do', () => {
  test('signed out, he reads, and says signing up changes that', () => {
    render(<FloorChat {...props} open onOpenChange={() => {}} />);
    expect(screen.getByText(/Sign up and he can act for you too/i)).toBeTruthy();
    expect(screen.queryByText(/acts with your account/i)).toBeNull();
  });

  test('signed in, he acts with your account, and says the limit of that', () => {
    render(<FloorChat {...props} signedIn open onOpenChange={() => {}} />);
    expect(screen.getByText(/acts with your account and can do only what you can/i)).toBeTruthy();
    // And one opener is a thing to do, not a thing to ask.
    expect(screen.getByText('What am I holding, and what is it worth?')).toBeTruthy();
  });
});
