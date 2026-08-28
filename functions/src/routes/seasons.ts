import { randomUUID } from 'crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { Router } from 'express';
import { db } from '../db/client';
import { agents, authUser, prizeSeasons, seasonEntries, workspaces } from '../db/schema';
import { loadSeasonSettled } from '../lib/board';
import { AppError } from '../lib/errors';
import { platformOperatedIds } from '../lib/participants';
import { isPlatformAuthorized } from '../lib/platform-admin';
import {
  claimDeadline,
  isOpenForEntry,
  type LadderRung,
  ladderTotal,
  type SeasonPayoutMode,
  type SeasonStatus,
  settleSeason,
} from '../lib/seasons';
import { wrap } from '../lib/wrap';
import { requireConsentIfUser } from '../middleware/consent';
import { requireIdentity } from '../middleware/roles';
import { SeasonStartError, startSeason } from '../services/seasons';
import { clearBoardCache } from './leaderboard';

/**
 * Prize seasons: entering one, seeing them, claiming a prize, and (for a
 * platform admin) running one.
 *
 * Standings are NOT here. They are `GET /api/leaderboard?seasonId=`, because a
 * season standing and a leaderboard row are the same fact about the same
 * participant and must come out of the same code. See routes/leaderboard.ts.
 *
 * WHERE THE MONEY IS NOT: nowhere in this file. Settlement decides who is
 * owed what; Telarchy, as the contest operator, then pays winners directly
 * from its own funds, outside the Service, against the payment details on
 * their account (`agents.payout_method`; ToS 3a since v1.6, 2026-08-28), and
 * records it with POST /:id/entries/:agentId/paid. No third-party funds are
 * ever held or transmitted.
 *
 *   draft ──start──► running ──settle──► settled ──claim──► paid
 *           │                    │                   │
 *           │ pins workspaceIds  │ freezes finals    │ 30 days, then the
 *           │ baselines EVERYONE │ assigns the pool  │ prize rolls forward
 */
export const seasonsRouter = Router();

// This router is mounted in app.ts BEFORE the global `app.use('/api',
// authMiddleware)` line, like proposals and predictions, so it must resolve
// auth itself or req.auth is never set and every identity-gated route below
// rejects valid credentials (this shipped broken: master key got 403
// "Platform admin required" on POST /). Optional rather than rejecting
// because GET / is public; requireIdentity / requirePlatform enforce the
// rest per route.
seasonsRouter.use(requireConsentIfUser);

function asLadder(raw: unknown): LadderRung[] {
  if (!Array.isArray(raw)) throw new AppError('ladder must be an array of { place, prizeUsd }', 400);
  return raw
    .map((r, i) => {
      const rung = r as { place?: unknown; prizeUsd?: unknown };
      const place = Number(rung.place);
      const prizeUsd = Number(rung.prizeUsd);
      if (!Number.isInteger(place) || place < 1)
        throw new AppError(`ladder[${i}].place must be a positive integer`, 400);
      if (!Number.isFinite(prizeUsd) || prizeUsd <= 0)
        throw new AppError(`ladder[${i}].prizeUsd must be a positive number`, 400);
      return { place, prizeUsd };
    })
    .sort((a, b) => a.place - b.place);
}

/**
 * Deliberately loose: shape only, no deliverability claim. A stricter regex
 * rejects valid addresses (plus tags, new TLDs, unicode locals) and the cost of
 * a wrong rejection here is an entrant who cannot enter, which is worse than an
 * entrant we cannot reach and have to chase.
 */
function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) && value.length <= 254;
}

async function requirePlatform(req: Parameters<typeof isPlatformAuthorized>[0]) {
  if (!(await isPlatformAuthorized(req))) throw new AppError('Platform admin required', 403);
}

/** The one running season, if there is one. The first season is deliberately singular:
 *  overlapping seasons would need per-season baselines the entry toggle cannot
 *  express, and nobody has asked for two. */
async function runningSeason() {
  const [s] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.status, 'running')).limit(1);
  return s ?? null;
}

/**
 * The season a participant can act on right now: the running one, or the next
 * draft when none is running.
 *
 * Entry opens before a season starts (owner direction 2026-08-18), so the
 * entry surfaces cannot key off `running` alone or the announcement, the
 * countdown and the button would all be invisible during exactly the window
 * where people are hearing about it. Running wins over draft, because a live
 * season is what someone acting today means; among drafts, the soonest to
 * start.
 */
