import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { previewSell } from '../../lib/amm';
import { PositionSummary } from '../PositionSummary';

/**
 * A held position as a card (docs/ui-conventions.md, "what your position is
 * worth"): four labeled cells, Sell.
 */
const fmt = (v: number) => (v >= 100 ? Math.round(v).toLocaleString('en-US') : v.toFixed(1));
const cellTexts = (container: HTMLElement) =>
  [...container.querySelectorAll('.pubws-poscard-cell')].map(c =>
    [...c.children].map(x => x.textContent?.replace(/\s+/g, ' ').trim()).join(' '),
  );

describe('PositionSummary', () => {
  test('four cells: pays up to, worth now, spent, profit with its percentage', () => {
    const { container } = render(
      <PositionSummary
        positions={[{ direction: 'higher', shares: 100, totalCost: 40 }]}
        orders={0}
        probability={0.6}
        liquidity={200}
        onManage={() => {}}
      />,
    );
    const worth = previewSell(0.6, 200, 'higher', 100);
    const cells = cellTexts(container);
    expect(cells[0]).toBe('Your position ▲ higher · 100 sh');
    expect(cells[1]).toBe('Pays up to 100 cr');
    expect(cells[2]).toBe(`Worth now ${fmt(worth)} cr`);
    expect(cells[3]).toBe('Spent 40.0 cr');
    expect(cells[4]).toMatch(/^Profit [+-][\d,.]+ [+-]?\d+%$/);
    expect(container.querySelector('.pubws-poscard-btn')?.textContent).toBe('Sell');
  });

  test('a lower position names the bottom of the range, and resting orders are counted', () => {
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
    expect(container.querySelector('.pubws-poscard-orders')?.textContent).toBe('2 resting orders');
  });
});
