/**
 * The setup conversation, kept across a trip to the signup page.
 *
 * Owner direction 2026-08-24: "if i sign up from there it shouldnt
 * disappear.. it should continue on what is saved". Signing up is the one
 * thing the door asks a visitor to leave for, and it asks exactly when they
 * have said the most: what they run, which number, where it is read from. A
 * conversation that empties itself on the way to an account is a conversation
 * they will not have twice.
 *
 * localStorage rather than sessionStorage, because an OAuth round trip can
 * come back in a different tab, and because someone who signs up now and
 * finishes tomorrow should still find their answers. That makes an expiry
 * necessary: a draft about a company they abandoned six weeks ago, offered
 * back as if it were live, is worse than a blank page.
 */

const KEY = 'telarchy.setup-draft.v1';
/** Long enough to survive signing up, sleeping on it and coming back; short
 *  enough that a stale draft never ambushes someone. */
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

export interface SetupDraft {
  turns: Array<{ role: 'user' | 'assistant'; content: string }>;
  handoff: string;
  settled: string[];
  savedAt: number;
}

export function loadSetupDraft(): SetupDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SetupDraft>;
    if (!Array.isArray(parsed.turns) || parsed.turns.length === 0) return null;
    if (typeof parsed.savedAt !== 'number' || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    // Trust nothing about the shape: this survives across deploys, so a draft
    // written by an older build has to fail closed rather than render.
    const turns = parsed.turns
      .filter(t => t && typeof t.content === 'string' && (t.role === 'user' || t.role === 'assistant'))
      .map(t => ({ role: t.role as 'user' | 'assistant', content: t.content as string }));
    if (!turns.length) return null;
    return {
      turns,
      handoff: typeof parsed.handoff === 'string' ? parsed.handoff : '',
      settled: Array.isArray(parsed.settled) ? parsed.settled.filter(s => typeof s === 'string') : [],
      savedAt: parsed.savedAt,
    };
  } catch (e) {
    // A private window, a full quota, a browser that refuses storage. The
    // door works without it; it just forgets.
    console.error('setup draft read failed:', e);
    return null;
  }
}

export function saveSetupDraft(draft: Omit<SetupDraft, 'savedAt'>): void {
  try {
    if (!draft.turns.length) return;
    localStorage.setItem(KEY, JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch (e) {
    console.error('setup draft write failed:', e);
  }
}

export function clearSetupDraft(): void {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    console.error('setup draft clear failed:', e);
  }
}