async function enterableSeason() {
  const running = await runningSeason();
  if (running) return running;
  const drafts = await db.select().from(prizeSeasons).where(eq(prizeSeasons.status, 'draft'));
  drafts.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  return drafts[0] ?? null;
}

function publicSeason(s: typeof prizeSeasons.$inferSelect) {
  return {
    id: s.id,
    name: s.name,
    status: s.status as SeasonStatus,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    settledAt: s.settledAt,
    poolUsd: s.poolUsd,
    payoutMode: (s.payoutMode ?? 'ladder') as SeasonPayoutMode,
    minPayoutUsd: s.minPayoutUsd ?? 0,
    ladder: (s.ladder ?? []) as LadderRung[],
    rulesUrl: s.rulesUrl,
  };
}

function asPayoutMode(raw: unknown): SeasonPayoutMode {
  if (raw !== 'ladder' && raw !== 'proportional') {
    throw new AppError("payoutMode must be 'ladder' or 'proportional'", 400);
  }
  return raw;
}

function asMinPayout(raw: unknown, pool: number): number {
  const min = Number(raw);
  if (!Number.isFinite(min) || min < 0) throw new AppError('minPayoutUsd must be a non-negative number', 400);
  if (min >= pool) throw new AppError('minPayoutUsd must be below the pool, or nobody can ever be paid', 400);
  return min;
}

// ---------------------------------------------------------------------------
// Public
// ---------------------------------------------------------------------------

/** Every season, newest first. Public: the pool and the ladder are the pitch. */
seasonsRouter.get(
  '/',
  wrap(async (_req, res) => {
    const rows = await db.select().from(prizeSeasons);
    rows.sort((a, b) => new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
    res.json({ seasons: rows.map(publicSeason) });
  }),
);

// ---------------------------------------------------------------------------
// Entering
// ---------------------------------------------------------------------------

/**
 * This participant's relationship to the running season.
 *
 * Never returns payment details. Those live on the account and are read only by
 * the owner at payout time; a season response that carried them would put an
 * IBAN one serialisation mistake away from a public board.
 */
seasonsRouter.get(
  '/me',
  requireIdentity,
  wrap(async (req, res) => {
    const agentId = req.auth?.agentId;
    if (!agentId) throw new AppError('No participant identity on this request', 400);

    const season = await enterableSeason();
    if (!season) {
      res.json({ season: null, optedIn: false, canEnter: false });
      return;
    }

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, agentId)))
      .limit(1);

    // hasPayoutMethod is reported but NOT required to enter: the season page
    // uses it to tell a winner-in-waiting that a prize will need somewhere to
    // go, without making it a gate. rulesAcceptedAt so someone who has already
    // agreed is not asked twice.
    const [me] = await db
      .select({ payoutMethod: agents.payoutMethod, authUserId: agents.authUserId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);

    // Only browser signups have one; an API-registered participant has none,
    // which is why contactEmail is asked for at entry rather than derived.
    let authEmail: string | null = null;
    if (me?.authUserId) {
      const [u] = await db
        .select({ email: authUser.email })
        .from(authUser)
        .where(eq(authUser.id, me.authUserId))
        .limit(1);
      authEmail = u?.email ?? null;
    }

    res.json({
      season: publicSeason(season),
      optedIn: entry?.optedIn === true,
      canEnter: isOpenForEntry(season.status as SeasonStatus, new Date(), new Date(season.endsAt)),
      hasPayoutMethod: !!me?.payoutMethod,
      rulesAcceptedAt: entry?.rulesAcceptedAt ?? null,
      contactEmail: entry?.contactEmail ?? null,
      confirmedOver18At: entry?.confirmedOver18At ?? null,
      // The account's own email, so the entry form can prefill rather than
      // making a browser user retype what we already know. Null for participants
      // registered through the API, which is exactly the case contactEmail
      // exists for.
      accountEmail: authEmail ?? null,
    });
  }),
);

