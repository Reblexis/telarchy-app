import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { MarketFacts } from '../MarketFacts';

/**
 * What ONE book says about itself, at the right end of the verbs panel's
 * stake row (docs/ui-conventions.md, "The verbs and the inline ticket",
 * row 1): its traders, its pool and its last trade, each behind its glyph
 * with the meaning as a hover title. Facts are an icon row, never a
 * sentence, and never a control: injecting liquidity is the metric sheet's
 * job now.
 */
describe('MarketFacts', () => {
  const NOW = new Date('2026-09-08T10:00:00.000Z');

  test('traders, pool and the last trade, with their meanings as titles', () => {
    const { container } = render(
      <MarketFacts traders={12} pool={2000} lastTradeAt="2026-09-08T08:00:00.000Z" now={NOW} />,
    );
    const spans = [...container.querySelectorAll('.pubws-facts > span')];
    expect(spans.map(s => s.textContent?.trim())).toEqual(['12', '2,000', 'last trade 2h ago']);
    expect(spans[0].getAttribute('title')).toContain('12 distinct participants');
    expect(spans[1].getAttribute('title')).toContain("in this book's pool");
    expect(spans[2].getAttribute('title')).toContain('Last trade on this book');
  });

  test('three glyphs, one per fact, and no sentence', () => {
    const { container } = render(<MarketFacts traders={12} pool={2000} lastTradeAt={null} now={NOW} />);
    const row = container.querySelector('.pubws-facts') as HTMLElement;
    expect(row.querySelectorAll('svg').length).toBe(3);
    expect(row.querySelectorAll(':scope > span[title]').length).toBe(3);
  });

  test('large numbers shorten the way a header does', () => {
    const { container } = render(
      <MarketFacts traders={2000} pool={11_000} lastTradeAt="2026-09-05T10:00:00.000Z" now={NOW} />,
    );
    expect([...container.querySelectorAll('.pubws-facts > span')].map(s => s.textContent?.trim())).toEqual([
      '2,000',
      '11k',
      'last trade 3d ago',
    ]);
  });

  test('a book nobody has traded says so instead of quoting an age', () => {
    const { container } = render(<MarketFacts traders={0} pool={1000} lastTradeAt={null} now={NOW} />);
    const spans = [...container.querySelectorAll('.pubws-facts > span')];
    expect(spans[2].textContent?.trim()).toBe('no trades yet');
    expect(spans[2].getAttribute('title')).toBe('No trade on this book yet');
  });

  test('the row carries no control: the pool is deepened from the metric sheet', () => {
    const { container } = render(<MarketFacts traders={3} pool={1200} lastTradeAt={null} now={NOW} />);
    expect(container.querySelectorAll('button').length).toBe(0);
    expect(container.querySelectorAll('a').length).toBe(0);
  });
});
