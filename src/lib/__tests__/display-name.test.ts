/**
 * One rule for what a participant is called (docs/agent-economy.md,
 * "Optional nickname"): the nickname, else a readable id, else "anonymous".
 * Reported 2026-09-17: the bot "Anaconda" read as "anonymous" on the boards
 * while its profile said Anaconda, because only the profile knew the id rule.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, test } from 'vitest';
import { displayName } from '../display-name';

describe('what a participant is called', () => {
  test('a bot with no nickname is called by its id, not anonymous', () => {
    expect(displayName(null, 'Anaconda')).toBe('Anaconda');
    expect(displayName(undefined, 'Snake-master')).toBe('Snake-master');
    expect(displayName('', 'Anaconda')).toBe('Anaconda');
  });

  test('the nickname wins', () => {
    expect(displayName('Big-Snake', 'Anaconda')).toBe('Big-Snake');
  });

  test('readable: 16 characters or fewer, or a hyphenated word of 24 or fewer', () => {
    expect(displayName(null, 'a'.repeat(16))).toBe('a'.repeat(16));
    expect(displayName(null, 'a'.repeat(17))).toBe('anonymous');
    expect(displayName(null, 'bot-e99e02b6-fbd-longer')).toBe('bot-e99e02b6-fbd-longer');
    expect(displayName(null, `${'a'.repeat(12)}-${'b'.repeat(11)}`)).toBe(`${'a'.repeat(12)}-${'b'.repeat(11)}`);
    expect(displayName(null, `${'a'.repeat(12)}-${'b'.repeat(12)}`)).toBe('anonymous');
  });

  test('an unreadable id (a uuid, a long hash) is anonymous', () => {
    expect(displayName(null, '3f2b8c1e-9a4d-4e7f-b1c2-5d6e7f8a9b0c')).toBe('anonymous');
    expect(displayName(null, '12345678-90123-45678-901')).toBe('anonymous');
  });

  test('no id at all is anonymous', () => {
    expect(displayName(null, null)).toBe('anonymous');
    expect(displayName(null, '')).toBe('anonymous');
  });

  test('a caller may name its own last resort', () => {
    expect(displayName(null, 'x'.repeat(40), 'you')).toBe('you');
    expect(displayName(null, 'Anaconda', 'you')).toBe('Anaconda');
  });
});

describe('every surface uses the one rule', () => {
  const surfaces = ['components/LeaderTables.tsx', 'components/FloorRails.tsx', 'pages/ParticipantProfilePage.tsx'];
  test.each(surfaces)('%s never falls back from a nickname straight to "anonymous"', file => {
    const source = readFileSync(join(__dirname, '../..', file), 'utf8');
    expect(source).not.toMatch(/nickname\s*(\|\||\?\?)\s*'anonymous'/);
    expect(source).not.toMatch(/nickname\s*(\|\||\?\?)\s*\(pinned/);
    expect(source).toContain('displayName(');
  });
});