/**
 * Turn entry on or off.
 *
 * One gate on the way IN: an explicit agreement to the published rules, which
 * is recorded rather than merely ticked. Leaving needs no gate at all, because
 * a contest that is hard to withdraw from is indefensible.
 *
 * NO payment details are required to enter. That gate was added and removed
 * within a day (owner direction both ways, 2026-08-19); the reason it lost is
 * the reason it was never there: a visitor arriving cold from Manifold should
 * be one click from entering, and asking for an IBAN before they have placed a
 * trade is friction that already cost this funnel signups once. Winners are
 * asked at claim time, where the ask is easy because there is money waiting.
 *
 * The entry row may already exist without being an entry: the season snapshots
 * a baseline for every participant when it starts, so that opting in late
 * cannot be used to pick a favourable starting point. Opting in fills in the
 * rest of that row; it never rewrites the baseline.
 */
seasonsRouter.put(
  '/me',
  requireIdentity,
  wrap(async (req, res) => {
    const agentId = req.auth?.agentId;
    if (!agentId) throw new AppError('No participant identity on this request', 400);
    const optIn = req.body?.optedIn;
    if (typeof optIn !== 'boolean') throw new AppError('optedIn must be true or false', 400);

    const season = await enterableSeason();
    if (!season) throw new AppError('No season is open for entry', 409);
    if (!isOpenForEntry(season.status as SeasonStatus, new Date(), new Date(season.endsAt))) {
      throw new AppError('This season has closed to new entries', 409);
    }

    const [existing] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, agentId)))
      .limit(1);

    // Two gates, on the way IN only. Leaving is always one click: a rule that
    // made it hard to withdraw from a contest would be indefensible.
    //
    // `reason` is machine-readable so the entry button can render the step that
    // is actually missing rather than a generic failure. Both are enforced here
    // and not only in the UI, because the same endpoint serves API participants.
    const acceptedRules = req.body?.acceptedRules === true;
    const alreadyAccepted = !!existing?.rulesAcceptedAt;
    if (optIn && !acceptedRules && !alreadyAccepted) {
      throw new AppError(
        'You have to agree to the season rules to enter. Send acceptedRules: true once you have read them.',
        400,
        { reason: 'rules', rulesUrl: season.rulesUrl },
      );
    }

    // Where a winner is told they have won. Asked at entry rather than read off
    // the account, because a participant registered through POST /api/agents has
    // no email anywhere: only browser signups create an auth user. A prize with
    // a 30-day claim window and nobody to notify expires quietly, which is the
    // worst outcome a contest paying real money can produce.
    const rawEmail = typeof req.body?.contactEmail === 'string' ? req.body.contactEmail.trim() : '';
    const contactEmail = rawEmail || existing?.contactEmail || '';
    if (optIn && !contactEmail) {
      throw new AppError('Give an email we can reach you on if you win. It is used for the season only.', 400, {
        reason: 'contactEmail',
      });
    }
    if (optIn && !isPlausibleEmail(contactEmail)) {
      throw new AppError('That does not look like an email address.', 400, { reason: 'contactEmail' });
    }

    // The published rules have always required entrants to be 18 or older, and
    // until now nothing asked. A rule nobody is asked to affirm is a sentence in
    // a document, not an eligibility check.
    const confirmedOver18 = req.body?.confirmedOver18 === true;
    const alreadyConfirmed = !!existing?.confirmedOver18At;
    if (optIn && !confirmedOver18 && !alreadyConfirmed) {
      throw new AppError('You have to confirm you are 18 or older to enter.', 400, { reason: 'age' });
    }

    // NO payment-details gate. It was added and removed the same day
    // (2026-08-19, owner direction both ways): entry has to stay one click for a
    // visitor arriving cold, and payment details are asked for at claim time,
    // from winners, when there is money waiting and the ask is easy. The rules
    // agreement above is the only thing standing between reading about the
    // season and being in it.

    const rulesAcceptedAt = optIn ? (existing?.rulesAcceptedAt ?? new Date()) : (existing?.rulesAcceptedAt ?? null);
    const confirmedOver18At = optIn
      ? (existing?.confirmedOver18At ?? new Date())
      : (existing?.confirmedOver18At ?? null);

    if (existing) {
      await db
        .update(seasonEntries)
        .set({
          optedIn: optIn,
          enteredAt: optIn ? (existing.enteredAt ?? new Date()) : existing.enteredAt,
          // Never cleared on the way out: that they once agreed is a fact, and
          // rejoining should not ask again.
          rulesAcceptedAt,
          confirmedOver18At,
          // A resent address wins, so someone can correct a typo by re-entering
          // rather than by asking us to.
          contactEmail: contactEmail || existing.contactEmail,
        })
        .where(and(eq(seasonEntries.seasonId, season.id), eq(seasonEntries.agentId, agentId)));
    } else {
      // No baseline row means this account did not exist (or had no activity)
      // when the season started, so its baseline is 0 and everything it earns
      // inside the window counts. Exactly what a newcomer should get.
      await db.insert(seasonEntries).values({
        seasonId: season.id,
        agentId,
        optedIn: optIn,
        enteredAt: optIn ? new Date() : null,
        rulesAcceptedAt,
        confirmedOver18At,
        contactEmail: contactEmail || null,
        baselineProfit: 0,
      });
    }

    res.json({ season: publicSeason(season), optedIn: optIn });
  }),
);

