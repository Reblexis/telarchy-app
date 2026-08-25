import { describe, expect, test } from 'vitest';
import { amountToSlider, SLIDER_STEPS, sliderToAmount } from '../bet-slider';

/**
 * The bet slider's logarithmic track (user report 2026-08-21: a linear
 * 0-to-balance slider crams every sensible stake into the far left once
 * the balance is in the thousands).
 */

describe('bet slider scale', () => {
  test('the ends are exact: 1 cr on the left, the whole balance on the right', () => {
    expect(sliderToAmount(0, 23_400)).toBe(1);
    // Not two-sig rounded to 23,000: dragging to the end means all in.
    expect(sliderToAmount(SLIDER_STEPS, 23_400)).toBe(23_400);
  });

  test('sensible stakes own most of the track, not the leftmost pixels', () => {
    // On a 23,400 cr balance a linear track gives 1..100 cr under half a
    // percent of the width; the log track gives it nearly half.
    expect(amountToSlider(100, 23_400)).toBeGreaterThan(0.4 * SLIDER_STEPS);
    // ...and the midpoint of the track is a middling stake, not 11,700.
    const mid = sliderToAmount(SLIDER_STEPS / 2, 23_400);
    expect(mid).toBeGreaterThan(100);
    expect(mid).toBeLessThan(300);
  });

  test('the midpoint is the geometric mean of the range', () => {
    // sqrt(10,000) = 100, snapped to two significant digits.
    expect(sliderToAmount(SLIDER_STEPS / 2, 10_000)).toBe(100);
  });

  test('dragging snaps to two significant digits', () => {
    // Every reachable amount above 100 is a round number: 1,900, never 1,943.
    for (let pos = 0; pos <= SLIDER_STEPS; pos += 7) {
      const a = sliderToAmount(pos, 23_400);
      if (a >= 100 && a !== 23_400) {
        const mag = 10 ** (Math.floor(Math.log10(a)) - 1);
        expect(a % mag).toBe(0);
      }
    }
  });

  test('the mapping round-trips: a dragged position stays put', () => {
    for (let pos = 0; pos <= SLIDER_STEPS; pos += 13) {
      const a = sliderToAmount(pos, 23_400);
      const back = amountToSlider(a, 23_400);
      // Snapping may shift the thumb (integer credits are coarse in log
      // space at the very bottom: 1 cr to 2 cr spans ~69 steps), but only
      // a little, and the snapped position must be a fixed point so the
      // thumb never oscillates under the pointer.
      expect(Math.abs(back - pos)).toBeLessThanOrEqual(40);
      expect(sliderToAmount(back, 23_400)).toBe(a);
    }
  });

  test('amounts typed above the balance pin the thumb to the top', () => {
    expect(amountToSlider(99_999, 250)).toBe(SLIDER_STEPS);
  });

  test('a 1 cr balance degrades to a fixed 1 cr, not NaN', () => {
    expect(sliderToAmount(500, 1)).toBe(1);
    expect(amountToSlider(1, 1)).toBe(SLIDER_STEPS);
  });
});
