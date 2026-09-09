import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { RankChart } from '../RankChart';

/**
 * The page's second and last drawing (docs/data-room.md, "How the page draws
 * things"): a value per ranked unit, for the two questions no time series can
 * answer, which are "who is near the line the count is drawn at".
 *
 * It answers the pointer the same way TimeChart does, because a reader who
 * has hovered one has then learned the other. What is pinned here is that
 * shared idiom, and the honesty rules the distribution had before it:
 * every unit keeps its slot, and a value past the axis is printed rather than
 * clipped in silence.
 */
const VALUES = [4200, 880, 310, 140, 96, 55, 0];

function chart(props: Partial<React.ComponentProps<typeof RankChart>> = {}) {
  const { container } = render(
    <RankChart id="t" values={VALUES} threshold={100} cap={500} unit="cr" label="Traded this week" {...props} />,
  );
  return container;
}

describe('the bars', () => {
  test('one bar per unit, zeroes included: a count throws the tail away', () => {
    expect(chart().querySelectorAll('.rchart-bar')).toHaveLength(VALUES.length);
  });

  test('the line that decides the count is drawn and named', () => {
    const c = chart();
    expect(c.querySelector('.rchart-threshold')).toBeTruthy();
    expect(c.textContent).toContain('100 cr counts');
  });

  test('a value past the axis is printed in full, never clipped in silence', () => {
    expect(chart().querySelector('.rchart-over')?.textContent).toContain('4,200');
  });

  test('nothing recorded yet says so rather than drawing an empty box', () => {
    expect(chart({ values: [] }).textContent).toContain('Nothing recorded yet');
  });
});

describe('the pointer, the same as the other chart', () => {
  test('hovering names the unit, its value and which side of the line it is', () => {
    const c = chart();
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 190 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 5, clientY: 50 });
    const tip = c.querySelector('.tchart-tip')?.textContent ?? '';
    expect(tip).toContain('1 of 7');
    expect(tip).toContain('4,200');
    expect(tip).toContain('over');
  });

  test('a unit under the line says so', () => {
    const c = chart();
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 190 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 755, clientY: 50 });
    expect(c.querySelector('.tchart-tip')?.textContent).toContain('under');
  });

  test('leaving takes the panel with it', () => {
    const c = chart();
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 190 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 400, clientY: 50 });
    expect(c.querySelector('.tchart-tip')).toBeTruthy();
    fireEvent.pointerLeave(svg);
    expect(c.querySelector('.tchart-tip')).toBeNull();
  });
});

describe('a signed distribution', () => {
  test('losses draw below the zero line and are named as such', () => {
    const c = chart({ values: [860, 140, -30, -520], threshold: 100, cap: 600, signed: true });
    expect(c.querySelectorAll('.rchart-bar.is-down')).toHaveLength(2);
    const svg = c.querySelector('svg') as SVGSVGElement;
    svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 760, height: 190 }) as DOMRect;
    fireEvent.pointerMove(svg, { clientX: 755, clientY: 50 });
    expect(c.querySelector('.tchart-tip')?.textContent).toContain('-520');
  });
});
