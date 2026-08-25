import { randomUUID } from 'crypto';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { floorQuestions, workspaces } from '../db/schema';
import { type AskTurn, askAboutWorkspace, askEnabled } from '../lib/ask';
import { renderSetupBrief, SETUP_SYSTEM } from '../lib/setup-brief';
import { SETUP_SPEC, sanitiseDecisionIds } from '../lib/setup-spec';
import { wrap } from '../lib/wrap';
import { type ApiCallRecord, ottoApiTools } from '../services/otto-tools';
import { buildChecklist } from '../services/setup-checklist';
import { writeHandoff } from '../services/setup-handoff';
import { webSearchTool } from '../services/web-search';

export const setupRouter = Router();

/**
 * Otto on the operator door: the setup conversation for someone who wants
 * their own floor (owner direction 2026-08-22, the operator-door design note).
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
setupRouter.post(
  '/ask',
  wrap(async (req, res) => {
    if (!askEnabled()) {
      res.status(503).json({ error: 'Answers are not configured on this instance.' });
      return;
    }

    // Same conversation contract as the floor: the caller keeps the turns and
    // sends them back, the server keeps the last twelve.
    const raw = Array.isArray(req.body?.messages)
      ? req.body.messages
      : typeof req.body?.question === 'string'
        ? [{ role: 'user', content: req.body.question }]
        : [];

    const turns: AskTurn[] = [];
    for (const m of raw.slice(-12)) {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof m?.content === 'string' ? m.content.trim() : '';
      if (!content) continue;
      if (role === 'user' && content.length > 1000) {
        res.status(400).json({ error: 'Keep each message under 1000 characters.' });
        return;
      }
      turns.push({ role, content: content.slice(0, 4000) });
    }
    if (turns.length === 0 || turns[turns.length - 1].role !== 'user') {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    const question = turns[turns.length - 1].content;

    // What changes what he may promise: whether they can act at all, and what
    // they already run. Offering to open a fourth floor to someone the API will
    // refuse is the kind of confident wrongness that ends the conversation.
    const identity = req.auth?.agentId ?? req.auth?.uid ?? null;
    // Newest first: someone who already runs three floors is here about the one
    // they just opened, not the one from March, and both the brief and the
    // handoff read [0] as "the floor we are talking about".
    const owned = identity
      ? await db
          .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.createdBy, identity))
          .orderBy(desc(workspaces.createdAt))
      : [];

    // The floor as it is BEFORE this turn, so Otto is told the market holds
    // nothing rather than asked to remember whether he funded it. Read once and
    // reused for the handoff after the answer.
    const _settledBefore = sanitiseDecisionIds(req.body?.settled);
    const floorBefore = owned[0] ?? null;
    const checklistBefore = floorBefore ? await buildChecklist(floorBefore.id) : null;

    const brief = renderSetupBrief({
      signedIn: Boolean(identity),
      name: req.auth?.agentId ?? null,
      workspaces: owned,
      // What the ROWS say is settled, not what the handoff model guessed last
      // turn. The guess was fed back as "do not ask about this again", which
      // produced the worst possible sentence: "the number was marked as already
      // settled, but its actual definition is not present in this chat" (owner,
      // 2026-08-24). A checklist item that is done carries its own note saying
      // what it is, so Otto is never told a decision exists without being told
      // what it was.
      settled: checklistBefore?.items.filter(i => i.status === 'done').map(i => i.id) ?? [],
      checklist: checklistBefore?.items.map(i => ({ id: i.id, label: i.label, status: i.status, note: i.note })),
      blocking: checklistBefore?.blocking,
    });

    const fwd = (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim();
    const ip = (fwd || req.socket.remoteAddress || '').slice(0, 60) || null;
    const logRow = {
      id: randomUUID(),
      workspaceId: null,
      question,
      askedBy: identity,
      ip,
      country: null,
      model: process.env.ASK_MODEL || 'openai/gpt-5.6-luna',
      createdAt: new Date(),
    };

    /**
     * Token by token when the caller asks for it (owner direction 2026-08-24:
     * "could you make the text appear token by token.. so i dont have to
     * wait?"). The wait is real: Otto reasons, sometimes calls the API, and
     * only then speaks, so a whole answer can be half a minute of nothing.
     *
     * Server-sent events rather than a websocket, because this is one direction
     * and one turn. The trailing `done` frame carries what the prose does not:
     * what was opened, and the checklist read back from the database. The
     * handoff is asked for separately, so its model call never delays this
     * one.
     */
    const wantsStream = req.headers.accept?.includes('text/event-stream') === true;
    let streaming = false;
    const send = (event: string, data: unknown) => {
      if (!streaming) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const actions: ApiCallRecord[] = [];
    try {
      if (wantsStream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        // Cloud Run and any proxy in front of it will happily hold a response
        // until it ends, which would turn this back into one long wait.
        res.setHeader('X-Accel-Buffering', 'no');
        res.flushHeaders?.();
        streaming = true;
      }

      const { answer, usage } = await askAboutWorkspace(
        // He can read about them as well as ask. What comes back is fenced as
        // untrusted (services/web-search.ts) and recorded in `actions` beside
        // the API calls, so the log says what he went and read.
        brief,
        turns,
        [webSearchTool(actions), ...ottoApiTools(req, actions)],
        {
          system: SETUP_SYSTEM,
          // Reasoning effort is available and is NOT on by default, because it
          // was measured: at effort=high the eval scored identically (safety
          // 7/7, judgement unchanged) and took nearly twice as long, 47s
          // against 26s. Latency is not free here, since a turn that runs long
          // is a turn the published beta proxy throws away. Raise it with
          // SETUP_EFFORT when a scenario shows it earning the wait.
          ...(process.env.SETUP_EFFORT ? { effort: process.env.SETUP_EFFORT } : {}),
          maxTokens: 3000,
          ...(streaming ? { onDelta: (text: string) => send('delta', { text }) } : {}),
        },
      );
      console.log(
        `setup ask: ${usage.input} in (${usage.cachedInput} cached), ${usage.output} out, $${usage.costUsd ?? '?'}`,
      );
      if (actions.length) {
        console.log(`setup ask: acted ${actions.map(a => `${a.method} ${a.path} -> ${a.status}`).join(', ')}`);
      }
      await db
        .insert(floorQuestions)
        .values({ ...logRow, answer, costUsd: usage.costUsd, toolCalls: actions.length ? actions : null })
        .catch(e => console.error('setup question log failed:', e));

      // What he opened while answering, so the page can offer the door to it
      // without parsing his prose for a URL. Read back rather than taken from
      // his words: a floor exists because the API says so.
      const after = identity
        ? await db
            .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
            .from(workspaces)
            .where(eq(workspaces.createdBy, identity))
            .orderBy(desc(workspaces.createdAt))
        : [];
      const before = new Set(owned.map(w => w.slug));
      const opened = after.filter(w => w.slug && !before.has(w.slug));

      // The handoff is NOT computed here (2026-08-24). It is a second model
      // call, and making the answer wait behind it pushed a turn past twenty
      // seconds, which is the deadline the published beta proxy gives up at:
      // Otto searched, answered, and the reader got a 502. The page asks for it
      // separately once the words are on screen, so one slow thing never hides
      // a finished one.
      const floor = opened[0] ?? after[0] ?? null;
      const checklist = floor ? await buildChecklist(floor.id) : null;

      const payload = {
        answer,
        opened,
        checklist: checklist
          ? {
              blocking: checklist.blocking,
              market: checklist.market,
              items: checklist.items.map(i => ({ id: i.id, label: i.label, status: i.status, note: i.note })),
            }
          : null,
      };
      if (streaming) {
        // The whole answer rides along too: the page has it already, and a
        // reader who lost a frame gets the authoritative copy rather than a
        // sentence with a hole in it.
        send('done', payload);
        res.end();
        return;
      }
      res.json(payload);
    } catch (e) {
      console.error('setup ask failed:', e);
      const message = e instanceof Error ? e.message.slice(0, 500) : String(e).slice(0, 500);
      await db
        .insert(floorQuestions)
        .values({ ...logRow, error: message, toolCalls: actions.length ? actions : null })
        .catch(err => console.error('setup question log failed:', err));
      // Once the headers are out a status code is no longer available, so the
      // failure has to arrive as a frame the page can read.
      if (streaming) {
        send('failed', { error: 'Could not answer that right now. Try again in a moment.' });
        res.end();
        return;
      }
      res.status(502).json({ error: 'Could not answer that right now. Try again in a moment.' });
    }
  }),
);

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
setupRouter.get(
  '/checklist',
  wrap(async (req, res) => {
    const asked =
      (req.query.workspaceId as string | undefined) ?? (req.headers['x-workspace-id'] as string | undefined);

    // No floor named: answer with the specification itself, every decision open.
    // The prompt tells an agent to call this FIRST, and the first time it runs
    // there is usually nothing to call it about yet; a 400 there would teach the
    // agent to skip the call exactly when it most needs the list.
    if (!asked) {
      res.json({
        workspace: null,
        items: SETUP_SPEC.map(d => ({
          ...d,
          status: 'open' as const,
          note: 'No floor named, so nothing is decided yet.',
        })),
        blocking: ['No floor exists yet. POST /api/workspaces { name, template: "blank" } opens one.'],
      });
      return;
    }

    // A slug is what a person has in front of them, so accept either. Resolved
    // directly rather than through the public-read helper, which is about what
    // a stranger may see: this floor may be private and its owner is asking.
    const [bySlug] = await db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, asked));
    const workspaceId = bySlug?.id ?? asked;

    // Gated here rather than on the route, so the spec-only answer above stays
    // open. The notes quote the owner's own settings and `blocking` is a map of
    // what is not yet defended, so reading them needs manage on THIS workspace.
    if (!req.auth) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (!req.auth.isMasterKey) {
      if (!req.auth.capabilities?.has('manage')) {
        res.status(403).json({
          error: 'Forbidden: reading a floor\'s checklist needs the "manage" capability in that workspace.',
          requiredCapabilities: ['manage'],
        });
        return;
      }
      if (req.auth.workspaceId && req.auth.workspaceId !== workspaceId) {
        res.status(403).json({ error: 'Send this workspace as X-Workspace-Id to read its checklist.' });
        return;
      }
    }

    const checklist = await buildChecklist(workspaceId);
    if (!checklist.workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }
    res.json(checklist);
  }),
);

