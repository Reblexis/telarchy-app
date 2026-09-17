import { describe, expect, test } from 'vitest';
import { managesFloor } from '../manages-floor';

/**
 * The owner's controls are for whoever manages THIS floor
 * (docs/owner-on-the-floor.md, "Who sees the owner's controls"). Viktor,
 * 2026-09-17: "the choose options are visible even to just traders".
 */
describe('the owner controls are only for whoever manages this floor', () => {
  test('manage on this floor: yes', () => {
    expect(managesFloor({ workspaceId: 'ws-1', capabilities: ['manage', 'trade'] }, 'ws-1')).toBe(true);
  });
  test('manage on ANOTHER workspace, which is what the server answers for a non-member: no', () => {
    expect(managesFloor({ workspaceId: 'ws-own', capabilities: ['manage', 'trade'] }, 'ws-1')).toBe(false);
  });
  test('a trader on this floor: no', () => {
    expect(managesFloor({ workspaceId: 'ws-1', capabilities: ['read', 'trade'] }, 'ws-1')).toBe(false);
  });
  test('an answer naming no workspace, no capabilities, or nothing at all: no', () => {
    expect(managesFloor({ capabilities: ['manage'] }, 'ws-1')).toBe(false);
    expect(managesFloor({ workspaceId: 'ws-1' }, 'ws-1')).toBe(false);
    expect(managesFloor(null, 'ws-1')).toBe(false);
    expect(managesFloor(undefined, 'ws-1')).toBe(false);
    expect(managesFloor([], 'ws-1')).toBe(false);
  });
  test('no floor to be about: no', () => {
    expect(managesFloor({ workspaceId: '', capabilities: ['manage'] }, '')).toBe(false);
    expect(managesFloor({ workspaceId: 'ws-1', capabilities: ['manage'] }, undefined)).toBe(false);
  });
});
