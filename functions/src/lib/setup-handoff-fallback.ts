import type { AskTurn } from './ask';

/**
 * The handoff of last resort (owner direction 2026-08-22, demoted 2026-08-23).
 *
 * Otto writes the real one now (services/setup-handoff.ts), because a template
 * cannot be specific about a business it has never heard of. This stays as the
 * answer when the model returns junk or names an id we did not give it: the
 * page always has a prompt, and the difference between the two is only how
 * personal it is. It is deliberately dull and always correct.
 *
 * The original note follows.
 *
 * "Continue this with your own agent" (owner direction 2026-08-22).
 *
 * A setup conversation on telarchy.com is one of two places the work can
 * happen. The other is the operator's own assistant, which already knows their
 * business, their repo and where their numbers actually live. This is the
 * bridge: a paste-ready prompt, regenerated on every turn, that carries the
 * conversation so far plus the exact calls left to make.
 *
 * It is ASSEMBLED, not written by Otto. A model asked to restate ids gets one
 * wrong eventually, and a handoff with a wrong workspace id is worse than no
 * handoff: the agent on the other side will act on it. Everything factual here
 * comes from the database or from the request; everything judgemental comes
 * from the transcript, quoted rather than summarised.
 */

export interface HandoffState {
  signedIn: boolean;
  /** Floors the caller owns, after this turn. */
  workspaces: Array<{ name: string; slug: string | null; id?: string }>;
  /** Floors that came into existence during this conversation. */
  opened: Array<{ name: string; slug: string | null; id?: string }>;
}

import { publicOrigin } from './origin';

const ORIGIN = publicOrigin();

/** The transcript, compact, with the speakers named the way the page names
 *  them. Trimmed from the front: an agent needs the recent shape of the
 *  agreement more than the opening pleasantries. */
function transcript(turns: AskTurn[], maxChars = 4000): string {
  const lines = turns.map(t => `${t.role === 'user' ? 'Me' : 'Otto'}: ${t.content}`);
  let out = lines.join('\n\n');
  if (out.length > maxChars) {
    out = `[earlier turns trimmed]\n\n${out.slice(out.length - maxChars)}`;
  }
  return out;
}

export function renderHandoff(turns: AskTurn[], state: HandoffState): string {
  const parts: string[] = [];

  parts.push(
    'You are picking up a Telarchy setup I started at ' + ORIGIN + ', talking to Otto.',
    '',
    'What I am doing: putting one number my organisation answers to on a public market, so anyone (human or AI) can offer paid work against it and the market prices that work before I approve it. You know my business better than Otto does, so finish it with me.',
    '',
    'The conversation so far:',
    '',
    transcript(turns),
    '',
  );

  parts.push('Where it stands:');
  if (!state.signedIn) {
    parts.push(
      '- I am not signed in yet, so nothing has been created. I need an account at ' +
        ORIGIN +
        '/signup, or you can register a participant key with POST /api/agents/register.',
    );
  } else {
    parts.push('- I am signed in, so calls made with my session or my agent key run as me.');
  }
  if (state.opened.length) {
    for (const w of state.opened) {
      parts.push(
        `- Opened during this conversation: ${w.name}${w.slug ? `, at ${ORIGIN}/${w.slug}` : ''}${w.id ? ` (workspace id ${w.id})` : ''}.`,
      );
    }
  } else if (state.workspaces.length) {
    // With the id, because that is the thing the agent on the other side has
    // to send as X-Workspace-Id on every call; an address alone means it has
    // to go looking.
    parts.push(
      `- Nothing opened during this conversation. I already run: ${state.workspaces.map(w => `${w.name}${w.slug ? ` at ${ORIGIN}/${w.slug}` : ''}${w.id ? ` (workspace id ${w.id})` : ''}`).join('; ')}. Adding a number to one of those may be better than opening another.`,
    );
  } else {
    parts.push('- Nothing opened yet, and I run no market.');
  }
  parts.push('');

  parts.push(
    'What to do with the API (base ' +
      ORIGIN +
      '/api). Read GET /api/help first: it is the live catalog and it is more current than this message.',
    '',
    '1. Auth. Either use my browser session, or POST /api/agents/register to get an X-Agent-Key of your own. Every call below takes X-Workspace-Id once the workspace exists.',
    '2. Open the market, if it is not open yet: POST /api/workspaces { "name": "...", "template": "blank" } returns { id, slug }. A new market starts unlisted, which means live and shareable by link but not on the front page.',
    '3. Open the market: POST /api/metrics { "name": "...", "description": "where the value comes from, in the words it settles on", "value": 0, "formula": "", "marketRangeMax": <the highest it could plausibly reach>, "timePreference": { "enabled": false, "halfLife": 1, "customHorizons": ["YYYY-MM"] } }. The customHorizons entry is what makes a market exist; without it I own a settings page, not a market.',
    '4. Keep the number true: PUT /api/metrics/{metricId} { "value": <the real number>, "oldValue": <the previous one>, "updateNote": "where you read it" }, on whatever schedule fits the source. A number a human types in is worth less than one you read from the source, so wire it to the source if you can.',
    '5. Tell forecasters what they need: the market settles on the metric description, so make it precise, and add any context they cannot see.',
    '',
    'Before you call anything that creates or changes something, tell me what you are about to do and what it will cost me.',
  );

  return parts.join('\n');
}
