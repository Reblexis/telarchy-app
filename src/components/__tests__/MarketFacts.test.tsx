import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MarketFacts } from '../MarketFacts';

/** Three icons, bare numbers, meanings on hover (docs/ui-conventions.md). */
describe('MarketFacts', () => {
  test('prints traders, pool and volume as numbers with their meanings as titles', () => {
    const { container } = render(<MarketFacts traders={12} pool={2000} volume={5310} />);
    const spans = [...container.querySelectorAll('.pubws-facts > span')];
    expect(spans.map(s => s.textContent?.trim())).toEqual(['12', '2,000', '5,310']);
    expect(spans[0].getAttribute('title')).toContain('12 distinct participants');
    expect(spans[1].getAttribute('title')).toContain('in the pool');
    expect(spans[2].getAttribute('title')).toContain('traded on this market');
  });

  test('large numbers shorten the way a header does', () => {
    const { container } = render(<MarketFacts traders={2000} pool={11_000} volume={1_800_000} />);
    expect([...container.querySelectorAll('.pubws-facts > span')].map(s => s.textContent?.trim())).toEqual([
      '2,000',
      '11k',
      '1.8m',
    ]);
  });
});
