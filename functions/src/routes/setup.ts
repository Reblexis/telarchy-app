import { Router } from 'express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { floorQuestions, workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { askAboutWorkspace, askEnabled, type AskTurn } from '../lib/ask';
import { SETUP_SYSTEM, renderSetupBrief } from '../lib/setup-brief';
import { renderHandoff } from '../lib/setup-handoff';
import { ottoApiTools, type ApiCallRecord } from '../services/otto-tools';

export const setupRouter = Router();

/**
 * Otto on the operator door: the setup conversation for someone who wants
 * their own floor (owner direction 2026-08-22, docs/operator-setup.md).
 *
 * The same machinery as the floor's `POST /api/marketplace/:id/ask`, with two
 * differences and no third: a different job description (`SETUP_SYSTEM`), and
 * no workspace, because not having one is the state this door exists for.
 * His hands are identical, which is the point: `ottoApiTools` replays the
 * caller's own request, so the workspace he opens is opened BY them, owned by
 * them, and refused by the same middleware that would refuse them. There is no
 * service credential here, and adding one would be the change that makes him
 * dangerous.
 *
 * Anonymous callers are allowed through on purpose. Someone deciding whether
 * this is worth an account should be able to find out what setting it up would
 * involve; his instructions tell him to say plainly that he can create nothing
 * until they sign up, and the API would refuse him anyway.
 */
setupRouter.post('/ask', wrap(async (req, res) => {
  if (!askEnabled()) {
    res.status(503).json({ error: 'Answers are not configured on this instance.' });
    return;
  }

  // Same conversation contract as the floor: the caller keeps the turns and
  // sends them back, the server keeps the last twelve.
  const raw = Array.isArray(req.body?.messages)
    ? req.body.messages
    : (typeof req.body?.question === 'string' ? [{ role: 'user', content: req.body.question }] : []);

  const turns: AskTurn[] = [];
  for (const m of raw.slice(-12)) {
    const role = m?.role === 'assistant' ? 'assistant' : 'user';
    const content = typeof m?.content === 'string' ? m.content.trim() : '';
    if (!content) continue;
    if (role === 'user' && content.length > 1000) {
      res.status(400).json({ error: 'Keep each message under 1000 characters.' }); return;
    }
    turns.push({ role, content: content.slice(0, 4000) });
  }
  if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
    res.status(400).json({ error: 'question is required' }); return;
  }
  const question = turns[turns.length - 1].content;

  // What changes what he may promise: whether they can act at all, and what
  // they already run. Offering to open a fourth floor to someone the API will
  // refuse is the kind of confident wrongness that ends the conversation.
  const identity = req.auth?.agentId ?? req.auth?.uid ?? null;
  const owned = identity
    ? await db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
        .from(workspaces).where(eq(workspaces.createdBy, identity))
    : [];

  const brief = renderSetupBrief({
    signedIn: Boolean(identity),
    name: req.auth?.agentId ?? null,
    workspaces: owned,
  });

  const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
  const ip = (fwd || req.socket.remoteAddress || '').slice(0, 60) || null;
  const logRow = {
    id: randomUUID(), workspaceId: null, question, askedBy: identity, ip, country: null,
    model: process.env.ASK_MODEL || 'openai/gpt-5.6-luna', createdAt: new Date(),
  };

  const actions: ApiCallRecord[] = [];
  try {
    const { answer, usage } = await askAboutWorkspace(
      brief, turns, ottoApiTools(req, actions), SETUP_SYSTEM);
    console.log(`setup ask: ${usage.input} in (${usage.cachedInput} cached), ${usage.output} out, $${usage.costUsd ?? '?'}`);
    if (actions.length) {
      console.log(`setup ask: acted ${actions.map(a => `${a.method} ${a.path} -> ${a.status}`).join(', ')}`);
    }
    await db.insert(floorQuestions)
      .values({ ...logRow, answer, costUsd: usage.costUsd, toolCalls: actions.length ? actions : null })
      .catch(e => console.error('setup question log failed:', e));

    // What he opened while answering, so the page can offer the door to it
    // without parsing his prose for a URL. Read back rather than taken from
    // his words: a floor exists because the API says so.
    const after = identity
      ? await db.select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
          .from(workspaces).where(eq(workspaces.createdBy, identity))
      : [];
    const before = new Set(owned.map(w => w.slug));
    const opened = after.filter(w => w.slug && !before.has(w.slug));

    // The handoff to the caller's own agent, rebuilt every turn (owner
    // direction 2026-08-22). Assembled here rather than asked of Otto: a
    // model restating a workspace id gets one wrong eventually, and the agent
    // on the other side would act on it.
    const handoff = renderHandoff([...turns, { role: 'assistant', content: answer }], {
      signedIn: Boolean(identity),
      workspaces: after,
      opened,
    });

    res.json({ answer, opened, handoff });
  } catch (e) {
    console.error('setup ask failed:', e);
    const message = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    await db.insert(floorQuestions)
      .values({ ...logRow, error: message, toolCalls: actions.length ? actions : null })
      .catch(err => console.error('setup question log failed:', err));
    res.status(502).json({ error: 'Could not answer that right now. Try again in a moment.' });
  }
}));