/**
 * Claim a prize.
 *
 * The winner must have payment details on their account first; this endpoint
 * only records that they have asked to be paid and stops the clock. Payment
 * itself happens outside the Service and is recorded by the owner.
 */
seasonsRouter.post(
  '/:id/claim',
  requireIdentity,
  wrap(async (req, res) => {
    const agentId = req.auth?.agentId;
    if (!agentId) throw new AppError('No participant identity on this request', 400);
    const seasonId = req.params.id as string;

    const [season] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
    if (!season) throw new AppError('Season not found', 404);
    if (season.status !== 'settled' || !season.settledAt) throw new AppError('This season has not settled yet', 409);

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)))
      .limit(1);
    if (!entry || !entry.prizeUsd || entry.prizeUsd <= 0) throw new AppError('No prize to claim on this season', 403);
    if (entry.claimState === 'claimed' || entry.claimState === 'paid') {
      throw new AppError('This prize has already been claimed', 409);
    }

    const deadline = claimDeadline(new Date(season.settledAt));
    if (new Date() > deadline) {
      // Record the expiry rather than just refusing, so the rolled-forward pool
      // has a row explaining where the money went.
      await db
        .update(seasonEntries)
        .set({ claimState: 'expired' })
        .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)));
      throw new AppError(
        `The claim window closed on ${deadline.toISOString().slice(0, 10)}; this prize has rolled into the next season`,
        409,
      );
    }

    const [agent] = await db
      .select({ payoutMethod: agents.payoutMethod })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (!agent?.payoutMethod) {
      throw new AppError('Add payment details to your account before claiming (Account > payment details)', 400);
    }

    await db
      .update(seasonEntries)
      .set({ claimState: 'claimed', claimedAt: new Date() })
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)));

    res.json({ claimed: true, prizeUsd: entry.prizeUsd, claimBy: deadline });
  }),
);

// ---------------------------------------------------------------------------
// Running a season (platform admin)
// ---------------------------------------------------------------------------

seasonsRouter.post(
  '/',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const { name, startsAt, endsAt, poolUsd, rulesUrl } = req.body ?? {};
    if (typeof name !== 'string' || !name.trim()) throw new AppError('name is required', 400);
    if (typeof rulesUrl !== 'string' || !rulesUrl.trim()) throw new AppError('rulesUrl is required', 400);

    const start = new Date(startsAt);
    const end = new Date(endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()))
      throw new AppError('startsAt and endsAt must be ISO dates', 400);
    if (end <= start) throw new AppError('endsAt must be after startsAt', 400);

    const pool = Number(poolUsd);
    if (!Number.isFinite(pool) || pool <= 0) throw new AppError('poolUsd must be a positive number', 400);
    // No pool ceiling. The old sub-5000 rule was the NY/FL registration and
    // bonding threshold for CHANCE sweepstakes; a deterministic skill-scored
    // payout is a skill contest and scales uncapped (retired 2026-08-28,
    // design record notes/wheel-vs-proportional-legality-2026-08-28.md in
    // the telarchy umbrella). MAX_SINGLE_PAYOUT_USD in lib/seasons.ts is the
    // cap that still matters, per payout rather than per pool.

    // Mode defaults from the body's shape so existing ladder-shaped callers
    // keep working: a ladder sent means ladder mode, nothing sent means
    // proportional, and an explicit payoutMode always wins.
    const payoutMode = asPayoutMode(
      req.body?.payoutMode ?? (req.body?.ladder !== undefined ? 'ladder' : 'proportional'),
    );
    const minPayoutUsd = req.body?.minPayoutUsd !== undefined ? asMinPayout(req.body.minPayoutUsd, pool) : 0;

    const ladder = payoutMode === 'ladder' ? asLadder(req.body?.ladder) : [];
    if (payoutMode === 'ladder') {
      const total = ladderTotal(ladder);
      if (total > pool) throw new AppError(`ladder promises ${total} but the pool is ${pool}`, 400);
    }

    const id = randomUUID();
    await db.insert(prizeSeasons).values({
      id,
      name: name.trim(),
      startsAt: start,
      endsAt: end,
      poolUsd: pool,
      payoutMode,
      minPayoutUsd,
      ladder,
      workspaceIds: [],
      rulesUrl: rulesUrl.trim(),
      status: 'draft',
    });
    const [created] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, id)).limit(1);
    res.status(201).json({ season: publicSeason(created) });
  }),
);

