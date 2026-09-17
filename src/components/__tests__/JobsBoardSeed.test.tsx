/**
 * The form's "Your liquidity" row (docs/ui-conventions.md, "Posting one").
 *
 * THE RULE: posting is free unless the proposer says otherwise, and the form
 * never lets them name more than they hold. The number they pick is the
 * WHOLE amount (the server splits it across the markets), so what the button
 * says they spend is what they spend.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { JobsBoard } from '../JobsBoard';

const base = {
  proposals: [],
  unit: '',
  selectedId: null,
  onSelect: () => {},
  onPropose: async () => {},
  signedIn: true,
  onRequireSignup: () => {},
  workspaceName: 'Telarchy',
  proposalReward: 500,
};

const renderBoard = (props: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <JobsBoard {...(base as never)} {...(props as object)} />
    </MemoryRouter>,
  );
const openForm = async () => {
  fireEvent.click(screen.getAllByRole('button', { name: /Propose/ })[0]);
  await waitFor(() => expect(screen.getByLabelText('Proposal title')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Proposal title'), { target: { value: 'Ship the thing' } });
};
const row = () => screen.getByLabelText('Your liquidity');
const chip = (name: string) => screen.getByRole('button', { name });
const go = () => document.querySelector('.ticket-go') as HTMLButtonElement;

afterEach(() => vi.clearAllMocks());

describe('posting is free unless the proposer says otherwise', () => {
  test('"none" is preselected, the button says free, and no seed is sent', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose, spendable: 4000 });
    await openForm();
    expect(row()).toBeTruthy();
    expect(chip('none').getAttribute('aria-pressed')).toBe('true');
    expect(go().textContent).toMatch(/Free to post/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toBeUndefined();
  });

  test('a preset sends that whole amount and the button stops saying free', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose, spendable: 4000 });
    await openForm();
    fireEvent.click(chip('500'));
    expect(chip('500').getAttribute('aria-pressed')).toBe('true');
    expect(chip('none').getAttribute('aria-pressed')).toBe('false');
    expect(go().textContent).not.toMatch(/Free to post/);
    expect(go().textContent).toMatch(/500\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toBe(500);
  });

  test('back to "none" sends no seed again', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose, spendable: 4000 });
    await openForm();
    fireEvent.click(chip('500'));
    fireEvent.click(chip('none'));
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toBeUndefined();
  });

  test('custom takes any whole number of credits; empty or zero is no seed', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose, spendable: 4000 });
    await openForm();
    fireEvent.click(chip('custom amount'));
    const n = screen.getByLabelText('Custom liquidity') as HTMLInputElement;
    fireEvent.change(n, { target: { value: '0' } });
    expect(go().textContent).toMatch(/Free to post/);
    fireEvent.change(n, { target: { value: '12x50' } });
    expect(n.value).toBe('1250');
    expect(go().textContent).toMatch(/1,250\s*cr/);
    fireEvent.click(go());
    await waitFor(() => expect(onPropose).toHaveBeenCalled());
    expect(onPropose.mock.calls[0][5]).toBe(1250);
  });

  test('the row says where the money goes and that approval buys it back', async () => {
    renderBoard({ spendable: 4000 });
    await openForm();
    fireEvent.click(chip('100'));
    expect(row().parentElement?.textContent).toMatch(/split across/i);
    expect(row().parentElement?.textContent).toMatch(/4,000/);
  });
});

describe('the form never lets a proposer name more than they hold', () => {
  test('a seed above the balance disables the button and names what they hold', async () => {
    const onPropose = vi.fn(async () => {});
    renderBoard({ onPropose, spendable: 300 });
    await openForm();
    fireEvent.click(chip('500'));
    expect(go().disabled).toBe(true);
    expect(screen.getByText(/You hold 300 cr/)).toBeTruthy();
    fireEvent.click(go());
    expect(onPropose).not.toHaveBeenCalled();
  });

  test('a seed equal to the balance is allowed', async () => {
    renderBoard({ spendable: 500 });
    await openForm();
    fireEvent.click(chip('500'));
    expect(go().disabled).toBe(false);
  });

  test('an unknown balance (signed out, not loaded) never blocks: the server decides', async () => {
    renderBoard({ spendable: null });
    await openForm();
    fireEvent.click(chip('2,000'));
    expect(go().disabled).toBe(false);
  });
});
