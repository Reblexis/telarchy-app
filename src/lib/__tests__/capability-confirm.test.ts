import { describe, test, expect } from 'vitest';
import {
  PRIVILEGED_CAPABILITIES,
  CAPABILITY_GRANTS,
  isPrivilegedCapability,
  privilegedCapabilitiesIn,
} from '../capability-confirm';

describe('capability-confirm', () => {
  test('manage and manage_workspace are the privileged capabilities', () => {
    expect(PRIVILEGED_CAPABILITIES).toEqual(['manage', 'manage_workspace']);
  });

  test('isPrivilegedCapability flags only the elevation capabilities', () => {
    expect(isPrivilegedCapability('manage')).toBe(true);
    expect(isPrivilegedCapability('manage_workspace')).toBe(true);
    expect(isPrivilegedCapability('read')).toBe(false);
    expect(isPrivilegedCapability('trade')).toBe(false);
  });

  test('every privileged capability has a human-readable grant description', () => {
    for (const cap of PRIVILEGED_CAPABILITIES) {
      expect(typeof CAPABILITY_GRANTS[cap]).toBe('string');
      expect(CAPABILITY_GRANTS[cap].length).toBeGreaterThan(0);
    }
  });

  test('privilegedCapabilitiesIn returns the privileged caps a group holds, in canonical order', () => {
    expect(privilegedCapabilitiesIn(['read', 'trade'])).toEqual([]);
    expect(privilegedCapabilitiesIn(['read', 'manage'])).toEqual(['manage']);
    // canonical order regardless of input order
    expect(privilegedCapabilitiesIn(['manage_workspace', 'manage', 'read'])).toEqual(['manage', 'manage_workspace']);
  });

  test('privilegedCapabilitiesIn tolerates undefined (no capabilities)', () => {
    expect(privilegedCapabilitiesIn(undefined)).toEqual([]);
  });
});
