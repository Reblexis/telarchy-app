import { render } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { MarketChart } from '../MarketChart';

/**
 * A resting order on the chart names what it will do (docs/limit-orders.md,
 * "UI"): a buy and a sell at their limits read "buy" and "sell", in the
 * direction's colour, so a trader holding both can tell them apart.
 */

beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

const series = [
  { at: new Date(Date.now() - 3_600_000).toISOString(), consensus: 70_000 },
  { at: new Date().toISOString(), consensus: 73_600 },
];

describe('resting orders on the chart', () => {
  it('labels a buy order "buy" and a sell order "sell" at their limits', () => {
    const { container } = render(
      <MarketChart
        series={series}
        consensus={73_600}
        unit="$"
        orders={[
          { id: 'b', direction: 'higher', limitValue: 65_000, side: 'buy' },
          { id: 's', direction: 'higher', limitValue: 80_000, side: 'sell' },
        ]}
      />,
    );
    const labels = [...container.querySelectorAll('.mchart-order-label')].map(n => n.textContent);
    expect(labels).toHaveLength(2);
    expect(labels[0]).toMatch(/^▲ buy \$?65/);
    expect(labels[1]).toMatch(/^▲ sell \$?80/);
    expect(container.querySelectorAll('.mchart-order--higher')).toHaveLength(2);
  });

  it('an order with no side is a buy', () => {
    const { container } = render(
      <MarketChart
        series={series}
        consensus={73_600}
        unit="$"
        orders={[{ id: 'b', direction: 'lower', limitValue: 80_000 }]}
      />,
    );
    expect(container.querySelector('.mchart-order-label')?.textContent).toMatch(/^▼ buy /);
  });
});