/**
 * Edit a DRAFT season; amend the payout of a RUNNING one.
 *
 * The state machine has always said a draft's pool, ladder and dates are
 * editable, and until now nothing implemented it: moving a start date meant a
 * hand-written UPDATE against production, which is the operation this file
 * exists to make unnecessary. Draft-only for everything positional (dates,
 * pool, name, rules URL), because once a season is running its baselines are
 * pinned to its start instant.
 *
 * The one running-season exception is `payoutMode` + `minPayoutUsd`
 * (2026-08-28): Season 0's published rules reserve the right to amend
 * mid-season provided the change is announced on the season page before it
 * takes effect, and the ladder-to-proportional amendment is exactly such a
 * change. The pool and dates stay frozen even then; a settled season takes
 * nothing at all. ANNOUNCE FIRST: this endpoint flips the arithmetic, and the
 * clause it leans on requires the announcement to precede the flip.
 *
 * Same validation as create, deliberately: a rule that only guards the front
 * door is not a rule.
 */
seasonsRouter.patch(
  '/:id',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const seasonId = req.params.id as string;

    const [season] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
    if (!season) throw new AppError('Season not found', 404);
    if (season.status === 'running') {
      const allowed = new Set(['payoutMode', 'minPayoutUsd']);
      const sent = Object.keys(req.body ?? {});
      const refused = sent.filter(k => !allowed.has(k));
      if (refused.length > 0 || sent.length === 0) {
        throw new AppError(
          'Season is running; only payoutMode and minPayoutUsd may be amended mid-season, under the published amendment clause, after the change is announced on the season page',
          409,
        );
      }
      const patch: Partial<typeof prizeSeasons.$inferInsert> = {};
      if (req.body?.payoutMode !== undefined) patch.payoutMode = asPayoutMode(req.body.payoutMode);
      if (req.body?.minPayoutUsd !== undefined) patch.minPayoutUsd = asMinPayout(req.body.minPayoutUsd, season.poolUsd);
      await db.update(prizeSeasons).set(patch).where(eq(prizeSeasons.id, seasonId));
      const [updated] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
      res.json({ season: publicSeason(updated) });
      return;
    }
    if (season.status !== 'draft') {
      throw new AppError(`Season is ${season.status}; only a draft can be edited`, 409);
    }

    const patch: Partial<typeof prizeSeasons.$inferInsert> = {};
    const { name, startsAt, endsAt, poolUsd, rulesUrl } = req.body ?? {};

    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim()) throw new AppError('name must be a non-empty string', 400);
      patch.name = name.trim();
    }
    if (rulesUrl !== undefined) {
      if (typeof rulesUrl !== 'string' || !rulesUrl.trim())
        throw new AppError('rulesUrl must be a non-empty string', 400);
      patch.rulesUrl = rulesUrl.trim();
    }

    // Dates are validated as a PAIR against what the season will actually be
    // after the patch, not against what was sent: moving only the start must
    // still be refused if it lands after the existing end.
    const start = startsAt !== undefined ? new Date(startsAt) : new Date(season.startsAt);
    const end = endsAt !== undefined ? new Date(endsAt) : new Date(season.endsAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError('startsAt and endsAt must be ISO dates', 400);
    }
    if (end <= start) throw new AppError('endsAt must be after startsAt', 400);
    if (startsAt !== undefined) patch.startsAt = start;
    if (endsAt !== undefined) patch.endsAt = end;

    const pool = poolUsd !== undefined ? Number(poolUsd) : season.poolUsd;
    if (!Number.isFinite(pool) || pool <= 0) throw new AppError('poolUsd must be a positive number', 400);
    if (poolUsd !== undefined) patch.poolUsd = pool;

    // Validated against what the season will BE after the patch, like the
    // dates: the mode decides whether a ladder is required at all.
    const mode = asPayoutMode(req.body?.payoutMode ?? season.payoutMode ?? 'ladder');
    if (req.body?.payoutMode !== undefined) patch.payoutMode = mode;
    if (req.body?.minPayoutUsd !== undefined) patch.minPayoutUsd = asMinPayout(req.body.minPayoutUsd, pool);

    const ladder = req.body?.ladder !== undefined ? asLadder(req.body.ladder) : ((season.ladder ?? []) as LadderRung[]);
    if (mode === 'ladder') {
      const total = ladderTotal(ladder);
      if (total > pool) throw new AppError(`ladder promises ${total} but the pool is ${pool}`, 400);
    }
    if (req.body?.ladder !== undefined) patch.ladder = ladder;

    if (Object.keys(patch).length === 0) throw new AppError('Nothing to change', 400);

    await db.update(prizeSeasons).set(patch).where(eq(prizeSeasons.id, seasonId));
    const [updated] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
    res.json({ season: publicSeason(updated) });
  }),
);

