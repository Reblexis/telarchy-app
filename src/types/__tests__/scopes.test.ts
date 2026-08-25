import { describe, expect, test } from 'vitest';
import { ACCOUNT_SCOPES, ALL_KEY_SCOPES, SCOPE_LABELS, SCOPE_PRESETS, WORKSPACE_SCOPES } from '../../types';

/**
 * The frontend mirrors the backend scope vocabulary by hand. This test pins
 * the mirror so a backend rename or drop has to be made in two places, with
 * an obvious failure if the two drift.
 */

describe('frontend scope vocabulary', () => {
  test('exposes the workspace scopes in implication order', () => {
    expect([...WORKSPACE_SCOPES]).toEqual(['workspace:read', 'workspace:trade', 'workspace:manage']);
  });
  test('exposes the documented account scopes', () => {
    expect([...ACCOUNT_SCOPES]).toEqual([
      'account:read',
      'account:write',
      'account:wallet',
      'account:keys',
      'account:agents',
      'account:feedback',
    ]);
  });
  test('every scope has a SCOPE_LABELS entry with non-empty label and help text', () => {
    for (const s of ALL_KEY_SCOPES) {
      const meta = SCOPE_LABELS[s];
      expect(meta).toBeDefined();
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.help.length).toBeGreaterThan(0);
      expect(['Workspace', 'Account']).toContain(meta.group);
    }
  });
  test('workspace scopes are tagged Workspace and account scopes are tagged Account', () => {
    for (const s of WORKSPACE_SCOPES) expect(SCOPE_LABELS[s].group).toBe('Workspace');
    for (const s of ACCOUNT_SCOPES) expect(SCOPE_LABELS[s].group).toBe('Account');
  });
});

describe('SCOPE_PRESETS (frontend mirror)', () => {
  test('preset ids are unique and stable', () => {
    const ids = SCOPE_PRESETS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['trader', 'reader', 'manager', 'account', 'full']);
  });

  test('Trader is the default for bots: read + trade only', () => {
    const trader = SCOPE_PRESETS.find(p => p.id === 'trader')!;
    expect(trader.scopes).toEqual(['workspace:read', 'workspace:trade']);
  });

  test('Read-only never trades and exposes own account read', () => {
    const reader = SCOPE_PRESETS.find(p => p.id === 'reader')!;
    expect(reader.scopes).toContain('workspace:read');
    expect(reader.scopes).toContain('account:read');
    expect(reader.scopes).not.toContain('workspace:trade');
    expect(reader.scopes).not.toContain('workspace:manage');
  });

  test('Workspace admin includes all three workspace caps', () => {
    const manager = SCOPE_PRESETS.find(p => p.id === 'manager')!;
    expect(manager.scopes.sort()).toEqual(['workspace:manage', 'workspace:read', 'workspace:trade']);
  });

  test('Account preset is purely account-scoped (no workspace caps)', () => {
    const account = SCOPE_PRESETS.find(p => p.id === 'account')!;
    expect(account.scopes.every(s => s.startsWith('account:'))).toBe(true);
    // Should at least include the four most useful account capabilities for
    // someone scripting their own account from outside the browser.
    expect(account.scopes).toEqual(
      expect.arrayContaining(['account:read', 'account:write', 'account:agents', 'account:feedback']),
    );
  });

  test('Full preset is the literal wildcard token', () => {
    const full = SCOPE_PRESETS.find(p => p.id === 'full')!;
    expect(full.scopes).toEqual(['*']);
  });

  test('every preset uses only known scopes (or the wildcard)', () => {
    const known = new Set<string>([...ALL_KEY_SCOPES, '*']);
    for (const p of SCOPE_PRESETS) {
      for (const s of p.scopes) expect(known.has(s)).toBe(true);
    }
  });

  test('every preset has a non-empty description (rendered as a tooltip)', () => {
    for (const p of SCOPE_PRESETS) {
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
