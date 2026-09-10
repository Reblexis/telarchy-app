import { describe, expect, test } from 'vitest';
import { sentenceCase } from '../floor-horizons';

/**
 * A stored metric name is a label; inside a sentence it reads in sentence
 * case (docs/ui-conventions.md, "The question line", 2026-09-10: "Telarchy's
 * Active traders this month?" was live on every floor whose metric was stored
 * capitalised).
 */
describe('sentenceCase', () => {
  test('a capitalised label loses its capital mid-sentence', () => {
    expect(sentenceCase('Active traders')).toBe('active traders');
    expect(sentenceCase('Net revenue (USD)')).toBe('net revenue (USD)');
  });
  test('an acronym keeps it', () => {
    expect(sentenceCase('DAU')).toBe('DAU');
    expect(sentenceCase('MRR growth')).toBe('MRR growth');
  });
  test('a lowercase label is untouched, and so is an empty one', () => {
    expect(sentenceCase('net revenue')).toBe('net revenue');
    expect(sentenceCase('')).toBe('');
  });
  test('a proper noun the company name did not strip keeps its capital', () => {
    expect(sentenceCase('Steam reviews')).toBe('Steam reviews');
  });
});
