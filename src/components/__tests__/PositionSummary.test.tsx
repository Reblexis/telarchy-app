import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { previewSell } from '../../lib/amm';
import { PositionSummary } from '../PositionSummary';

/**
 * A held position in four numbers (docs/ui-conventions.md, "what your
 * position is worth"): the ceiling it can pay, what selling now fetches,
 * what it cost, and the difference.
 */
describe('PositionSummary', () => {
  test('states ceiling, worth now, cost and the difference', () => {
    const { container } = render(
      <PositionSummary
        positions={[{ direction: 'higher', shares: 100, totalCost: 40 }]}
        orders={0}
        probability={0.6}
        liquidity={200}
        onManage={() => {}}
      />,
    );
    const text = container.textContent ?? '';
    const worth = previewSell(0.6, 200, 'higher', 100);
    expect(text).toContain('pays up to 100 cr');
    expect(text).toContain(`worth ${worth >= 100 ? Math.round(worth).toLocaleString('en-US') : worth.toFixed(1)} cr`);
    expect(text).toContain('spent 40.0 cr');
    expect(text).toMatch(/[+-][\d,.]+ \([+-]?\d+%\)/);
    expect(container.querySelector('.pubws-pos-profit')?.className).toContain(worth >= 40 ? 'is-up' : 'is-down');
  });

  test('a lower position pays its ceiling at the bottom of the range', () => {
    const { container } = render(
      <PositionSummary
        positions={[{ direction: 'lower', shares: 50, totalCost: 30 }]}
        orders={2}
        probability={0.4}
        liquidity={200}
        onManage={() => {}}
      />,
    );
    expect(container.querySelector('[title*="bottom of the range"]')).toBeTruthy();
    expect(container.textContent).toContain('2 resting orders');
  });
});