/**
 * The prompt for the operator's own agent, on its own request.
 *
 * It used to ride along with the answer, which made every turn as slow as its
 * two model calls added together: past twenty seconds, and the published beta
 * proxy gives up there, so a reader whose turn had actually succeeded got a
 * 502 (2026-08-24). Split, the words arrive when Otto has written them and
 * the prompt catches up a moment later.
 *
 * Same rules as the ask: Otto writes it against the specification, every id in
 * it is checked against the database before it is returned, and a failure
 * falls back to the deterministic template rather than to nothing.
 */
setupRouter.post(
  '/handoff',
  wrap(async (req, res) => {
    if (!askEnabled()) {
      res.status(503).json({ error: 'Answers are not configured on this instance.' });
      return;
    }

    const raw = Array.isArray(req.body?.messages) ? req.body.messages : [];
    const turns: AskTurn[] = [];
    for (const m of raw.slice(-12)) {
      const role = m?.role === 'assistant' ? 'assistant' : 'user';
      const content = typeof m?.content === 'string' ? m.content.trim() : '';
      if (content) turns.push({ role, content: content.slice(0, 4000) });
    }
    if (!turns.length) {
      res.status(400).json({ error: 'messages is required' });
      return;
    }

    const identity = req.auth?.agentId ?? req.auth?.uid ?? null;
    const owned = identity
      ? await db
          .select({ id: workspaces.id, name: workspaces.name, slug: workspaces.slug })
          .from(workspaces)
          .where(eq(workspaces.createdBy, identity))
          .orderBy(desc(workspaces.createdAt))
      : [];
    const checklist = owned[0] ? await buildChecklist(owned[0].id) : null;

    const handoff = await writeHandoff({
      turns,
      state: { signedIn: Boolean(identity), workspaces: owned, opened: [] },
      checklist,
      previouslySettled: sanitiseDecisionIds(req.body?.settled),
    });

    res.json({
      handoff: handoff.prompt,
      settled: handoff.settled,
      open: handoff.open,
      written: handoff.written,
    });
  }),
);
