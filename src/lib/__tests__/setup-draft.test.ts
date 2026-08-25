import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { clearSetupDraft, loadSetupDraft, saveSetupDraft } from '../setup-draft';

/**
 * The setup conversation survives the trip to signup.
 *
 * Owner direction 2026-08-24: "it shouldnt disappear.. it should continue on
 * what is saved". The door asks a visitor to leave exactly once, and it asks
 * at the moment they have said the most; a conversation that empties itself
 * on the way to an account is one they will not have twice.
 */

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const TURNS = [
  { role: 'user' as const, content: 'I run an arbitration protocol' },
  { role: 'assistant' as const, content: 'Then the number is monthly disputes.' },
];

describe('the draft', () => {
  test('comes back with the conversation and what it settled', () => {
    saveSetupDraft({ turns: TURNS, handoff: 'PASTE ME', settled: ['subject', 'number'] });
    const back = loadSetupDraft()!;
    expect(back.turns).toEqual(TURNS);
    expect(back.handoff).toBe('PASTE ME');
    expect(back.settled).toEqual(['subject', 'number']);
  });

  test('nothing saved is nothing offered', () => {
    expect(loadSetupDraft()).toBeNull();
    saveSetupDraft({ turns: [], handoff: '', settled: [] });
    expect(loadSetupDraft()).toBeNull();
  });

  test('a stale draft is dropped rather than offered back', () => {
    // Someone who abandoned this six weeks ago should meet a blank page, not
    // a half-finished conversation about a company they no longer run.
    saveSetupDraft({ turns: TURNS, handoff: '', settled: [] });
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 4 * 24 * 60 * 60 * 1000);
    expect(loadSetupDraft()).toBeNull();
    expect(localStorage.getItem('telarchy.setup-draft.v1')).toBeNull();
  });

  test('a draft written by another build fails closed', () => {
    localStorage.setItem(
      'telarchy.setup-draft.v1',
      JSON.stringify({
        turns: [{ role: 'user', content: 'kept' }, { nonsense: true }, { role: 'user', content: 42 }],
        savedAt: Date.now(),
      }),
    );
    const back = loadSetupDraft()!;
    expect(back.turns).toEqual([{ role: 'user', content: 'kept' }]);
    expect(back.handoff).toBe('');
  });

  test('junk in storage does not take the page down with it', () => {
    localStorage.setItem('telarchy.setup-draft.v1', '{not json');
    expect(loadSetupDraft()).toBeNull();
  });

  test('clearing means clearing', () => {
    saveSetupDraft({ turns: TURNS, handoff: 'x', settled: [] });
    clearSetupDraft();
    expect(loadSetupDraft()).toBeNull();
  });
});
