import { render, screen } from '@testing-library/react';
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

  /**
   * Anyone who can trade a market can deepen it (owner ask 2026-09-02:
   * "make it actually possible for anyone to inject liquidity into any
   * market"). The API has always allowed it, `requireCapability('trade')`;
   * only the button was owner-only, so in a browser the depth of every
   * market was the owner's problem alone.
   */
  test('a trader is offered Inject, not only the owner', () => {
    render(<MarketFacts traders={1} pool={100} volume={0} canTrade onInject={() => {}} />);
    expect(screen.getByRole('button', { name: 'Inject' })).toBeInTheDocument();
  });

  test('someone who cannot trade the market is offered nothing to click', () => {
    render(<MarketFacts traders={1} pool={100} volume={0} onInject={() => {}} fundingHref="/f/funding" />);
    expect(screen.queryByRole('button', { name: 'Inject' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Buy' })).toBeNull();
  });

  // Buying credits is the owner's page: it funds THIS floor's pools out of
  // the owner's own money, so it stays where it was.
  test('Buy stays with the owner', () => {
    const { rerender } = render(
      <MarketFacts traders={1} pool={100} volume={0} canTrade onInject={() => {}} fundingHref="/f/funding" />,
    );
    expect(screen.queryByRole('link', { name: 'Buy' })).toBeNull();
    rerender(<MarketFacts traders={1} pool={100} volume={0} canManage onInject={() => {}} fundingHref="/f/funding" />);
    expect(screen.getByRole('link', { name: 'Buy' })).toBeInTheDocument();
  });
});
