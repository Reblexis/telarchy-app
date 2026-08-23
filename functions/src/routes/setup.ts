import { Router } from 'express';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { floorQuestions, workspaces } from '../db/schema';
import { wrap } from '../lib/wrap';
import { askAboutWorkspace, askEnabled, type AskTurn } from '../lib/ask';
import { SETUP_SYSTEM, renderSetupBrief } from '../lib/setup-brief';
import { sanitiseDecisionIds } from '../lib/setup-spec';
import { buildChecklist } from '../services/setup-checklist';
import { writeHandoff } from '../services/setup-handoff';
import { ottoApiTools, type ApiCallRecord } from '../services/otto-tools';
import { requireCapability } from '../middleware/roles';

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

  // The floor as it is BEFORE this turn, so Otto is told the market holds
  // nothing rather than asked to remember whether he funded it. Read once and
  // reused for the handoff after the answer.
  const settledBefore = sanitiseDecisionIds(req.body?.settled);
  const floorBefore = owned[0] ?? null;
  const checklistBefore = floorBefore ? await buildChecklist(floorBefore.id) : null;

  const brief = renderSetupBrief({
    signedIn: Boolean(identity),
    name: req.auth?.agentId ?? null,
    workspaces: owned,
    settled: settledBefore,
    checklist: checklistBefore?.items.map(i => ({ id: i.id, label: i.label, status: i.status, note: i.note })),
    blocking: checklistBefore?.blocking,
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

    // The handoff to the caller's own agent, rewritten every turn (owner
    // direction 2026-08-23). Otto writes it against the specification, so it
    // can name their business and their source rather than a template's idea
    // of an operator; the ids in it are given to him and guarded, and a
    // failure falls back to the dull always-correct version.
    //
    // The checklist that goes with it is read from the database, so the model
    // is told what is true rather than asked to remember it.
    const floor = opened[0] ?? after[0] ?? null;
    const checklist = floor ? await buildChecklist(floor.id) : null;
    const handoff = await writeHandoff({
      turns: [...turns, { role: 'assistant', content: answer }],
      state: { signedIn: Boolean(identity), workspaces: after, opened },
      checklist,
      previouslySettled: settledBefore,
    });

    res.json({
      answer,
      opened,
      handoff: handoff.prompt,
      settled: handoff.settled,
      open: handoff.open,
      checklist: checklist ? { blocking: checklist.blocking, items: checklist.items.map(i => ({ id: i.id, label: i.label, status: i.status, note: i.note })) } : null,
    });
  } catch (e) {
    console.error('setup ask failed:', e);
    const message = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
    await db.insert(floorQuestions)
      .values({ ...logRow, error: message, toolCalls: actions.length ? actions : null })
      .catch(err => console.error('setup question log failed:', err));
    res.status(502).json({ error: 'Could not answer that right now. Try again in a moment.' });
  }
}));


/**
 * What is still open on a floor, read from the database (owner direction
 * 2026-08-23).
 *
 * This is the endpoint the handoff prompt tells the operator's own agent to
 * call FIRST. The prompt is written by a model at one instant; the floor keeps
 * changing after it. An agent that works from the prompt alone will re-do
 * settled work and miss what the operator decided in the meantime, so the
 * prompt's job is to carry intent and this endpoint's job is to carry state.
 *
 * Gated on `manage` for the workspace, because the notes quote the owner's own
 * settings and the blocking list is a map of what is not yet defended.
 */
setupRouter.get('/checklist', requireCapability('manage'), wrap(async (req, res) => {
  const asked = (req.query.workspaceId as string | undefined)
    ?? (req.headers['x-workspace-id'] as string | undefined);
  if (!asked) { res.status(400).json({ error: 'workspaceId is required (an id or a slug)' }); return; }

  // A slug is what a person has in front of them, so accept either. Resolved
  // directly rather than through the public-read helper, which is about what
  // a stranger may see: this floor may be private and its owner is asking.
  const [bySlug] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, asked));
  const workspaceId = bySlug?.id ?? asked;
  if (req.auth?.workspaceId && req.auth.workspaceId !== workspaceId && !req.auth.isMasterKey) {
    res.status(403).json({ error: 'Send this workspace as X-Workspace-Id to read its checklist.' });
    return;
  }

  const checklist = await buildChecklist(workspaceId);
  if (!checklist.workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }
  res.json(checklist);
}));
