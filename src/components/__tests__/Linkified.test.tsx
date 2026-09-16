import { render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import { Linkified } from '../Linkified';

/**
 * Links in prose are links (docs/ui-conventions.md, "Links in prose are
 * links"; Viktor 2026-09-11: "make sure that links in descriptions etc.
 * work"). A URL typed into a description renders as an anchor, new tab, no
 * referrer; the full stop after it stays text.
 */
describe('a URL in prose is a link', () => {
  test('renders the address as an anchor that opens in a new tab without a referrer', () => {
    const { container } = render(<Linkified text="Board: https://snake.telarchy.com and more" />);
    const a = container.querySelector('a') as HTMLAnchorElement;
    expect(a.getAttribute('href')).toBe('https://snake.telarchy.com');
    expect(a.textContent).toBe('https://snake.telarchy.com');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noreferrer');
    expect(container.textContent).toBe('Board: https://snake.telarchy.com and more');
  });
  test('trailing punctuation is not part of the address', () => {
    const { container } = render(
      <Linkified text="Board: https://snake.telarchy.com. Stream: https://www.twitch.tv/telarchy, live." />,
    );
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://snake.telarchy.com', 'https://www.twitch.tv/telarchy']);
    expect(container.textContent).toBe(
      'Board: https://snake.telarchy.com. Stream: https://www.twitch.tv/telarchy, live.',
    );
  });
  test('a closing bracket after an address stays text; one inside it stays in', () => {
    const { container } = render(
      <Linkified text="(see https://snake.telarchy.com/?embed=1) and https://en.wikipedia.org/wiki/Snake_(video_game)" />,
    );
    const hrefs = [...container.querySelectorAll('a')].map(a => a.getAttribute('href'));
    expect(hrefs).toEqual(['https://snake.telarchy.com/?embed=1', 'https://en.wikipedia.org/wiki/Snake_(video_game)']);
  });
  test('text without an address is text, line breaks kept', () => {
    const { container } = render(<Linkified text={'one\ntwo'} />);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toBe('one\ntwo');
  });
});

test('bot instructions are one named documentation link', () => {
  const { container } = render(
    <Linkified text="[How to trade with a bot](https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md)" />,
  );
  const links = container.querySelectorAll('a');
  expect(links).toHaveLength(1);
  expect(links[0].textContent).toBe('How to trade with a bot');
  expect(links[0].getAttribute('href')).toBe('https://github.com/Reblexis/telarchy-chess/blob/main/docs/trading.md');
  expect(container.textContent).toBe('How to trade with a bot');
});

test('named links never turn a script or HTML into executable content', () => {
  const { container } = render(<Linkified text={'[bad](javascript:alert(1)) <img src=x onerror=alert(1)>'} />);
  expect(container.querySelector('a, img, script')).toBeNull();
});
