import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * Otto in the corner. What matters: he is closed until asked for (the page's
 * job is the market), a visitor with no idea what to ask is given real
 * questions about THIS company, the WHOLE conversation goes back with each
 * turn so a follow-up means something, and the panel says whose opinions
 * these are.
 */

const askFloor = vi.fn(async () => ({ answer: 'Webcam head tracking for sims, $14.99 on Steam. I would not pay more.' }));

vi.mock('../../lib/api', () => ({ api: { askFloor: (...a: unknown[]) => askFloor(...(a as [])) } }));

import { FloorChat } from '../FloorChat';

beforeEach(() => {
  askFloor.mockClear();
  // jsdom has no layout, so the scroll-to-latest is a no-op here.
  Element.prototype.scrollIntoView = vi.fn();
});

const props = { idOrSlug: 'lookpilot', workspaceName: 'LookPilot', metricLabel: 'Revenue this week' };
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
    await waitFor(() => expect(askFloor).toHaveBeenCalledWith('lookpilot', [
      { role: 'user', content: 'What does LookPilot actually do?' },
    ]));
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

    await waitFor(() => expect(askFloor).toHaveBeenLastCalledWith('lookpilot', [
      { role: 'user', content: 'What does LookPilot actually do?' },
      { role: 'assistant', content: 'Webcam head tracking for sims, $14.99 on Steam. I would not pay more.' },
      { role: 'user', content: 'Is that a lot?' },
    ]));
  });

  test('says whose opinions these are', () => {
    render(<FloorChat {...props} />);
    openHim();
    expect(screen.getByText(/not advice from LookPilot/)).toBeTruthy();
  });

  test('a refusal is shown, not swallowed', async () => {
    askFloor.mockImplementationOnce(async () => { throw new Error('That is a lot of questions.'); });
    render(<FloorChat {...props} />);
    openHim();
    fireEvent.click(screen.getByText('Which contract would you take?'));
    expect(await screen.findByText('That is a lot of questions.')).toBeTruthy();
  });
});
