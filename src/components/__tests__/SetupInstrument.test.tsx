import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { SetupInstrument, SetupTicks } from '../SetupInstrument';

/**
 * The hero is the market, and the ghost is not decoration.
 *
 * What it draws has to be what the row says, because the whole reason to watch
 * setup happen is that the thing sharpening on screen is the thing being made.
 * A market that holds nothing genuinely cannot be traded, so it gets no
 * needle: drawing one there would be the page telling a comfortable lie about
 * a market nobody can use.
 */

const MARKET = {
  metricName: 'Monthly disputes arbitrated',
  rangeMin: 0,
  rangeMax: 5000,
  targetDate: '2026-09',
  consensus: 1250,
  pool: 240,
};

describe('the instrument', () => {
  test('unset, it says what is missing rather than showing a number', () => {
    const { container } = render(<SetupInstrument market={null} />);
    expect(screen.getByText('A new market')).toBeTruthy();
    expect(screen.getByText(/your number, once you name it/i)).toBeTruthy();
    expect(screen.getByText('ceiling ?')).toBeTruthy();
    // The rail is dashed and the needle is still looking.
    expect(container.querySelector('.instr-rail.is-unset')).toBeTruthy();
    expect(container.querySelector('.instr-needle.is-set')).toBeNull();
  });

  test('priced, the needle sits where the market sits', () => {
    const { container } = render(<SetupInstrument market={MARKET} />);
    expect(screen.getByText('1,250')).toBeTruthy();
    expect(screen.getByText('5,000')).toBeTruthy();
    expect(screen.getByText(/240 credits behind it/)).toBeTruthy();
    // 1250 of a 0-5000 band is a quarter along.
    const needle = container.querySelector('.instr-needle') as HTMLElement;
    expect(needle.classList.contains('is-set')).toBe(true);
    expect(needle.style.left).toBe('25%');
  });

  test('a market holding nothing gets no needle, because it cannot be traded', () => {
    const { container } = render(<SetupInstrument market={{ ...MARKET, consensus: null, pool: 0 }} />);
    expect(screen.getByText(/cannot be traded/i)).toBeTruthy();
    expect(container.querySelector('.instr-needle.is-set')).toBeNull();
  });

  test('the strip names the company over the number, and says when it settles', () => {
    render(<SetupInstrument market={MARKET} name="Kleros" compact />);
    expect(screen.getByText(/Kleros · Monthly disputes arbitrated/)).toBeTruthy();
    // "2026-09" is market vocabulary a first-timer has no reason to know.
    expect(screen.getByText(/Settles Sep 2026/i)).toBeTruthy();
  });
});

describe('the ticks', () => {
  test('one per decision, inked when decided', () => {
    const { container } = render(
      <SetupTicks
        items={[
          { id: 'subject', label: 'What you run', status: 'done' },
          { id: 'number', label: 'The number', status: 'done' },
          { id: 'liquidity', label: 'Liquidity', status: 'open' },
        ]}
      />,
    );
    expect(container.querySelectorAll('.instr-tick')).toHaveLength(3);
    expect(container.querySelectorAll('.instr-tick.is-done')).toHaveLength(2);
    expect(container.querySelector('.instr-ticks')?.getAttribute('aria-label')).toBe('2 of 3 decided');
  });

  test('nothing renders before there is a checklist', () => {
    const { container } = render(<SetupTicks items={[]} />);
    expect(container.querySelector('.instr-ticks')).toBeNull();
  });
});
