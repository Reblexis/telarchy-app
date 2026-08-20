import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * The ask field on the floor. What matters: a visitor with no idea what to
 * ask is given real questions about THIS company, the answer is labelled as
 * coming from the floor's brief rather than from the internet, and the
 * agent prompt is copy-paste-runnable (it names this floor's own endpoint,
 * not a template with blanks).
 */

const askFloor = vi.fn(async () => ({ answer: 'It sells webcam head tracking for simulator games, $14.99 on Steam.' }));

vi.mock('../../lib/api', () => ({ api: { askFloor: (...a: unknown[]) => askFloor(...(a as [])) } }));

import { AskFloor } from '../AskFloor';

beforeEach(() => { askFloor.mockClear(); });

const props = { idOrSlug: 'lookpilot', workspaceName: 'LookPilot', metricLabel: 'Revenue this week' };

describe('asking the floor', () => {
  test('offers questions about this company before anything is typed', () => {
    render(<AskFloor {...props} />);
    expect(screen.getByText('What does LookPilot sell?')).toBeTruthy();
    expect(screen.getByText(/revenue this week/i)).toBeTruthy();
  });

  test('a suggestion asks it, and the answer is labelled as coming from the brief', async () => {
    render(<AskFloor {...props} />);
    fireEvent.click(screen.getByText('What does LookPilot sell?'));
    await waitFor(() => expect(askFloor).toHaveBeenCalledWith('lookpilot', 'What does LookPilot sell?'));
    expect(await screen.findByText(/webcam head tracking/)).toBeTruthy();
    expect(screen.getByText(/Prices in it are predictions, not facts/)).toBeTruthy();
  });

  test('a typed question is sent and the box clears', async () => {
    render(<AskFloor {...props} />);
    const input = screen.getByLabelText('Ask anything about LookPilot') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'How is revenue measured?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(askFloor).toHaveBeenCalledWith('lookpilot', 'How is revenue measured?'));
    await waitFor(() => expect(input.value).toBe(''));
  });

  test('a refusal is shown to the reader, not swallowed', async () => {
    askFloor.mockImplementationOnce(async () => { throw new Error('That is a lot of questions.'); });
    render(<AskFloor {...props} />);
    fireEvent.click(screen.getByText('What does LookPilot sell?'));
    expect(await screen.findByText('That is a lot of questions.')).toBeTruthy();
  });

  test('the agent prompt names this floor\'s own brief endpoint', () => {
    render(<AskFloor {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /point your own ai/i }));
    const prompt = screen.getByText(/api\/marketplace\/lookpilot\/context/);
    expect(prompt.textContent).toContain('?format=md');
    expect(prompt.textContent).toContain('/api/help');
    // The instruction that keeps someone else's agent as honest as ours.
    expect(prompt.textContent).toContain('only that brief');
  });
});
