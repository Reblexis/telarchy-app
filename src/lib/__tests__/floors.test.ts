import { describe, expect, test } from 'vitest';
import { pickDefaultFloor } from '../floors';

describe('pickDefaultFloor', () => {
  test('first listed slug wins', () => {
    expect(pickDefaultFloor([{ slug: 'lookpilot', workspaceId: 'w1' }, { slug: 'other' }])).toBe('/lookpilot');
    expect(pickDefaultFloor([{ workspaceSlug: 'acme' }])).toBe('/acme');
  });

  test('a listing without a usable slug falls back to its marketplace page', () => {
    expect(pickDefaultFloor([{ workspaceId: 'w1', slug: null }])).toBe('/marketplace/w1');
    expect(pickDefaultFloor([{ workspaceId: 'w1', slug: 'Not A Slug' }])).toBe('/marketplace/w1');
  });

  test('no public workspace at all goes to the floors list', () => {
    expect(pickDefaultFloor([])).toBe('/floors');
    expect(pickDefaultFloor(null)).toBe('/floors');
    expect(pickDefaultFloor([{}])).toBe('/floors');
  });
});