/**
 * Start a season: pin its workspace set and baseline every participant.
 *
 * Both halves are the point. The pinned set stops a later visibility change
 * from injecting an entrant's whole history into their season score. The
 * universal baseline stops opting in late from being a free option on your own
 * drawdown: whenever you enter, you are measured from where the season began.
 *
 * One transaction, and re-runnable: a half-finished baseline snapshot would
 * score some entrants from the start and others from zero, which is a silent
 * and unfixable unfairness once trading has happened on top of it.
 */
seasonsRouter.post(
  '/:id/start',
  wrap(async (req, res) => {
    await requirePlatform(req);
    try {
      // The whole body of this used to live here. It moved to
      // services/seasons.ts so the scheduler can start a season the same way a
      // human does; two copies of "pin the workspaces and snapshot every
      // baseline" would eventually disagree about what a season was scored from.
      const result = await startSeason(req.params.id as string);
      res.json({ started: true, ...result });
    } catch (e) {
      if (e instanceof SeasonStartError) throw new AppError(e.message, e.status);
      throw e;
    }
  }),
);

/**
 * Settle: freeze the finals, rank, assign the ladder.
 *
 * Reachable ONLY from `running`, and only once `endsAt` has passed (guard
 * added 2026-08-28: the scored window is `(startsAt, endsAt]` on market
 * resolve instants, so settling early would silently truncate it). A second
 * settle would recompute and could reassign a prize that has already been
 * paid, with nothing in the record saying the winner changed. That guard is
 * the reason `status` exists.
 *
 * The score is SETTLED profit over the season window (rules amended
 * 2026-08-28, docs/seasons.md "The score"): what markets resolving inside
 * the window paid, minus the net cash paid on them, trades inside each
 * market's final 6 hours not counting. Nothing marked enters a final.
 * Computed fresh, never from a display cache, and every final is written
 * inside one transaction.
 */
seasonsRouter.post(
  '/:id/settle',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const seasonId = req.params.id as string;

    const [season] = await db.select().from(prizeSeasons).where(eq(prizeSeasons.id, seasonId)).limit(1);
    if (!season) throw new AppError('Season not found', 404);
    if (season.status !== 'running')
      throw new AppError(`Season is ${season.status}; only a running season can settle`, 409);
    const endsAt = new Date(season.endsAt);
    if (new Date() < endsAt) {
      throw new AppError(`Season runs until ${endsAt.toISOString()}; it can only settle after it ends`, 409);
    }

    // Settlement reads the same scoring set standings show: every workspace
    // public at this instant, not the set pinned at the start (owner decision
    // 2026-08-21, mirrored in seasonStandings). If the two used different sets,
    // the final would silently differ from the board people watched all season.
    const publicNow = await db
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.visibility, 'public'));
    clearBoardCache();
    const settledById = await loadSeasonSettled(
      publicNow.map(w => w.id),
      new Date(season.startsAt),
      endsAt,
    );

    const entries = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.optedIn, true)));

    const settledAt = new Date();
    const house = await platformOperatedIds(entries.map(e => e.agentId));
    const { ranked, rolloverUsd } = settleSeason(
      entries.map(e => ({
        agentId: e.agentId,
        // The window is the baseline under settled scoring; the snapshotted
        // baselineProfit belongs to the pre-amendment marked rule and is a record.
        baselineProfit: 0,
        currentProfit: settledById.get(e.agentId) ?? 0,
        enteredAt: e.enteredAt ? new Date(e.enteredAt) : new Date(0),
        platformOperated: house.has(e.agentId),
      })),
      (season.ladder ?? []) as LadderRung[],
      season.poolUsd,
      { payoutMode: (season.payoutMode ?? 'ladder') as SeasonPayoutMode, minPayoutUsd: season.minPayoutUsd ?? 0 },
    );

    await db.transaction(async tx => {
      for (const r of ranked) {
        await tx
          .update(seasonEntries)
          .set({
            finalProfit: settledById.get(r.agentId) ?? 0,
            finalScore: r.score,
            finalRank: r.rank,
            prizeUsd: r.prizeUsd,
            claimState: r.prizeUsd > 0 ? 'unclaimed' : null,
          })
          .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, r.agentId)));
      }
      await tx.update(prizeSeasons).set({ status: 'settled', settledAt }).where(eq(prizeSeasons.id, seasonId));
    });

    res.json({
      settled: true,
      settledAt,
      rolloverUsd,
      winners: ranked
        .filter(r => r.prizeUsd > 0)
        .map(r => ({ agentId: r.agentId, rank: r.rank, score: r.score, prizeUsd: r.prizeUsd })),
    });
  }),
);

/** Record that a claimed prize has actually been paid, outside the Service. */
seasonsRouter.post(
  '/:id/entries/:agentId/paid',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const seasonId = req.params.id as string;
    const agentId = req.params.agentId as string;

    const [entry] = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)))
      .limit(1);
    if (!entry) throw new AppError('Entry not found', 404);
    if (!entry.prizeUsd || entry.prizeUsd <= 0) throw new AppError('This entry was not awarded a prize', 409);
    if (entry.claimState !== 'claimed')
      throw new AppError(`Entry is ${entry.claimState ?? 'unsettled'}; only a claimed prize can be marked paid`, 409);

    await db
      .update(seasonEntries)
      .set({ claimState: 'paid', paidAt: new Date() })
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.agentId, agentId)));

    res.json({ paid: true, prizeUsd: entry.prizeUsd });
  }),
);

/** Who is owed what, with the payment details needed to pay them. Platform
 *  admin only, and the ONLY place in the season surface where payment details
 *  are ever returned. */
seasonsRouter.get(
  '/:id/payouts',
  wrap(async (req, res) => {
    await requirePlatform(req);
    const seasonId = req.params.id as string;

    const entries = await db
      .select()
      .from(seasonEntries)
      .where(and(eq(seasonEntries.seasonId, seasonId), eq(seasonEntries.optedIn, true)));
    const owed = entries.filter(e => (e.prizeUsd ?? 0) > 0);
    if (owed.length === 0) {
      res.json({ payouts: [] });
      return;
    }

    const agentRows = await db
      .select({
        id: agents.id,
        nickname: agents.nickname,
        payoutHandle: agents.payoutHandle,
        payoutMethod: agents.payoutMethod,
      })
      .from(agents)
      .where(
        inArray(
          agents.id,
          owed.map(e => e.agentId),
        ),
      );
    const byId = new Map(agentRows.map(a => [a.id, a]));

    res.json({
      payouts: owed
        .sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0))
        .map(e => ({
          agentId: e.agentId,
          nickname: byId.get(e.agentId)?.nickname ?? null,
          rank: e.finalRank,
          score: e.finalScore,
          prizeUsd: e.prizeUsd,
          claimState: e.claimState,
          claimedAt: e.claimedAt,
          paidAt: e.paidAt,
          payoutHandle: byId.get(e.agentId)?.payoutHandle ?? null,
          payoutMethod: byId.get(e.agentId)?.payoutMethod ?? null,
          // The whole operational point of collecting it: telling a winner they
          // have won, before their 30-day claim window runs out.
          contactEmail: e.contactEmail ?? null,
        })),
    });
  }),
);
