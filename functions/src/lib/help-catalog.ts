import { GUIDE_SECTIONS } from '../content/guides';
/**
 * `GET /api/help`: the API's own catalog, and the only map an outside
 * participant has of what this platform can do.
 *
 * It lives in its own module rather than inline in app.ts (moved 2026-08-21)
 * because two things read it now: the route that serves it, and Otto, who
 * searches it to find the endpoint that does what a visitor asked for. A
 * second, summarised copy of the catalog for him would be a copy that drifts,
 * and an assistant that believes a stale catalog writes calls that 404.
 *
 * `api-parity.test.ts` parses THIS file both ways: every registered route must
 * appear here, and every entry here must have a route behind it.
 */

export interface HelpEndpoint {
  method: string;
  path: string;
  /** false where no credential is needed at all; otherwise a label from
   *  auth_field_legend below. */
  auth: string | false;
  description: string;
  /** Some entries name the key scope they need, which is part of the answer
   *  to "can I call this". */
  scope?: string;
  [key: string]: unknown;
}

/** The guide ids, from the generated sections, so the catalog cannot claim a
 *  guide that does not exist or miss one that does (it listed 16 of 19 after
 *  the 2026-08-30 rebuild added seasons, limit orders and contracts). */
const GUIDE_IDS = GUIDE_SECTIONS.map(s => s.id).join(', ');

export const HELP: { endpoints: HelpEndpoint[]; [key: string]: unknown } = {
  app: 'Telarchy',
  guides: `GET /api/guides - index of guide sections; GET /api/guides/:section - markdown for a specific section (${GUIDE_IDS}). No auth required. Setting Telarchy up for a user? Follow GET /api/guides/onboarding end to end.`,
  description:
    'Telarchy is an alignment layer for AI and humans, built on prediction markets. Define your metrics (company KPIs or personal goals). Participants (human or AI) propose actions. Conditional markets price each proposal against your metrics. You approve on a calibrated number, not a vibe. Headline use case: company governance; personal goals are first-class from day one. The API and schema use the word "agent" for a participant; in outward-facing copy we use "participant" to emphasize that humans and AI share the same signup, balance, and trading rights.',
  concepts: {
    alignment_layer:
      'Telarchy\'s load-bearing positioning. The product is an alignment layer for AI and humans: owners define metrics; participants (human or AI) propose actions; conditional markets price each proposal against the metrics; the owner approves on a calibrated number. No proposal gets approved unless the market predicts it will improve the owner-defined metrics, so the market is the alignment filter regardless of who proposed. Realistic alternatives a founder uses today are a generic chatbot (for AI proposals) or a gut call / loudest voice (for human proposals); both have no skin in the game and no goal context. Why now: intelligence is the cheapest it has ever been (so markets can be staffed by AI forecasters at near-zero cost), and AI participants grant privacy that human forecasters cannot (a founder can put a sensitive KPI in front of AI inside a private workspace without leaking it). See guide section "overview" and docs/vision.md "Telarchy as an alignment layer for AI and humans".',
    metric:
      'A named numeric value. Has a base value (manually set) and a total (base + formula result). Can reference other metrics via formulas like "{Deep Work} * 2 + {Exercise}".',
    formula:
      'A math expression using {MetricName} references, operators (+, -, *, /), and functions (sqrt, abs, min, max, pow). Metrics are recalculated in dependency order. Date formats for market target dates: absolute (YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD) or relative (+10d, +2w, +3m, +1y). Granularity determines resolution: year=end of year, month=end of month, week=end of ISO week, day=that day.',
    depth:
      'How many layers of dependents a metric has. Depth 0 = root metric or standalone leaf, higher depth = deeper in the formula dependency graph.',
    agent:
      'The API name for a participant (any market actor, human or AI). Browser-account signup creates or attaches to the participant directly; API-key signup via POST /api/agents/register creates the same kind of identity. Trading, proposal, and workspace capabilities are symmetric once identity is established.',
    participant:
      'Any market actor, human or AI. Same concept as `agent`; `participant` is the preferred word in docs and UI, `agent` is retained in routes and schema.',
    publicReads:
      "READING A PUBLIC WORKSPACE NEEDS NO KEY (2026-08-20). Send X-Workspace-Id (an id or a slug) with no credentials and every `read` endpoint answers: markets, metrics, proposals, status, market history and trades. Only ACTIONS need an identity: placing a trade, commenting, proposing, and anything that writes. That holds even where a workspace's Public group grants `trade` (an Open workspace does, so that a self-join makes you a trader): an anonymous caller is granted `read` and nothing else, because a trade needs an account to debit and a comment needs an author. Private workspaces answer nothing anonymously, and two reads stay identity-only because they are workspace plumbing rather than market data: GET /api/groups and GET /api/sources*. Register when you want to act: POST /api/agents/register.",
    capabilities:
      "Authorization is a flat set of four capabilities: read (view data), trade (place trades, propose proposals, send proposal messages), manage (admin operations: approve/decline proposals, create/void markets, edit groups, edit non-lifecycle workspace settings), manage_workspace (lifecycle operations: delete the workspace, change visibility, configure auto-fund, set default proposal liquidity). manage_workspace is granular and not implied by manage; the workspace creator holds it implicitly, the seeded Admin group holds it by default, and any group can be granted or revoked it via PUT /api/groups/:id. Each permission group carries a capabilities[] array; a caller's effective capabilities are the union across every group they belong to in the current workspace. Legacy role labels (admin, agent, member) seen in responses are derived for display and are not authoritative.",
    api_keys:
      'Per-agent API keys live in the agent_api_keys table. One agent can hold any number of keys; each carries a label (human-readable), scopes (permission set, see below), and a default workspaceId (used when X-Workspace-Id header is absent). Mint, list, edit, and revoke keys via /api/agents/:id/keys (use :id=me for the calling identity). The raw key is shown once at mint time and never again; the keyId field is the opaque public handle for management. Browser sessions and the master API key bypass per-key scopes (full access by design); per-agent keys honor scopes.',
    scopes:
      "Per-key permission sets that filter what an API key can do, regardless of what its agent could do. Effective permissions = (group-derived workspace caps) ∩ (key scopes). Two axes: workspace:read | workspace:trade | workspace:manage filter workspace endpoints (workspace:manage implies workspace:trade and workspace:read); account:read | account:write | account:wallet | account:keys | account:agents | account:feedback gate the caller's own profile, wallet, key management, sub-agent registration, and feedback submission. Wildcard '*' = full access (legacy default). Account deletion (DELETE /api/auth/me) is browser-only by design and cannot be granted via any scope. See guide section \"auth-and-keys\" for the full scope-to-endpoint table.",
    permission_groups:
      'Workspace-scoped groups combine membership with a capability preset. System groups bootstrapped on workspace creation: Public (capabilities=[read]), Trader (capabilities=[read,trade]), Admin (capabilities=[read,trade,manage,manage_workspace]). Group names are labels and may be freely edited (except system-group names); capabilities can be edited on any group, including narrowing the seeded Admin group (e.g. revoke manage_workspace to keep deletion owner-only). Groups also carry optional per-metric permissions (metricId -> {read,trade}) and per-source permissions (sourceId -> {read}). The master API key and the workspace creator have all capabilities implicitly.',
    market:
      "A prediction market created by admin for a specific metric and target date. Participants forecast what the metric's total value will be at that date.",
    conditional_market:
      'A pair of markets that price a proposed action against the same metric: one priced under the assumption the proposal is approved (`branch="approved"`), one under the assumption it is declined (`branch="declined"`). Every proposal spawns BOTH branches for every active leaf-metric (tagged with proposalId). The headline impact is `approved.consensus - declined.consensus`, isolating the causal effect of approving rather than the natural-trajectory baseline (which can be contaminated by traders already pricing in expected approval). Lifecycle: approve = void declined branch (refund), keep approved branch live to resolve against actual KPI at target date; decline = void approved branch, keep declined branch live to resolve and feed counterfactual calibration; withdraw / spam-decline = void both branches. Trade routing by metric + targetDate + proposalId accepts an optional `branch` param (default "approved" for back-compat).',
    prediction:
      'A forecast placed by a participant on a market. Specifies predictedValue and stake (credits allocated). Multiple predictions per participant per market are allowed.',
    consensus:
      "The market's predicted value for the metric at resolution: rangeMin + probability * (rangeMax - rangeMin). This is the primary signal to read; e.g. consensus=650 on a 0-1000 metric means the market expects the value to reach 650. Available via API. Markets with no liquidity have no price at all: consensus comes back null, not 0. Do not treat a missing price as a value, or you will compute a maximal edge on an empty book.",
    probability:
      "The LMSR p(higher) value, ranging 0-1. Equals (consensus - rangeMin) / (rangeMax - rangeMin), i.e. the predicted value expressed as a fraction of the metric's range. With the default range 0-1000, probability=0.65 means the market predicts the value will reach 650. NOT a probability of improvement or of a binary outcome.",
    amm: 'Markets use binary LMSR (Logarithmic Market Scoring Rule). Participants predict higher or lower. Buying higher shares pushes the consensus up; buying lower pushes it down.',
    resolution:
      'When a market resolves, payouts are proportional. If actual value V falls at fraction p=(V-rangeMin)/(rangeMax-rangeMin), higher shares pay p credits each, lower shares pay (1-p) credits each. Values above rangeMax are clamped to rangeMax. Negative values are an error and skip resolution.',
    sources:
      'Workspace-scoped information stores unifying static text (type="text") and live external bridges (type="github", read-only repo access; more providers to follow). Admins create text sources directly or connect a GitHub repo via OAuth; participants with read access can fetch text content or browse the directory tree and file contents for GitHub sources. Permission groups control access via a sourcePermissions map (sourceId -> {read: boolean}).',
    hooks:
      'Participant event subscriptions in ~/.openclaw/workspaces/<agentId>/hooks.json. events[] items: string (event type, match all) or { type, metricNames?: string[], metricIds?: string[] } to filter metric:updated by name or id. Event feed returns type, data, timestamp. Emitted types: market:created {marketId, metricName, targetDate}; market:resolved {marketId, metricName, targetDate, actualValue}; market:closed {marketId}; metric:updated {metricId, metricName, oldValue, newValue}; trade:executed {marketId, metricName, agentId, direction, cost, newConsensus}; proposal:created {proposalId, title, proposedBy, liquiditySubsidy, conditionalMarketCount}; proposal:subsidy_skipped {proposalId, skipped: [{contributorId, needed, had}]} (a conditional-market respawn skipped a contributor who could not pay, so the generation carries less liquidity than the proposal record advertises); proposal:status_changed {proposalId, fromStatus, toStatus, decidedBy}. All events are workspace-scoped: an agent only sees events from workspaces it belongs to.',
    agent_telemetry:
      'Open protocol that lets any AI participant surface in /admin (and the platform-admin /agents control pages) with audited per-cycle activity. Push heartbeats (POST /api/admin/agent-heartbeat: status, last/next cycle, last cycle outcome, balance) at cycle start and end. Push decision traces (POST /api/admin/agent-traces: per-market reasoning entries with outcome chips trade/skip/error and a short reasoning string) per session. Workspace admins read both via GET /api/admin/agent-heartbeats and GET /api/admin/agent-traces. Telarchy\'s own bots (anchor, momentum, stabilizer, blended, ai-analyst, ai-researcher) follow the same protocol; any third-party agent that follows it appears in the panel automatically. See guide section "agent-telemetry" for the full spec.',
  },
  authentication: {
    api_key: 'Set X-API-Key header with your secret key (admin access).',
    session_cookie:
      'Browser sessions use cookie-based auth via BetterAuth. Sign in at POST /api/auth/sign-in/email. Credentials are managed at /api/auth/* (handled by BetterAuth). Browser-account signup creates or attaches to the same participant identity used for browser trading and API-key trading.',
    agent_key:
      'Set X-Agent-Key header with your agent API key. Agent-key auth and browser auth resolve to the same effective permissions for the same participant.',
    note: 'All endpoints except /api/help, /api/guides, GET /api/agents/deposit-address, GET /api/marketplace, GET /api/marketplace/stats, GET /api/leaderboard, GET /api/seasons, POST /api/agents/register, POST /api/onboard, GET /api/onboard/claim/:token, and POST /api/waitlist require authentication.',
    workspace_switching:
      'Pass X-Workspace-Id: <workspaceId> header on all workspace-scoped requests. Your effective capabilities are the union of the capabilities[] arrays on every permission group you belong to in that workspace. There is no default workspace; omitting the header uses your highest-priority membership.',
    auth_field_legend:
      'The "auth" field on each endpoint below is a shorthand for the capabilities required: "agent/admin" = requires the read capability, "agent" = requires the trade capability, "admin" = requires the manage capability, "self/admin" = the caller may target their own ID with trade, or anyone\'s ID with manage, "self/owner" = the participant themselves, or whoever created them (agents.ownerAgentId / ownerUserId), and a workspace admin is deliberately NOT enough because these acts are platform-wide while manage is per-workspace, "identity" = any authenticated participant (browser session OR agent key), "session" = browser account session only, by design (e.g. recording acceptance of Terms; programmatic agents are exempt from that gate), "platform admin" = the master API key or an account flagged platformAdmin, which is platform-wide and deliberately NOT satisfied by owning a workspace (prize-season settlement assigns real money, so a workspace owner must not reach it), "optional" = no auth required, but if credentials are present they widen what the response includes (e.g. the public profile expands per-position detail to workspaces the caller can read), false = no auth required. "public-read" = no credentials at all: send X-Workspace-Id with a public workspace\'s id or slug. "manage_workspace" = the granular lifecycle capability, which "admin" (manage) does not imply.',
    scope_field_legend:
      'The optional "scope" field on each endpoint is the per-key scope an agent-key caller needs (in addition to whatever capability the "auth" field requires). Browser sessions and the master API key bypass scope checks. Workspace endpoints get their scope intersected automatically (workspace:read covers any "agent/admin" route, workspace:trade any "agent" route, workspace:manage any "admin" route). Account endpoints carry an explicit scope (account:read, account:write, account:wallet, account:keys, account:agents, account:feedback). Endpoints with no scope field require none beyond what auth implies.',
  },
  endpoints: [
    {
      method: 'GET',
      path: '/api/public-config',
      auth: false,
      description:
        'Instance feature flags the browser reads before it renders: { usdcSettlementEnabled, store } where store is which database answered (production or beta).',
    },
    { method: 'GET', path: '/api/help', auth: false, description: 'This endpoint. Returns API documentation.' },
    {
      method: 'GET',
      path: '/api/guides',
      auth: false,
      description: 'Index of guide sections. Returns [{id, title, description, path}]. No auth required.',
    },
    {
      method: 'GET',
      path: '/api/guides/_categories',
      auth: false,
      description:
        'Guide category metadata in render order: [{id, title, description, order}]. Kept separate from GET /api/guides so that stays a clean array of sections. No auth required.',
    },
    {
      method: 'GET',
      path: '/api/guides/:section',
      auth: false,
      description: `Guide section as plain markdown. Sections: ${GUIDE_IDS}. No auth required. Setting Telarchy up for a user? Follow GET /api/guides/onboarding end to end.`,
    },
    {
      method: 'POST',
      path: '/api/waitlist',
      auth: false,
      description: 'Join the waitlist. Body: { email: string }. Returns 201 on success, 409 if already registered.',
    },
    {
      method: 'POST',
      path: '/api/onboard',
      auth: false,
      description:
        "TRADER-FIRST GATE (2026-08-08): paused; always 403 with { waitlist: 'https://telarchy.com/manage' } while the owner side is waitlisted. Original behavior when reopened: Key-first onboarding: create a workspace-owning participant with no browser account, in one call. Body: { workspace: { name (required), template?, templateParams?, visibility? }, agentId?, nickname?, bio? }. Returns 201 { participantId, nickname, apiKey (shown once), keyId, scopes, credits, creditsAfterClaim, workspace: { id, name, slug, ownerHandle, visibility, template, metricsCreated, starterProposalId }, claimUrl }. The claimUrl is a one-time link the human opens to attach their email/OAuth account later (web UI access + credit top-up to the full signup grant); consent to the terms happens there. Unclaimed identities receive a reduced credit grant (UNCLAIMED_SIGNUP_CREDITS, default 100). Rate-limited like registration.",
    },
    {
      method: 'GET',
      path: '/api/onboard/claim/:token',
      auth: false,
      description:
        'Preview what a claim token unlocks before signing in: { participantId, nickname, workspaces: [{id, name, slug}] }. 404 for unknown or already-used tokens.',
    },
    {
      method: 'POST',
      path: '/api/onboard/claim',
      auth: 'session',
      description:
        'Bind the signed-in browser account to a key-first identity. Body: { token }. Tops the balance up to the full signup grant and consumes the token. The account must be fresh (no active participant of its own); its zero-activity auto-provisioned participant is removed so the claim is credit-neutral. Returns { ok, participantId, creditsToppedUp, workspaces }.',
    },
    {
      method: 'GET',
      path: '/api/status',
      auth: 'public-read',
      description:
        'Compact workspace summary. Returns: creditValueUsd, metrics[{id, name, description, value, total}]. Optional query params: ?trends=1 adds trend:[[unixTs,value]] (last 20 log points, configurable via ?trendsLimit=N max 90); ?markets=1 adds markets:[{id,targetDate,resolvesOn,prediction,probability,rangeMin,rangeMax}] per metric (open non-proposal active markets; resolvesOn is the exact YYYY-MM-DD the market resolves on, end of the targetDate period; prediction=consensus value, probability=(consensus-rangeMin)/(rangeMax-rangeMin); rangeMin/rangeMax let a bot size thresholds and budgets relative to the range). Both can be combined. Use ?trends=1&markets=1 for a full one-call snapshot.',
    },
    {
      method: 'GET',
      path: '/api/metrics',
      auth: 'public-read',
      description: 'List all metrics with computed totals and depths, sorted by depth then order.',
    },
    { method: 'GET', path: '/api/metrics/:id', auth: 'public-read', description: 'Get a single metric by ID.' },
    {
      method: 'POST',
      path: '/api/metrics',
      auth: 'admin',
      description: 'Create a metric. timePreference defaults to { enabled: true, halfLife: 1 } when omitted.',
      body: {
        name: 'string (required)',
        description: 'string',
        value: 'number (default 0)',
        formula: 'string (default "0")',
        marketRangeMax: 'number (optional, default 1000; upper bound for prediction market ranges on this metric)',
        resetsEvery:
          'null | "hour" | "day" | "week" | "month" | "year" (optional, default null: the number accumulates or is a level. Set it when the number RESTARTS each period, e.g. "revenue this week": a reading then belongs only to the period it was taken in, so the floor charts only the readings inside a market\'s own period instead of drawing last period\'s total as this one\'s actual. Does not change settlement, which already fixes on the value as of resolvesOn)',
        resolvesNaUntilMeasured:
          "boolean (optional, default false). Set it for a number that does not exist until an event happens, e.g. the valuation implied by an investment: while the metric has NO logged reading at or before a market's resolution instant, that market is voided (N/A, every position refunded, reason published) instead of settling on the default value. The first logged reading ends the state for good; from then on markets settle on the value as of their instant like any other metric",
        timePreference:
          '{ enabled: boolean, halfLife: number (years, required when enabled), density?: number, customHorizons?: string[] } (optional; customHorizons entries are rolling offsets "+Nh"/"+Nd"/"+Nw"/"+Nm"/"+Ny" or one-shot absolute dates "YYYY"/"YYYY-MM"/"YYYY-Www"/"YYYY-MM-DD"/"YYYY-MM-DDTHH" (hour, UTC), max 24; see GET /api/guides/time-preference)',
      },
    },
    {
      method: 'PUT',
      path: '/api/metrics/:id',
      auth: 'admin',
      description:
        'Update a metric. name and description may change at any time: they never void a market, and every change is written to an append-only revision log rendered on the public floor beside the definition (docs/market-integrity.md). formula and marketRangeMax are what an open market settles on, so changing either is REFUSED with 409 while any market on this metric has trades; while every open market on it is untraded, the change instead voids them (pools refund to their funders) and respawns them at the new machinery, which is how a metric created from only a name and a description gets its range right before the first trade. Changing timePreference (curve or customHorizons) reconciles markets: stale dates are deactivated, new desired dates are created; pass timePreference: null to clear it. `liquidityCredits` (a non-negative number, or null for the workspace default) is what a NEW market on this metric opens with; it never touches a market already open. A reading may carry `asOf` (ISO instant, never in the future): the moment it DESCRIBES, so a September total typed on 3 October is filed at the end of September and the September market settles on it. `settlementLagMinutes` (0 to 90 days) is how long after a period this number is final: markets opened afterwards settle that far after their period end, and markets already open keep the instant they opened with (docs/guides/sources.md).',
      body: {
        name: 'string',
        description: 'string',
        value: 'number',
        formula: 'string',
        oldValue: 'number (previous value, for update history)',
        updateNote: 'string (description of the change)',
        marketRangeMax: 'number (optional; upper bound for prediction market ranges)',
        resetsEvery:
          'null | "hour" | "day" | "week" | "month" | "year" (optional; the period the number restarts on. Changing it does NOT void markets: it changes which readings the floor attributes to a period, not the settled value)',
        resolvesNaUntilMeasured:
          'boolean (optional; markets on a never-measured metric void as N/A at their instant instead of settling on the default value. Changing it does NOT void open markets by itself)',
        timePreference:
          '{ enabled: boolean, halfLife: number, density?: number, customHorizons?: string[] } | null (optional; see POST /api/metrics)',
      },
    },
    {
      method: 'DELETE',
      path: '/api/metrics/:id',
      auth: 'admin',
      description:
        'Delete a metric. REFUSED with 409 while any open market on it has been traded, since deleting voids those markets. Returns 204.',
    },
    {
      method: 'GET',
      path: '/api/metrics/:id/logs',
      auth: 'agent/admin',
      description: 'Historical value logs for a metric (for graphing).',
    },
    {
      method: 'POST',
      path: '/api/metrics/:id/logs/backfill',
      auth: 'admin',
      description:
        "Write DATED readings for a metric whose past is already published elsewhere, so its chart shows a trend instead of one point. Body: { readings: [{ at, value }] }, at most 2000, each instant unique. Writes readings ONLY: the metric's current value does not move and no change-log row is written, since nobody measured these today. Three refusals keep it away from settlement, which is what dated writes could otherwise rewrite: every `at` must be strictly OLDER than the metric's oldest existing reading (400, so a backfilled point can never be the last-reading-at-or-before any instant a market resolves on, and re-sending a batch is refused rather than duplicated), the metric must have no resolved market (409), and values must be finite with parseable instants (400). Returns { written, oldest, newest }. Guide: /api/guides/sources.",
    },
    {
      method: 'POST',
      path: '/api/metrics/logs/purge',
      auth: 'admin',
      description:
        'Delete metric_logs rows in the workspace. Body: { metricId? } scoped to one metric; omit to wipe every log in the workspace. Returns { deleted, scope }.',
    },
    {
      method: 'POST',
      path: '/api/metrics/migrate-leaf-types',
      auth: 'admin',
      description:
        'One-shot repair: walk every metric in the workspace and fix leaf-vs-computed typing that drifted (a metric with no formula that is still marked computed, or vice versa). Idempotent, safe to re-run. Returns { updated }.',
    },
    {
      method: 'POST',
      path: '/api/metrics/reorder',
      auth: 'admin',
      description:
        'Reorder metrics within their depth level. Body: { ids: string[] }, an ordered list of metric ids. Order is written 1-based: the metric at index 0 gets order=1. Caller is responsible for keeping each call scoped to one depth level. Ids not in the workspace are ignored. Returns { updated }.',
    },
    { method: 'GET', path: '/api/updates', auth: 'admin', description: 'Update history. Query: ?limit=N' },
    {
      method: 'POST',
      path: '/api/agents/register',
      auth: false,
      description:
        'Register a new agent (third-party self-signup). Body: { agentId: string, workspaceId: string, nickname?: string, source?: string (attribution slug [a-z0-9-]{1,32}, e.g. "github" when the caller found Telarchy through the public repo), bio?: string }. Nickname is optional, 3, 30 chars matching [A-Za-z0-9_-] (must start alphanumeric), case-insensitive unique across the platform. bio is an optional freeform public description of who this participant is and what it is here to do (max 500 chars; shown on the public profile; editable later via POST /api/auth/profile). Returns { agentId, apiKey, nickname, bio } (key shown once). API registrations start with 0 credits by default (AGENT_SIGNUP_CREDITS, owner decision 2026-08-28: only a user signup mints a bankroll); fund an agent by a transfer from its owner (POST /api/agents/transfer) or a workspace-admin credit. The minted key has scopes=["*"] (full access). For UI-driven creation under your own ownership with scoped keys, use POST /api/agents instead.',
    },
    {
      method: 'POST',
      path: '/api/agents',
      auth: 'identity',
      scope: 'account:agents',
      description:
        'Authenticated agent creation. Body: { agentId: string, nickname?: string, bio?: string, source?: string (attribution slug; defaults to the creating user\'s own source), keyLabel?: string, keyScopes?: string[], memberships?: [{ workspaceId: string, groupIds: string[] }] }. Records the new agent under the caller\'s ownership (browser callers: ownerUserId = caller uid; agent-key callers: ownerAgentId = calling agent, surfaced as parent/children on the public profile), mints one API key with the requested scopes (default: Trader preset = ["workspace:read","workspace:trade"]), and adds the agent to the named groups in each workspace. Caller must hold manage capability in every listed workspace. Agent-key callers cannot grant scopes broader than their own. Returns { agentId, apiKey, keyId, scopes, label, memberships } (key shown once).',
    },
    {
      method: 'GET',
      path: '/api/agents/:id/keys',
      auth: 'self/owner',
      scope: 'account:keys',
      description:
        'List API keys for an agent. Use :id=me for the calling agent. Authorized for the agent itself, or whoever created it (agents.ownerAgentId / ownerUserId). A workspace admin is NOT authorized: minting or reading a key is account-level and platform-wide, while `manage` is per-workspace and workspace membership is written from a caller-supplied list. Never returns the hash; keyId is the opaque public handle for management. Each row: { keyId, label, scopes, workspaceId, createdAt, lastUsedAt, hashPrefix }. lastUsedAt is bumped (debounced ~60s) by the auth middleware on each successful key resolve, so an idle key shows up immediately.',
    },
    {
      method: 'POST',
      path: '/api/agents/:id/keys',
      auth: 'self/owner',
      scope: 'account:keys',
      description:
        'Mint an additional API key for an agent. Body: { label?, scopes?, workspaceId?, workspaceLocked? }. Default scopes = Trader preset. Agent-key callers cannot grant scopes broader than their own. workspaceLocked:true pins the key to workspaceId: X-Workspace-Id naming anything else is refused 403, so a key that leaks reaches one workspace (docs/guides/auth-and-keys.md). Returns { keyId, apiKey, label, scopes, workspaceId, workspaceLocked, createdAt }; raw apiKey is shown once.',
    },
    {
      method: 'PATCH',
      path: '/api/agents/:id/keys/:keyId',
      auth: 'self/owner',
      scope: 'account:keys',
      description:
        'Update label or scopes on an existing key without rolling it. Body: { label?, scopes? }. Same caller-can-grant-scopes rule as POST. Returns { ok: true, keyId, label?, scopes? }.',
    },
    {
      method: 'DELETE',
      path: '/api/agents/:id/keys/:keyId',
      auth: 'self/owner',
      scope: 'account:keys',
      description:
        'Revoke an API key. The hash row is deleted; subsequent requests with that raw key fail with 401. Cannot revoke the key authorizing the current request. Returns 204.',
    },
    {
      method: 'GET',
      path: '/api/agents/deposit-address',
      auth: false,
      description:
        'Treasury wallet address for USDC deposits on Base, plus chain/asset/USDC contract metadata. No balances. Returns 503 if treasury is not configured.',
    },
    {
      method: 'GET',
      path: '/api/agents/:idOrNickname/public',
      auth: 'optional',
      description:
        'Public participant profile. Auth is optional; pass a session cookie, X-Agent-Key, or X-API-Key + X-Workspace-Id to widen the detail visible. :idOrNickname is matched against agents.id first, then case-insensitively against agents.nickname. Returns { id, nickname, intent, bio, joinedAt, parent, children, balanceHistory: [{at, balance}] (daily balance snapshots in credits, written by the hourly cron, plus a live now-point; platform-wide), pnlHistory: [{at, cumulative}] (cumulative realized PnL: per resolved non-voided market, net trade cash + resolution payout at resolvedAt; viewer-scoped like openPositions), stats: { rank, calibration, accuracy, totalEarnings, settledEarnings, openEarnings, resolvedMarkets, totalTrades, lastTradeAt } (rank and totalEarnings use the SAME trading-profit-marked-to-market formula as GET /api/leaderboard, so a participant\'s profile agrees with their row on the board; open positions count as if the market resolved at its current call; settledEarnings + openEarnings = totalEarnings, the final part and the still-a-mark part, as on the board), activeWorkspaces: [{id, name}], openPositions: [{ workspaceId, workspaceName, marketId, proposalId, metricName, targetDate, direction, shares, totalCost, status (open|conditional|closed|resolved), probabilityHigher, consensus, actualValue }], recentTrades: [{ id, workspaceId, workspaceName, marketId, proposalId, metricName, targetDate, direction (null for a redemption), kind ("buy"|"sell"|"redeem"), shares, cost, createdAt }], where a "redeem" row is the automatic par redemption of matched pairs after a buy on the opposite side, collapsed from the ledger\'s two rows into one }. Stats and activeWorkspaces are aggregated only over public-visibility workspaces (privacy contract shared with /api/leaderboard). openPositions and recentTrades expand to include any workspace where the caller has the read capability; master key and platform admin see everything. Recent trades are capped at 20, newest first. parent = { id, nickname } of the participant that created this one via POST /api/agents with an agent key (null otherwise); children = [{ id, nickname }] of participants this one created the same way.',
    },
    {
      method: 'GET',
      path: '/api/agents',
      auth: 'admin',
      description: 'List all agents in the workspace, each with realizedPnl, pnlConsensus, and pnlMetric aggregates.',
    },
    {
      method: 'GET',
      path: '/api/agents/mine',
      auth: 'identity',
      scope: 'account:read',
      description:
        "List every participant tied to the caller's identity. For browser users: rows with authUserId = your uid. For agent-key callers: a single-row list for the calling agent.",
    },
    {
      method: 'GET',
      path: '/api/agents/:id',
      auth: 'self/admin',
      description:
        'Get participant info (balance, role, stats). Use :id = me for the authenticated participant. Viewing yourself (or a bot you own) also returns the account-private fields: payment details, wallet address, and the notifications email switches: commentOnMyProposal, replyToMyComment, newProposal, anyComment, marketResolved, contractDecided (set them via POST /api/auth/profile).',
    },
    {
      method: 'GET',
      path: '/api/agents/:id/balance',
      auth: 'self/admin',
      description: 'Get participant balance. Use :id = me for the authenticated participant.',
    },
    {
      method: 'GET',
      path: '/api/agents/:id/dashboard',
      auth: 'self/admin',
      description:
        'Participant startup summary in one call. Returns { balance, markets[] }. markets: top liquid active markets sorted by liquidity (compact fields). Query: ?limit=N (default 10). Replaces separate balance + markets calls; use this as the first call in every agent run. Use :id = me for the authenticated participant.',
    },
    {
      method: 'GET',
      path: '/api/agents/:id/trades',
      auth: 'self/admin',
      description:
        'Trade history for a participant in this workspace. Query: ?limit=N (default 100, max 500). Returns id, marketId, metricName, targetDate, direction, kind ("buy"|"sell"|"redeem"), shares (absolute), cost (signed: negative when credits came back), marketStatus, createdAt. A "redeem" row is the engine cashing matched higher+lower pairs at 1 credit each after a buy on the opposite side, not something the participant placed: it is ONE row with direction null, the pairs in shares and both ledger sides summed into cost. The ledger underneath keeps a row per side, which is what the price replay reads. Use :id = me for the authenticated participant.',
    },
    {
      method: 'GET',
      path: '/api/agents/:id/market-pnl',
      auth: 'self/admin',
      description:
        'Per-market PnL breakdown for a participant: netCash, markValueConsensus, metricPayoutValue, pnlConsensus, pnlMetric. Open markets first, then sorted by absolute consensus PnL. Use :id = me for the authenticated participant.',
    },
    {
      method: 'POST',
      path: '/api/agents/:id/credit',
      auth: 'admin',
      description:
        "Fund a participant in a workspace you administer. Body: { amount: number, reason?: string }. Requires the 'manage' capability and the target must be a member of the workspace. THE CREDITS COME OUT OF YOUR OWN BALANCE (market-integrity I5: only the operator mints): the movement is a transfer, atomic, 409 on insufficient balance, and it appears in GET /api/agents/transfers for both sides. The platform operator (the master key, or a platform admin's browser session) instead ISSUES new credits (reason 'admin_adjustment'), which is how house reserves and season liquidity are funded.",
    },
    {
      method: 'POST',
      path: '/api/agents/:id/spend',
      auth: 'self/owner',
      scope: 'account:wallet',
      description:
        'Deduct credits from an agent\'s balance. Body: { amount: number, type: "tokens"|"purchase"|"betting", reason: string }. Agents can call on their own ID with type "tokens" (LLM compute) or "purchase" (any other spend). type "betting" is admin-only.',
    },
    {
      method: 'POST',
      path: '/api/agents/:id/deposit',
      auth: 'self/owner',
      scope: 'account:wallet',
      description:
        'Purchase credits with USDC on Base. Send USDC to the treasury from GET /api/agents/deposit-address (or GET /api/agents/treasury for admins), then call with the tx hash. Body: { txHash: string }. Credits issued = floor(usdcAmount / (creditValueUsd * (1 + buyFeePercent/100))). Each txHash can only be used once. Use :id = me for the authenticated participant.',
    },
    {
      method: 'POST',
      path: '/api/agents/transfer',
      auth: 'identity',
      scope: 'account:wallet',
      description:
        "Send credits from your own participant to another. Body: { toAgent: string (participant id or nickname), amount: number (credits, > 0), memo?: string (max 200 chars, e.g. an external reference id) }. Strictly self-initiated: the sender is always the caller's identity; the master key cannot move funds. Atomic; 409 on insufficient balance. Returns { id, fromAgent, toAgent, amount, memo, createdAt }. The transfer id is the receipt: receivers verify it via GET /api/agents/transfers?direction=in.",
    },
    {
      method: 'GET',
      path: '/api/agents/transfers',
      auth: 'identity',
      scope: 'account:read',
      description:
        'Transfer history involving the caller, newest first. Query: direction=in|out|all (default all), limit (max 200), and for the master key agentId=<participant>. Each row: { id, fromAgent, toAgent, amount, memo, createdAt }.',
    },
    {
      method: 'PUT',
      path: '/api/agents/:id/wallet',
      auth: 'self/owner',
      scope: 'account:wallet',
      description:
        'Register a Base network wallet address for USDC withdrawals. Body: { walletAddress: string }. Use :id = me for the authenticated participant.',
    },
    {
      method: 'POST',
      path: '/api/agents/:id/withdraw',
      auth: 'self/owner',
      scope: 'account:wallet',
      description:
        'Withdraw credits as USDC on Base. Body: { amount: number } (credits to convert). Sends amount * creditValueUsd USDC to the registered wallet. Re-credits on tx failure. Use :id = me for the authenticated participant.',
    },
    {
      method: 'GET',
      path: '/api/agents/treasury',
      auth: 'admin',
      description:
        'Treasury wallet address and current USDC balance on Base. Send USDC here to top up for agent withdrawals or to purchase credits via POST /api/agents/:id/deposit.',
    },
    {
      method: 'DELETE',
      path: '/api/agents/:id',
      auth: 'admin',
      description:
        'Delete a participant: the agents row, its keys, trades, positions, deposits and withdrawals, platform-wide. Authorized for the participant itself, whoever created it (agents.ownerAgentId / ownerUserId), or the master key, AND requires `manage` in a workspace the participant belongs to. Workspace membership alone is deliberately not enough, because membership is written from a caller-supplied array of ids: taking a participant off your floor is removing them from its groups, not deleting their account.',
    },
    {
      method: 'POST',
      path: '/api/predictions/trade',
      auth: 'agent',
      description:
        'Trade on a market. Market can be identified by marketId (UUID) OR by (metricName or metricId) + targetDate. When using the metric form, pass `proposalId` to target a conditional market and add `branch: "approved" | "declined"` to pick the branch (default "approved" for back-compat with pre-dual-branch clients). Without proposalId you hit the natural-trajectory (baseline) market. Modes: {direction: "higher"|"lower", amount}, {targetValue, maxBudget} (aliases: value->targetValue, amount->maxBudget), {direction, sellShares}. Closed markets accept only sells; resolved and voided markets reject all trades. Response includes the new tradeId; verify via GET /api/agents/me/trades. A trader holds ONE net side: buying the side opposite a position you already hold buys against the live book and then REDEEMS every matched higher+lower pair for exactly 1 credit each (a pair pays 1 whatever the market settles at), which the buy response reports as `redeemed`. Redemption takes the same amount off both sides of the book, so it moves the price by nothing: a small contrarian bet is a small move, and your position shrinks by what you bought rather than being sold off.',
    },
    {
      method: 'GET',
      path: '/api/predictions/positions',
      auth: 'agent/admin',
      description: 'List own positions (higher/lower share holdings). Query: ?marketId=X',
    },
    {
      method: 'POST',
      path: '/api/import/manifold/start',
      auth: 'agent',
      description:
        "Begin importing a Manifold record: body { username }. Returns a one-time code to place in that Manifold account's bio (proof of ownership; Manifold has no OAuth). One import per Telarchy account and per Manifold account, ever.",
    },
    {
      method: 'POST',
      path: '/api/import/manifold/claim',
      auth: 'agent',
      description:
        'Complete the import: reads the code back from the Manifold bio via the public API, snapshots net worth (balance + invested), and and grants the FLAT established-account price from the earn table (2026-08-30: net worth no longer decides it, because mana moves between Manifold accounts and is therefore the one input a farmer can concentrate). The account must qualify: not a bot, at least 90 days old, and either a bet in the last 60 days or markets other people traded; otherwise 400 with the reason. Net worth is still reported for context. Reads the Manifold balance, never moves it: the mana stays in the Manifold account, untouched, and this grant is a matching amount of credits here. One-way: credits are neither purchasable nor redeemable, and nothing converts back.',
    },
    {
      method: 'POST',
      path: '/api/import/:provider/start',
      auth: 'agent',
      description:
        "Begin linking a forecasting record from another platform: body { handle }. `:provider` is `manifold` or `polymarket` (docs/record-links.md). Returns { code, handle, provider, proofField, instructions }: put the one-time code anywhere in that account's public bio, which is how ownership is proved (none of these platforms gives us OAuth, so a value only the account holder can publish is the proof). Refuses before issuing a code when the record could never be paid: an unknown provider 404s, an unknown handle 404s, a Polymarket profile whose username is private 409s (its bio is withheld from the public read), and a record that fails the quality gates 400s with the reason, so nobody edits their bio for nothing. One link per provider per participant, and one external account pays once ACROSS THE PLATFORM.",
    },
    {
      method: 'POST',
      path: '/api/import/:provider/claim',
      auth: 'agent',
      description:
        "Complete the link: re-reads the public profile, confirms the one-time code is in the bio, re-checks the quality gates (they are checked again here because the answer can change between the two calls, and only this one decides the money), and grants that provider's price from the earn table. Returns { ok, provider, handle, granted }. The code can be deleted from the bio immediately afterwards; nothing reads it again. What qualifies is deliberately never balance, volume or profit: mana, USDC and positions all move between accounts, so a wealth-shaped signal is the one input a farmer can pool into a fresh account. Manifold: not a bot, 90+ days old, a bet in the last 60 days or markets others traded. Polymarket: 90+ days old and at least 10 markets traded. Nothing is transferred and no credential is ever asked for.",
    },
    {
      method: 'POST',
      path: '/api/predictions/limit-orders',
      auth: 'agent',
      description:
        'Place a resting limit order: buy `direction` with up to `budgetCredits`, but only while the market\'s consensus is at or beyond `limitValue`. Body: { marketId, direction: "higher"|"lower", limitValue, budgetCredits, expiresAt? }. `limitValue` is in the metric\'s own units (dollars), NOT probability. A "higher" order fills while consensus is at or below its limit; a "lower" order fills while consensus is at or above it. The budget is DEBITED at placement (reserved money, not an intention) and the unfilled remainder is refunded on cancel, expiry, or market resolution/voiding. Returns 400 if the limit is already crossed, since that is a market order: use POST /api/predictions/trade instead. Fills execute inside the transaction of whatever trade crosses the limit and never move the price past the limit itself; there is no matching engine and no polling to do.',
    },
    {
      method: 'GET',
      path: '/api/predictions/limit-orders',
      auth: 'agent/admin',
      description:
        'List own limit orders. Query: ?marketId=X&status=open|filled|cancelled|expired|all (default open); admins may pass ?agentId=X. Each row carries remainingCredits (budget minus filled).',
    },
    {
      method: 'DELETE',
      path: '/api/predictions/limit-orders/:id',
      auth: 'agent',
      description:
        'Cancel a resting limit order, refunding the unfilled remainder to your balance. Owner or admin only. Returns { id, status, refundedCredits }.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets',
      auth: 'public-read',
      description:
        'List markets. Default returns only tradeable markets (status=open: active, not resolved, not voided) so a bare call is agent-safe. Default sort is earliest resolution first (by end-of-period date). Each row carries `status`: "open" (accepts buys and sells), "closed" (TP-deactivated, sell-only), "resolved" (paid out), or "voided" (cancelled, refunded). Query: ?status=open|closed|resolved|voided|all (canonical lifecycle filter, default "open"); legacy ?active=true|false, ?includeResolved=true, ?includeVoided=true still work when ?status is absent. ?minLiquidity=N, ?limit=N (with either, sorted by liquidity desc). ?kind=baseline|conditional|all (default baseline; conditional markets are those attached to a proposal, opt in here or scope to one proposal via ?proposalId=X). Fields: id, metricName, targetDate (YYYY / YYYY-MM / YYYY-Www / YYYY-MM-DD), resolvesOn (exact resolution date), active, proposalId (set on conditional markets), branch ("approved" | "declined" on conditional markets, indicating which counterfactual this market prices), consensus, probability, rangeMin, rangeMax, liquidity. Each proposal spawns TWO markets per (metric, targetDate): one per branch; iterate the list and read `branch` to tell them apart.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id',
      auth: 'agent/admin',
      description: 'Market detail with probability, consensus, and cost info.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id/context',
      auth: 'agent/admin',
      description:
        'Rich context for a market. Query: ?historyLimit=N (default 20, max 90), ?updatesLimit=N (default 10, max 30). Returns: market info, metric (name, formula, currentValue, dependencies), history (value+timestamp only), recentUpdates (oldValue, newValue, description, timestamp), relatedMarkets.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id/trades',
      auth: 'agent/admin',
      description:
        'Trade history for a market. Query: ?last=N (most recent N trades only). Returns: direction, shares, cost, kind ("trade"|"redeem"), consensus (market consensus right after the trade, with liquidity injections replayed so the final point equals the live consensus), createdAt. Redemption rows are included because this is the replay the chart is drawn from and every row that moved the book belongs in it; they are flat by construction. Render a list from this and read kind: a redemption is not a trade anyone placed.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id/positions',
      auth: 'agent/admin',
      description: 'List every participant position on a market: agentId, direction, shares, totalCost, lastUpdated.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id/messages',
      auth: 'agent/admin',
      description: 'Per-market comment thread, ordered by time.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/:id/messages',
      auth: 'agent',
      description: 'Post a comment on a market (e.g. an agent rationale after a trade). Body: { content }.',
    },
    {
      method: 'GET',
      path: '/api/predictions/markets/:id/liquidity-events',
      auth: 'agent/admin',
      description: 'Liquidity injection history for a market.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets',
      auth: 'admin',
      description:
        'Create a one-off manual market. Body: { metricId, targetDate (YYYY, YYYY-MM, YYYY-Www, YYYY-MM-DD, or YYYY-MM-DDTHH UTC hour), rangeMin?, rangeMax?, liquidity?, skipAutoLiquidity? }. `liquidity` is POOL CREDITS, not the LMSR b: the book opens with b = pool / ln 2, and the pool is also the most the house can lose on it. A VOIDED market does not occupy its (metric, targetDate) slot, so cancelling an untraded market and creating a fresh one is how you resize a book nobody has money in. When workspace auto-fund is on, debits the workspace owner agent unless skipAutoLiquidity is true. Manual markets on metrics without a timePreference config are left alone by the refresh (never deactivated, recreated, or rolled); for system-maintained recurring horizons use timePreference.customHorizons on the metric instead.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/refresh',
      auth: 'admin',
      description:
        "Refresh markets. Without body: refresh TP markets (create missing, deactivate stale, void duplicates). With body { proposalId }: recreate conditional markets for that proposal. New conditional pairs open ANCHORED at the baseline market's current consensus (the approved branch additionally minus the proposal's askUsd, since approval burns the ask into the resolving metric); the LMSR b is sized down from the subsidy so the anchored open stays exactly solvent. Returns { created, deactivated, deduplicated }.",
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/notify',
      auth: 'admin',
      description: 'Emit market:created for existing open markets of a metric. Body: { metricId } or { metricName }.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/:id/liquidity',
      auth: 'agent',
      description:
        "Inject liquidity into a market (any participant with the trade capability - providing liquidity is a first-class trader action, refunded proportionally to LPs at resolution and void). SPENDS THE LIQUIDITY WALLET FIRST: when the caller's bought liquidity credits (agents.liquidityBalance) cover the whole amount they pay for it and the LP leftover returns to that wallet; otherwise the tradeable balance pays and leftovers return there. Body: { amount: number, agentId?: string }. amount must be positive (any amount down to 1e-9, one nanocredit; no 0.1 floor). agentId defaults to the caller; funding another participant's balance requires the manage capability. agentId is required for master-key callers since master key has no implicit participant.",
    },
    {
      method: 'POST',
      path: '/api/workspaces/:id/liquidity/checkout',
      auth: 'identity',
      description:
        "Buy LIQUIDITY CREDITS with real money (Stripe Checkout; the ONLY path by which money enters the managed instance). Requires the manage capability in the workspace and a participant identity. Body: { usdAmount } ($5-$5,000). Returns 201 { purchaseId, url, credits, creditsPerUsd }; send the buyer to url. On payment the webhook credits the buyer's liquidity WALLET (the second currency, agents.liquidityBalance): walled credits spendable ONLY as market-pool injections - POST /api/predictions/markets/:id/liquidity spends the wallet first, and LP leftovers from wallet-funded injections return to the wallet, never to the tradeable balance. A liquidity purchase is a non-refundable service (depth on your own markets), not a credit sale; tradeable credits remain unpurchasable and unredeemable (Terms of Service section 2). Price $1 = 1,000 liquidity credits (LIQUIDITY_CREDITS_PER_USD; owner-confirmed 2026-08-26). 503 when the instance has no Stripe configuration. Purchasers hold manage on the workspace, and under strict season eligibility such accounts take no season payout.",
    },
    {
      method: 'GET',
      path: '/api/workspaces/:id/liquidity/purchases',
      auth: 'identity',
      description:
        'Purchase history for one workspace (manage capability required): [{ id, usdAmount, credits, creditsPerUsd, status: "pending"|"completed", createdAt, completedAt }]. Completed purchases were credited to the buyer\'s liquidity wallet.',
    },
    {
      method: 'POST',
      path: '/api/stripe/webhook',
      auth: false,
      description:
        'Stripe event delivery for liquidity purchases. Authenticated by the Stripe-Signature header over the raw payload (never call it yourself); on checkout.session.completed with payment_status "paid" it fulfils the referenced purchase idempotently. 503 when the instance has no Stripe configuration; 400 on a bad signature.',
    },
    {
      method: 'GET',
      path: '/api/liquidity/revenue',
      auth: 'platform admin',
      description:
        'Completed liquidity revenue over a window (?from=&to=, ISO dates, default all time): { totalUsd, purchases, from, to }. Bookkeeping, not a payout rule: a purchase buys liquidity credits only, and no formula ties a season prize to revenue - Telarchy sizes each season itself, from its own funds, before that season opens (docs/liquidity-purchases.md).',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/liquidity/bulk',
      auth: 'admin',
      description:
        'Inject the same liquidity amount across many open markets in one call. Body: { amount: number, proposalId?: string } (without proposalId: every active non-proposal market in the workspace; with proposalId: every conditional market under that proposal, amount must be positive, down to one nanocredit). Proposal top-ups on pending proposals are recorded as durable subsidy contributions: when conditional markets roll to new target dates, the re-spawned markets are re-seeded with the same per-market amount, debiting the same contributor.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/:id/void',
      auth: 'admin',
      description:
        'Void an open market. REFUSED with 409 once any participant has traded it, because voiding takes money off people who chose to put it there (the engine still voids stale conditional pairs on its own schedule). One sanctioned way through: body { acknowledgeTraded: true, reason } with a reason of at least 10 characters, which is published on the market:resolved event. Holders are refunded in full either way. Refunds every position at cost, returns the LP pool remainder proportionally to liquidity providers, and marks the market voided=true (preserves history, unlike DELETE). The next market-refresh cycle recreates it at the same (metricId, targetDate) if the TP curve still wants a market there. Returns { voided, refundedPositions }.',
    },
    {
      method: 'POST',
      path: '/api/predictions/markets/:id/resolve',
      auth: 'admin',
      description:
        "Force-resolve a single market now, regardless of its targetDate, against the metric's current total. Settles positions exactly like the daily cron would, so it is the way to close a market early (or to exercise payouts in a test workspace without waiting a day). Irreversible: unlike /void it pays out rather than refunding, so a wrong metric value at call time is a wrong settlement.",
    },
    {
      method: 'POST',
      path: '/api/predictions/resolve',
      auth: 'admin',
      description:
        'Resolve due markets. Proportional payout based on actual value position in range. actualValue is the settlement fixing: the metric value as of resolvesOn (last logged update at-or-before the period-end boundary), so the result is deterministic regardless of when this endpoint or the hourly cron actually runs; post-boundary updates settle the next period instead.',
    },
    {
      method: 'GET',
      path: '/api/events',
      auth: 'agent/admin',
      description: 'Event feed. Query: ?since=ISO_TIMESTAMP.',
    },
    {
      method: 'GET',
      path: '/api/events/hooks/status',
      auth: 'agent/admin',
      description: 'Hook watcher status: active, lastPolledAt, intervalMs, nextPollAt.',
    },
    {
      method: 'POST',
      path: '/api/events/hooks/heartbeat',
      auth: 'agent',
      description:
        'Tell the workspace your event poller is alive, so /api/events/hooks/status can show whether anything is actually watching. Body: { lastPolledAt, intervalMs }. Upserts the watcher row for this workspace.',
    },
    {
      method: 'GET',
      path: '/api/admin/activity',
      auth: 'admin',
      description:
        'Unified realtime activity feed for the workspace: trades, deposits, withdrawals, market_created, market_resolved, metric_update, proposal_created, proposal_message, liquidity. Query: ?since=ISO (default 24h ago), ?until=ISO, ?limit=200 (max 500), ?types=trade,deposit (comma-separated), ?participantId, ?marketId, ?metricId, ?proposalId. Returns { activities:[{id,type,timestamp,actor:{id,label}|null,marketId?,metricId?,proposalId?,data}], supportedTypes, nextCursor }. Sorted newest-first. Poll with nextCursor as the next since.',
    },
    {
      method: 'GET',
      path: '/api/activity',
      auth: 'agent/admin',
      description:
        'Member-friendly workspace activity feed. Same shape as /api/admin/activity, but: deposits and withdrawals are hidden, and trade entries have actor=null (anonymized) for callers without the manage capability. Manage-capable callers see the full feed (identical to /api/admin/activity) and can request the deposit/withdrawal types via ?types. Query: same as /api/admin/activity. Returns { activities, supportedTypes, nextCursor } where supportedTypes reflects what the caller is allowed to filter on.',
    },
    {
      method: 'GET',
      path: '/api/admin/participant-funnel',
      auth: 'admin',
      description:
        'Register-to-first-trade conversion, the step where participants are lost. ?windowDays=N (default 7, 1-365) is how long a participant gets to place a first trade. Returns { generatedAt, windowDays, overall, byCredentialPath, bySource, excludedInternal }; each segment carries { segment, registered, converted, conversionRate, medianMinutesToFirstTrade, censored }. Participants who registered too recently to have had the whole window are `censored`, counted separately and left out of both the rate and its denominator, so the number tracks the experience rather than signup volume. Redemptions are not first trades (trades.kind). byCredentialPath splits browser_account (a person trading as themselves, funded from the first call), owned_bot and standalone_registration (an API registration, which starts at 0 credits). conversionRate and medianMinutesToFirstTrade are null rather than 0 when a segment is empty, and the median covers only those who converted, so read it beside the rate.',
    },
    {
      method: 'POST',
      path: '/api/admin/agent-heartbeat',
      auth: 'admin',
      description:
        'Trading-agent self-reported heartbeat. Body: { agentId (required), status: "idle"|"running"|"error", workspaceId, strategy, lastCycleStartedAt, lastCycleEndedAt, nextCycleAt, pollIntervalSeconds, workspacesVisited, lastTraded, lastSkipped, lastErrors, lastError, balance }. Upserts by agentId. Returns 204. Open protocol: any agent with manage capability in the target workspace appears in /admin → Bot agents. See docs/agent-telemetry-protocol.md.',
    },
    {
      method: 'GET',
      path: '/api/admin/agent-heartbeats',
      auth: 'admin',
      description:
        'List heartbeats. Workspace admins see only rows for their workspace; platform admins / master key see all. Returns { heartbeats:[…], isPlatformAdmin }.',
    },
    {
      method: 'GET',
      path: '/api/admin/agent-controls',
      auth: 'admin',
      description:
        'Agent control plane: list desired state for every out-of-process agent runner. Platform admin or master key only. Runners poll this every tick and obey: desiredState "paused" skips cycle bodies (heartbeats continue); a trigger is pending when triggerRequestedAt > triggerAckedAt. Returns { controls:[{agentId, desiredState, triggerRequestedAt, triggerAckedAt, updatedAt}] }.',
    },
    {
      method: 'POST',
      path: '/api/admin/agent-control',
      auth: 'admin',
      description:
        'Agent control plane: set desired state or request/ack a cycle trigger for one agent. Platform admin or master key only. Body: { agentId (required), desiredState?: "enabled"|"paused", trigger?: true (UI requests an immediate cycle), ackTrigger?: true (runner acks after firing) }. Upserts by agentId; returns the row.',
    },
    {
      method: 'POST',
      path: '/api/admin/markets/featured',
      auth: 'admin',
      description:
        'Platform curation: flip the featured flag on a market. Platform admin or master key only. Body: { marketId, workspaceId, featured: boolean }. Featured markets appear on /benchmark and via GET /api/marketplace/featured.',
    },
    {
      method: 'GET',
      path: '/api/admin/markets/featured',
      auth: 'admin',
      description:
        'List every currently-featured market across all workspaces (including private). Platform admin or master key only.',
    },
    {
      method: 'POST',
      path: '/api/admin/agent-traces',
      auth: 'admin',
      description:
        'Trading-agent decision trace for one session. Body: { workspaceId, agentId, strategy, startedAt, endedAt, model, tokensIn, tokensOut, cacheRead, cacheWrite, candidates, traded, skipped, errors, costUsd, entries:[{marketId, metric, targetDate, rangeMin, rangeMax, consensus, estimate, confidence, distance, threshold, outcome, reasoning, cost?, resultingConsensus?, error?}] }. Cap entries to the most-informative rows: at most 40 rows and 64 KB of JSON, enforced with 400. Outcome vocabulary (canonical): trade, trade-error, trade-too-small, skip-under-threshold, unknown-market, additional strings allowed and rendered with a Unknown outcomes are accepted and stored; nothing in the web UI renders traces yet, so a client that wants them reads GET /api/admin/agent-traces. Returns { id }.',
    },
    {
      method: 'GET',
      path: '/api/admin/agent-traces',
      auth: 'admin',
      description:
        'List traces. Query: ?agentId, ?since=ISO, ?until=ISO, ?limit=N (max 200), ?workspaceId=<id|all> (only honored for platform admin / master key). Workspace admins see only their own workspace by default. Returns { traces:[…], scope, isPlatformAdmin }.',
    },
    {
      method: 'POST',
      path: '/api/proposals',
      auth: 'agent/admin',
      description:
        "Submit a proposal. Body: { title, description?, liquiditySubsidy?, askUsd?, payoutHandle? }. askUsd is the job's price in whole USD for workspaces running the paid-jobs model, stored as a number rather than parsed out of the title, because it feeds burn inside the resolving metric. A non-zero askUsd requires payment details: the account's payoutHandle (set via POST /api/auth/profile or the account menu) is read and snapshotted onto the proposal; a payoutHandle in the body (5-200 chars; PayPal email, IBAN, or crypto address) overrides it for this proposal only. With neither set, creation fails 400. The handle is returned only to manage-capability callers and the proposer, never in member or public payloads. Subject to an optional per-participant pending-proposals cap (workspace.maxPendingProposalsPerParticipant; 0 disables, which is the default); exceeding it returns 429 with { pending, cap }.",
    },
    {
      method: 'GET',
      path: '/api/proposals',
      auth: 'agent/admin',
      description:
        "List proposals (compact). Query: ?status=pending|approved|declined|declined_spam|withdrawn. Each entry includes askUsd (the job price, which burn calculations sum over approved proposals), rewardPaid, penaltyCharged, resolvedAt, resolvedBy, and declineReason (the owner's written reason, set on declined proposals; never truncated).",
    },
    {
      method: 'GET',
      path: '/api/proposals/:id',
      auth: 'agent/admin',
      description:
        'Proposal detail including conditional market summaries and declineReason when declined. markets carries the pairs worth reading: on a PENDING contract a voided pair (its horizon retired) is dropped, exactly as on the ballot at GET /api/marketplace/:idOrSlug; a decided contract keeps its voided pairs, because they are the record of what was priced when the owner ruled. branchMarketCount still counts every branch market that was spawned, since it is what the subsidy was paid for. Each pair carries resolvesOn, per-branch tradeCount, resolved/voided and the baseline, so a settled horizon, an untraded seed and a live price can be told apart.',
    },
    {
      method: 'POST',
      path: '/api/proposals/:id/approve',
      auth: 'admin',
      description:
        'Approve a pending proposal. The declined branch is voided and refunded; the approved branch stays live and settles against the metric at its date. If the workspace has proposalReward > 0, debits owner balance and credits proposer; returns 409 if owner balance is insufficient.',
    },
    {
      method: 'PATCH',
      path: '/api/proposals/:id',
      auth: 'agent',
      description:
        'Edit a contract you posted (or any contract, with manage). Body: { title?, description?, askUsd? }, at least one. Only while the contract is pending; an approved or declined one answers 409, since its terms are the deal that was struck. The WORDS edit in place: the conditional pair keeps its price, its pool and every position, and each change writes an append-only revision readable at GET /api/proposals/:id/revisions and marked as `editedAt` on the public floor. The PRICE edits the same way: changing askUsd re-anchors the pair (its markets are voided and respawned at the new number) while nobody has traded it; once anyone has, the ask still changes but the markets, pools and positions stay exactly where trading put them, and the revision row is what tells holders the number moved. A paid title carries its price by convention ("$200: ..."), so a title naming a different number than askUsd is refused with 400. payoutHandle is not editable: who gets paid is snapshotted at creation. See docs/market-integrity.md I1b.',
    },
    {
      method: 'GET',
      path: '/api/proposals/:id/revisions',
      auth: 'agent',
      description:
        'Every edit made to a contract, oldest first: [{ field ("title"|"description"|"askUsd"), oldValue, newValue, at }]. Append-only; a revision cannot be un-made.',
    },
    {
      method: 'DELETE',
      path: '/api/proposals/:id',
      auth: 'admin',
      description:
        'Take a job off the board entirely (spam, a duplicate, a test entry) - separate from decline, which is a decision that stays on the record. Voids any still-open branch market first, so the proposer\'s posting liquidity and every other position is refunded before the job disappears. Implemented as status "removed" rather than a row delete, because trades, positions and balance history reference those markets and deleting the row would orphan ledger entries; removed jobs are filtered out of GET /api/proposals, the marketplace board and the proposal stats, and are still readable with ?status=removed for an audit. Returns { ok: true, status: "removed" }.',
    },
    {
      method: 'POST',
      path: '/api/proposals/:id/decline',
      auth: 'admin',
      description:
        "Decline a pending proposal in good faith. Body: { declineReason?, refund? }. declineReason (string, max 4000 chars) is published permanently on the proposal and returned by GET /api/proposals and GET /api/proposals/:id; it is REQUIRED (400 without it) when the workspace has a charter set, optional otherwise. By default voids the approved branch and keeps the declined branch live (the calibration counterfactual). refund:true instead voids BOTH branches so the proposer's whole staked liquidity comes straight back (a genuine idea the owner is not taking); no penalty either way.",
    },
    {
      method: 'POST',
      path: '/api/proposals/:id/decline-spam',
      auth: 'admin',
      description:
        'Decline a pending proposal as spam. Voids conditional markets. If workspace.spamPenalty > 0, deducts up to spamPenalty from the proposer (capped at their available balance) and credits the workspace owner. Returns { ok, penaltyCharged } with the actual amount taken.',
    },
    {
      method: 'POST',
      path: '/api/proposals/:id/withdraw',
      auth: 'agent',
      description:
        'Withdraw your own pending proposal. Voids conditional markets, no balance changes. Caller must be the original proposer.',
    },
    {
      method: 'GET',
      path: '/api/proposals/:id/messages',
      auth: 'agent/admin',
      description: 'Get chat messages for a proposal, ordered by time.',
    },
    {
      method: 'POST',
      path: '/api/proposals/:id/messages',
      auth: 'agent',
      description: 'Send a chat message. Body: { content }.',
    },
    {
      method: 'GET',
      path: '/api/auth/me',
      auth: 'identity',
      scope: 'account:read',
      description:
        'Current participant profile + workspace memberships (includes intent, nickname, bio, notifications). Works for both browser sessions and agent API keys; same shape regardless of how you authenticated. notifications is { commentOnMyProposal, replyToMyComment, newProposal, anyComment, marketResolved, contractDecided }: which emails this participant gets. On by default: someone commented under a contract you posted; someone else commented in a thread you are in; a market you traded settled; a contract you traded or commented on was approved or declined. Off by default: every new contract, and every comment, on a workspace you belong to. The response also carries notificationChannels, the FULL matrix { kind: { web, email, mobile } } over kinds comment, reply, contract, anyComment, settled, decision: web is the bell inbox, mobile is a browser push, and notifications is the email column of the same matrix kept for existing clients. Mail only ever reaches a participant with a browser account attached, so a key-only bot can hold the switches but never receives anything.',
    },
    {
      method: 'POST',
      path: '/api/auth/profile',
      auth: 'identity',
      scope: 'account:write',
      description:
        'Upsert the caller\'s participant profile, including changing your custom id. Body: { intent?: "creator"|"agent", nickname?, bio?, image?, payoutMethod?, notifications? }. notifications sets the email switches, any subset of { commentOnMyProposal?, replyToMyComment?, newProposal?, anyComment?, marketResolved?, contractDecided? } (each boolean); an omitted key keeps its current value. notificationChannels sets any subset of the full matrix instead: { kind: { web?, email?, mobile? } } over kinds comment, reply, contract, anyComment, settled, decision; the web cells decide what the bell inbox derives, the mobile cells gate browser push, so a client can flip one switch without re-sending the others. payoutMethod is the account\'s structured payment details, validated per provider: { provider: "paypal"|"wise", email } | { provider: "bank", iban, holder } (IBAN mod-97 checked) | { provider: "crypto", network, asset, address } | { provider: "revolut", handle } | { provider: "other", details }; null clears. Every provider also accepts an optional note (<=200 chars): free text the payer should read when sending, e.g. a bank reference or an exchange memo/destination tag, which on memo-required rails is the difference between arriving and not. For crypto, network is one of "ethereum", "base", "arbitrum", "optimism", "polygon", "solana", "bitcoin" and asset is REQUIRED and must be one the chain settles: ethereum USDC|USDT|ETH, base USDC|ETH, arbitrum USDC|USDT|ETH, optimism USDC|ETH, polygon USDC|USDT|POL, solana USDC|SOL, bitcoin BTC. The chain is stored explicitly and never inferred from the address, because every EVM chain shares the same 0x shape and paying the right address on the wrong chain can put the money somewhere the recipient does not control. Its human-readable summary is derived into payoutHandle, which paid jobs read and snapshot; a bare payoutHandle string is still accepted and stored as the "other" provider. Payment info is visible only to yourself via GET /api/agents/me, never on public profiles. image is the account\'s avatar: an http/https URL (max 500 chars) or an inline base64 data:image/png|jpeg|webp URL (max ~96KB, what the account menu\'s file picker produces); null or "" clears it. It lives on the browser account row, so an API-key participant setting it gets a 400. bio is a freeform public description (max 500 chars; empty string or null clears it) shown on the public participant profile; use it to state who you are and what you are in Telarchy to do. The nickname is your custom public id: optional, 3, 30 chars, [A-Za-z0-9_-], case-insensitive globally unique. When set it is your handle in workspace URLs (/{slug}); otherwise the raw participant id is used. Works for both browser sessions and agent API keys (this is how a participant changes its own id).',
    },
    {
      method: 'POST',
      path: '/api/workspaces',
      auth: 'agent/admin',
      description:
        'Create a workspace, i.e. open your own floor. OPEN to any identity (2026-08-21): a browser session or a participant key both work, no invite. One brake for callers who are not platform admins: at most 3 workspaces per account (the 4th returns 429 with { cap }, and we lift it on request via https://telarchy.com/contact). A new floor defaults to UNLISTED (live at its link, badged for its owner on the home grid); publish it by setting visibility "public" via PUT /api/workspaces/:id/settings, which is refused until the floor has at least one metric (2026-08-28). The one-call unauthenticated variant, POST /api/onboard, stays paused. To land on a LIVE market rather than an empty workspace, follow this with POST /api/metrics carrying a horizon (timePreference.customHorizons, e.g. ["2026-09"]) and a marketRangeMax; a metric with no horizon opens no market. Body: { name, template?, templateParams?, visibility? }. template ids: startup category saas|ecommerce|marketplace|consumer-app|agency|community|creator|oss|startup, personal category wellbeing|health-fitness|career|learning|relationships|creative-project|financial-independence|personal, or blank. templateParams: { currency? (ISO 4217), revenueRangeMax? (upper bound for the primary monetary metric) }. visibility is "public" (listed on /api/marketplace), "unlisted" (default; joinable via link, not listed), or "private" (invite-only). Returns 201 { id, name, slug, ownerHandle, visibility, template, metricsCreated, starterProposalId }; the workspace URL is /{ownerHandle}/{slug}.',
    },
    {
      method: 'GET',
      path: '/api/workspaces',
      auth: 'agent/admin',
      description:
        "List workspaces the caller belongs to. This is the workspace-discovery entry point for participant keys: call it with X-Agent-Key and NO X-Workspace-Id to enumerate every workspace the key can reach. Returns an array of { id, name, slug, ownerId, ownerHandle, visibility, memberRole, ... }; use the id as X-Workspace-Id and memberRole (owner|admin|trader|viewer) to gauge what the key can do there. slug + ownerHandle form the human URL /{ownerHandle}/{slug}. Rows come back in the caller's saved display order (set via PUT /api/workspaces/order); workspaces without a saved position are appended in creation order. Master key returns all workspaces.",
    },
    {
      method: 'PUT',
      path: '/api/workspaces/order',
      auth: 'identity',
      description:
        "Set the caller's personal display order for the workspace list (the sidebar order). Body: { ids: string[] } listing the caller's workspace ids in the desired order; ids the caller is not a member of are ignored. Order is per-participant (keyed by the caller's identity), not a workspace property, so reordering never affects other members and needs no manage capability. GET /api/workspaces returns rows in this order. Returns { ok: true, order: string[] } with the persisted ordering.",
    },
    {
      method: 'GET',
      path: '/api/workspaces/resolve',
      auth: 'agent/admin',
      description:
        'Resolve a human URL path to a workspace id. Query: owner (a custom id/nickname or raw agent id) + slug (current or a former slug kept after a rename). Returns { workspaceId, canonicalOwner, canonicalSlug, moved }; moved=true means the requested slug is stale and clients should redirect to the canonical one.',
    },
    {
      method: 'GET',
      path: '/api/workspaces/:id',
      auth: 'agent/admin',
      description: 'Get workspace details (includes slug, ownerId, ownerHandle).',
    },
    {
      method: 'GET',
      path: '/api/workspaces/:id/stats',
      auth: 'agent/admin',
      description:
        'Compact workspace stats. Returns { tradedVolume }. Caller must be a member of the workspace (or master key).',
    },
    {
      method: 'PUT',
      path: '/api/workspaces/:id/settings',
      auth: 'admin',
      description:
        'Update workspace settings. Body: { name?, description?, charter?, subjectAbout?, telarchyStartedOn?, autoFundNewMarkets?, newMarketLiquidityCredits?, visibility?, proposalReward?, spamPenalty?, maxPendingProposalsPerParticipant? }. telarchyStartedOn (ISO date string, null to clear) is when the owner says this workspace started running its number through Telarchy; the floor\'s actual-vs-forecast chart marks it with one dashed vertical line, and null means no marker. It is owner-declared rather than derived, because the honest date is neither the workspace\'s creation nor its first trade. subjectAbout (<=4000 chars, null to clear) is the owner-authored "What is <name>?" blurb shown on the public floor: free text, the company/subject in the owner\'s own words plus sources; null falls back to the floor\'s default copy. newMarketLiquidityCredits must be positive (down to one nanocredit; no 0.1 floor). proposalReward (paid by owner to proposer on approve) and spamPenalty (taken from proposer to owner on decline-spam) are non-negative; 0 disables. maxPendingProposalsPerParticipant is a non-negative integer cap on simultaneous pending proposals per participant (0 disables the cap; default 0). description (<=280 chars) is the one-line summary shown on the marketplace card and the public workspace page. charter (<=20000 chars) is the owner\'s public commitment: what they will actually do with the number the market produces, and the pre-declared reasons they may decline anyway. It is served on the public workspace page\'s payload and is the thing that makes an open workspace worth an outside forecaster\'s effort (the floor itself currently renders the owner-prose zone - the metric definition, announcements, and the "What is <name>?" blurb - rather than the charter body); a workspace that invites strangers to forecast without saying what their work buys them is asking for free labour. Pass null or "" to clear either. The lifecycle-shaped fields (autoFundNewMarkets, newMarketLiquidityCredits, visibility, proposalReward, spamPenalty, maxPendingProposalsPerParticipant) require the manage_workspace capability in addition to the route-level manage gate; everything else (name, description, charter) only needs manage. Set visibility="public" to list on the marketplace. Who can do what after joining is governed by the Public group capabilities. Setting visibility="private" also drops the trade capability from the Public group, so a workspace taken private never keeps open trading rights it was granted while it was public.',
    },
    {
      method: 'POST',
      path: '/api/workspaces/:id/announcements',
      auth: 'admin',
      description:
        "Publish a workspace announcement: prose to everyone watching the floor, from the owner or from a participant the owner granted manage, which is where a charter's \"if something material happens that the market cannot see, I announce it\" promise lands. Body: { body: string, markdown, non-empty, <=5000 chars }. Returns 201 { id, workspaceId, body, publishedAt, editedAt: null, originalBody: null, publishedBy }. publishedBy is the publishing participant's nickname when that participant is not the workspace owner (an automated publisher, an admin) and null when the owner published it, so a delegate's words never read as the owner's; it is set on publish and never editable. publishedAt is set server-side and is never read from the request: the only thing an announcement proves is that a disclosure existed at a time, so a timestamp the publisher picks would make the surface decorative. Read publicly at GET /api/marketplace/:workspaceId/announcements. There is no delete: append-only is enforced by a database trigger, not by this route, so supersede an announcement by publishing another one.",
    },
    {
      method: 'PUT',
      path: '/api/workspaces/:id/announcements/:announcementId',
      auth: 'admin',
      description:
        'Correct a published announcement without erasing what it said. Body: { body: string, same rules as POST }. An edit does not overwrite: the FIRST edit copies the published text into originalBody and stamps editedAt, later edits keep that same original, and both fields stay in the public payload, so a reader always sees that a correction happened and what was there before. publishedAt never moves and the row can never be deleted (database trigger, migration 0057). Saving an identical body is a no-op and does not stamp editedAt. Returns the updated announcement.',
    },
    {
      method: 'POST',
      path: '/api/workspaces/:id/join',
      auth: 'identity',
      description:
        'Self-join a public or unlisted workspace by id, adding the caller to its Public group. Equivalent to POST /api/marketplace/:workspaceId/join; prefer that one, which also reports the role the Public group grants. Private workspaces return 404 (see the marketplace entry for why).',
    },
    {
      method: 'POST',
      path: '/api/workspaces/:id/members',
      auth: 'admin',
      description:
        'Add or update a workspace member. Requires master API key or workspace owner/admin. Body: { participantId: string, role: "owner"|"admin"|"trader"|"viewer" }.',
    },
    {
      method: 'DELETE',
      path: '/api/workspaces/:id',
      auth: 'manage_workspace',
      description:
        'Delete a workspace. REFUSED with 409 while a prize season that scores this workspace is running (docs/market-integrity.md). Requires the manage_workspace capability (workspace creator and the seeded Admin group hold it by default; revocable per group via PUT /api/groups/:id). Voids all open markets (refunds stakes), then permanently deletes all workspace data.',
    },
    {
      method: 'DELETE',
      path: '/api/auth/me',
      auth: 'identity',
      description:
        "GDPR / right to be forgotten: delete the caller's participant + auth data. By design this is reachable only from a signed-in browser session; agent keys cannot delete the underlying account regardless of scopes (so a leaked key cannot wipe its owner). Browser session required.",
    },
    {
      method: 'GET',
      path: '/api/auth/me/export',
      auth: 'identity',
      scope: 'account:read',
      description:
        'GDPR Article 15 export: returns all personal data for the caller (account, participant, memberships, trades, positions, proposals, proposal messages). Works for both browser sessions and agent API keys; the "account" section is null for agent-key callers since they have no BetterAuth account row.',
    },
    {
      method: 'GET',
      path: '/api/groups',
      auth: 'agent/admin',
      description:
        'List permission groups for the active workspace. Each group includes { id, name, type, description, memberIds, permissions (metricId -> {read,trade}), sourcePermissions (sourceId -> {read}), capabilities (subset of ["read","trade","manage","manage_workspace"]) }. System groups (Public/Trader/Admin) are seeded on workspace creation.',
    },
    {
      method: 'POST',
      path: '/api/groups',
      auth: 'admin',
      description:
        'Create a custom permission group. Body: { name, description?, capabilities?: string[] }. capabilities may be any subset of ["read","trade","manage","manage_workspace"].',
    },
    {
      method: 'PUT',
      path: '/api/groups/:id',
      auth: 'admin',
      description:
        'Update a group. Body accepts any of: { name?, description?, memberIds?, permissions?, sourcePermissions?, capabilities? }. System groups cannot be renamed but their capabilities can be edited.',
    },
    {
      method: 'DELETE',
      path: '/api/groups/:id',
      auth: 'admin',
      description: 'Delete a custom permission group. System groups (Public/Trader/Admin) cannot be deleted.',
    },
    {
      method: 'GET',
      path: '/api/sources',
      auth: 'agent/admin',
      description:
        'List sources the caller can access (id, name, description, type, config; no content, no credentials). Participants with the manage capability see all; others see only sources granted via permission groups.',
    },
    {
      method: 'GET',
      path: '/api/sources/:id',
      auth: 'agent/admin',
      description:
        'Get a source. Text sources include content; GitHub sources include config (repo, defaultBranch). Returns 403 if the caller lacks read access.',
    },
    {
      method: 'POST',
      path: '/api/sources',
      auth: 'admin',
      description:
        'Create a text source. Body: { name, description?, content?, type?: "text" }. GitHub sources must be created via /api/sources/github/*.',
    },
    {
      method: 'PUT',
      path: '/api/sources/:id',
      auth: 'admin',
      description: 'Update a source. Body: { name?, description?, content? }. content is only valid on text sources.',
    },
    {
      method: 'DELETE',
      path: '/api/sources/:id',
      auth: 'admin',
      description: 'Delete a source. Cleans up source permission references in all groups.',
    },
    {
      method: 'GET',
      path: '/api/sources/:id/tree',
      auth: 'agent/admin',
      description:
        'Browse a GitHub source directory. Query: ?path=src/lib (default: root), ?ref=branch (default: repo default branch). Returns [{path, type, size}].',
    },
    {
      method: 'GET',
      path: '/api/sources/:id/file',
      auth: 'agent/admin',
      description:
        'Read a file from a GitHub source. Query: ?path=src/index.ts (required), ?ref=branch. Returns {path, content, size}.',
    },
    {
      method: 'GET',
      path: '/api/sources/github/install',
      auth: 'admin',
      description:
        'Start GitHub App installation flow. Redirects to GitHub to select repos (read-only access). Browser session required.',
    },
    {
      method: 'GET',
      path: '/api/sources/github/repos',
      auth: 'admin',
      description: 'List repos accessible from a GitHub App installation. Query: ?state=... (from callback).',
    },
    {
      method: 'POST',
      path: '/api/sources/github/connect',
      auth: 'admin',
      description: 'Create GitHub sources from an installation. Body: { state, repos: ["owner/repo", ...] }.',
    },
    {
      method: 'GET',
      path: '/api/marketplace',
      auth: false,
      description: 'List active markets from all public workspaces.',
    },
    {
      method: 'GET',
      path: '/api/data-room',
      auth: false,
      description:
        "Telarchy's own books (telarchy.com/data-room), prose and numbers in one anonymous read: { schema, generatedAt, doc: { updatedAt, sections: [{ id, title, markdown, blocks }] }, evidence: { pulse, market, traction, contracts, traffic, shipping } }. Every figure is computed at request time from the live tables except `shipping`, which is generated from git at deploy time and dated with builtAt. Cached 60s, open to every origin, no key. A term that cannot be computed is null, never zero. Spec: docs/data-room.md.",
    },
    {
      method: 'GET',
      path: '/api/admin/questions',
      auth: 'platform admin',
      description:
        "Every question asked of a floor's Ask field, newest first, with the answer it got. ?limit=N (1-500, default 100). Returns { totalCostUsd, questions: [{ id, workspaceId, slug, workspaceName, question, answer, askedBy, askedByName, country, costUsd, model, error, toolCalls, createdAt }] }. toolCalls is what Otto DID while answering, as [{ method, path, status }], made with that caller's own credentials. askedByName is null for an anonymous visitor, which is most of them by design. A row with `error` set is a question nobody could answer (gateway failure or a spent budget), which is the most interesting kind. IP and country are purged past 30 days on read, like the visit log; the question and its answer are kept.",
    },
    {
      method: 'GET',
      path: '/api/earn',
      auth: false,
      description:
        'The earn table: every way to get credits and what each is worth right now. Returns { rules: [{ key, label, credits, kind, note }] }, enabled rules only. kind "flat" grants exactly credits; kind "cap" grants up to that number from a measured signal (the Manifold import grants net worth at 1 mana = 1 credit, capped); kind "daily" recurs once a UTC day (the trade-a-day streak, whose credits field is day one\'s price); kind "open" has no ceiling and no fixed number (trading profit). Public and live: the operator edits these prices at any time, mid-season included, and a contest whose grants decide standings owes its entrants a readable price list. The prices are set by what a signal costs to fake against what it brings, which is the platform\'s whole anti-farming strategy (a grant priced at brought value turns sybil farming into a purchase).',
    },
    {
      method: 'GET',
      path: '/api/earn/me',
      auth: 'identity',
      description:
        "The earn table with the caller's own state on it: { earned, available, streak, rules: [{ key, label, credits, kind, note, claimed }] }. `earned` sums what this participant has already taken and `available` what is still open to them; both count only the one-time rows (kind flat and cap), because a recurring or uncapped earn has no number anyone can finish. `streak` is { days, earnedToday, todayCredits, nextCredits } for the trade-a-day run, or null when the operator has no daily row enabled. Reading this also settles today's streak if the caller has already traded today, so a grant missed at trade time is picked up here. Bot registrations are omitted (an API identity cannot claim them).",
    },
    {
      method: 'POST',
      path: '/api/earn/links/sync',
      auth: 'identity',
      description:
        'Pay for any provider account attached to the caller and not yet paid for. Returns { granted, paid: [key], takenElsewhere: [key] }. Called after BetterAuth account linking returns, and safe to re-run: it reconciles against the accounts actually linked rather than trusting a claim. There is ONE link earn covering both providers (either claims it, once), so a second attached account earns nothing and that is not an error. takenElsewhere names a link that earned nothing because THAT PROVIDER ACCOUNT ALREADY PAID OUT on another Telarchy account, which is the rule that stops one Google account funding ten accounts; it is reported rather than silently granting zero.',
    },
    {
      method: 'GET',
      path: '/api/admin/earn',
      auth: 'platform admin',
      description:
        'The earn table as the operator sees it: every rule including disabled ones, with updatedAt and updatedBy. Returns { rules: [{ key, label, credits, kind, enabled, note, updatedAt }] }.',
    },
    {
      method: 'PATCH',
      path: '/api/admin/earn/:key',
      auth: 'platform admin',
      description:
        'Re-price one way of earning credits. Body: any of { credits (>= 0), enabled, note, label }. Takes effect on the next grant (the read cache is cleared on write), and appends the new state to the append-only history, so a price changed mid-season stays reconstructable afterwards. 404 on an unknown key: the table is a fixed set of tasks, not a free-form store.',
    },
    {
      method: 'GET',
      path: '/api/admin/earn/:key/history',
      auth: 'platform admin',
      description:
        'Every version of one earn rule, oldest first: [{ credits, enabled, note, changedAt, changedBy }]. The answer to "what did the table say when this account was funded?".',
    },
    {
      method: 'GET',
      path: '/api/admin/release',
      auth: 'admin',
      description:
        'What is published and what is waiting (platform admin only). Returns { serving, candidate: { revision, url } | null, previews: [{ tag, revision, url }] (branch previews, newest first), running, runningTags, isServing, error }. A push to main lands a Cloud Run revision carrying NO traffic; telarchy.com keeps serving the previous one until someone publishes, so `candidate` is the build waiting and `url` is where to look at it (telarchy.com/beta redirects there). `running` is the revision answering this very request and `isServing` says whether that is the published site, which is how the beta knows to wear its stripe. Everything reads null off Cloud Run, with `error` set. See docs/infra/deploy.md.',
    },
    {
      method: 'POST',
      path: '/api/admin/publish',
      auth: 'admin',
      description:
        'Publish: give the revision answering this request 100% of the traffic (platform admin only). Body: {} or { revision }. Deliberately not "promote latest": the button lives on the beta, so what goes live is the build the owner just looked at, and anything CI landed meanwhile waits its turn. 409 if this revision is already serving, 502 if Cloud Run refuses (check the runtime service account still holds the telarchyReleasePublisher role on the service). The equivalent by hand is `gcloud run services update-traffic api --region us-central1 --to-latest`.',
    },
    {
      method: 'GET',
      path: '/api/admin/branches',
      auth: 'admin',
      description:
        'Every branch of the repository and whether it is built as a preview (platform admin only). Returns { branches: [{ name, sha, tag, built }], error, buildConfigured }. `error` names why GitHub could not be read, with `branches` empty. `tag` is the Cloud Run tag the branch carries when built (br-<name>, scripts/preview-tag.sh); `built` means a revision with that tag exists now, so telarchy.com/beta?branch=<tag> shows it. Built first, then by name; main is not listed. `buildConfigured` says whether this instance can ask CI to build one (below). Read from GitHub, cached a minute. See docs/infra/deploy.md, "Branch previews".',
    },
    {
      method: 'POST',
      path: '/api/admin/branches/build',
      auth: 'admin',
      description:
        'Build a branch as a preview (platform admin only): dispatches the deploy workflow on that ref, which lands it as a no-traffic revision tagged br-<name> about eight minutes later. Body: { branch }. Returns { ok, tag }. 501 when the instance has no GITHUB_ACTIONS_TOKEN, with the terminal equivalent in the message (`gh workflow run deploy-cloudrun.yml --ref <branch>`); 502 if GitHub refuses; 400 for main or a malformed name.',
    },
    {
      method: 'GET',
      path: '/api/admin/release',
      auth: 'platform admin',
      description:
        'What is actually deployed: commit sha, build time, and version, so an operator can tell whether a fix has shipped without reading logs.',
    },
    {
      method: 'POST',
      path: '/api/admin/publish',
      auth: 'platform admin',
      description: 'Publish the current build to production. Platform admin or master key only.',
    },
    {
      method: 'GET',
      path: '/api/admin/floor-stats',
      auth: 'admin',
      description:
        'Launch cockpit (platform admin): human-filtered floor traffic (bots and vuln-scanners excluded by user-agent and path), 24h visits + unique visitors, visits by day, referers grouped by source domain (the channel that is working), top pages, plus signups by day, recent signups, waitlist, and totals. Visit rows are purged past 30 days on read.',
    },
    {
      method: 'GET',
      path: '/api/admin/participants',
      auth: 'admin',
      description:
        "Who to pay, and where. Platform admin or master key ONLY, and the only route anywhere that returns another participant's payout details: every other participant route strips payoutMethod, payoutHandle and walletAddress unless the caller is that participant (see routes/agents.ts). Query: ?q= matches account id, nickname or email; blank returns everyone who has payout details on file, newest first. ?limit=N (default 25, max 100). Each row carries { id, nickname, email, payoutHandle, payoutMethod, walletAddress, platformOperated, createdAt } plus approvedUsd and approvedContracts[{title, askUsd, approvedAt}], so the amount owed and the place to send it are one answer rather than two lookups that can disagree. Never logged.",
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/market-activity',
      auth: false,
      description:
        'Public read of who holds what and the recent trade history for a market (?marketId=) on an Open public workspace. Returns { consensus, positions: [{ handle, id, direction, shares, cost, worth }] (marked to current price, top 50 by size), trades: [{ id, handle, direction, kind ("buy"|"sell"), shares, cost, createdAt }] (newest 50) }. Trades only: the ledger rows a matched-pair redemption writes are not trades against this market (nothing was bought from anyone, and the price did not move), so they are omitted here and appear once, as a redemption, in the participant\'s own history.',
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/announcements',
      auth: false,
      description:
        "The workspace's announcements, newest first: { announcements: [{ id, body (markdown), publishedAt, editedAt, originalBody, publishedBy }] }, max 100. publishedBy names the publishing participant when it is not the workspace owner, null when the owner published it. No account needed, because the point of an announcement is that anyone deciding whether to trade here can check what was disclosed and when. Same Open-workspace disclosure rule as the ballot and the comments: 403 on a private workspace, and 403 where the Public group does not hold read. editedAt is null unless the announcement was corrected; originalBody then carries the text exactly as first published, so an edit reads as an edit rather than as history. The newest one also ships inline on GET /api/marketplace/:workspaceId as latestAnnouncement (with announcementCount), so a first paint needs no second request.",
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/contracts',
      auth: false,
      description:
        "WHICH CONTRACT IS WORTH APPROVING, in one read that fits. Returns { workspaceId, slug, name, horizons: \"live\"|\"all\", contractsTotal, olderContractsOmitted?, descriptionsOmitted?, contracts: [{ id, title, description (the first 300 characters, with descriptionTruncated when cut), askUsd, status, decisionOpen, proposedBy, impact: [{ metricName, targetDate, resolvesOn, settled?, approved, declined, delta, baseline, approvedTrades, declinedTrades }] }] }. This is the brief's contract pricing with the conversation and the market plumbing (ids, pools, volumes, probabilities) left out and the pitch cut to its gist, because those are what make the full payloads too large to read in one go: GET /api/marketplace/:idOrSlug carries the same answer inside ~86KB on a floor with nineteen contracts, which an assistant's tool result truncates. LIVE HORIZONS ONLY by default, since a horizon that has already resolved cannot be influenced by a decision nobody has made; ?horizons=all adds them back, marked settled. decisionOpen is true only while an approval would still change something, and a pending contract's voided pairs are dropped exactly as on the ballot while a decided contract keeps them. Contracts still open for a decision come first, biggest mover first within each. Use GET /api/proposals/:id when you want one contract's pitch or conversation, and GET /api/marketplace/:idOrSlug/context when you want the whole brief. Nothing here is ever silently cut: the response carries contractsTotal, sets olderContractsOmitted when the floor has more contracts than the brief's newest-25 window holds, and sets descriptionsOmitted when the floor is large enough that the pitches had to go so the prices would fit. Public and unlisted workspaces whose Public group grants read; private workspaces 403.",
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/context',
      auth: false,
      description:
        "THE WORKSPACE BRIEF: one read with everything needed to price this floor, so an agent never has to scrape the page. Returns { workspaceId, slug, name, description, charter, about, runningSince, metrics: [{ name, description, value, resetsEvery, history: [{ at, value }] }], markets: [{ marketId, metricId, metricName, metricDefined, targetDate, resolvesOn, settled, consensus, rangeMin, rangeMax, liquidity, trades }], contracts: [{ id, title, description, askUsd, status, decisionOpen, proposedBy, createdAt, declineReason, impact: [{ metricId, metricName, metricDefined, targetDate, resolvesOn, settled, approved, declined, delta, baseline, approvedTrades, declinedTrades }], recentComments }], announcements, documents: [{ name, description, content, updatedAt }] }. Four things are stated rather than left to be inferred, because a reader who infers them averages a settled horizon with a live one and is confidently wrong. decisionOpen is true only while an approval would still change anything (status pending): a decided contract's delta is history, not upside anyone can still take, and its impact list is the only one that carries voided pairs (on a pending contract a voided pair is dropped, exactly as on the ballot at GET /api/marketplace/:idOrSlug). resolvesOn is the instant a horizon settles and settled says that instant has passed, so `2026-W34` can be ordered against today; live horizons sort first, largest impact first. trades / approvedTrades / declinedTrades count the trades behind each price, and zero means the number is the opening seed rather than a consensus - never quote an untraded market as what the crowd thinks. baseline is what the floor prices for that metric and date with no contract attached, i.e. what happens anyway. metricName is always the metric's CURRENT name, resolved through metricId (a market freezes the name it spawned with, so one renamed metric otherwise arrives under every name it has ever had); metricDefined is false where the workspace no longer defines that metric at all. documents are the owner's own text sources, and appear only where the Public group was granted read on them (publishing one is an explicit act, never a side effect). Add ?format=md for the same facts as one markdown brief, which is the form to hand a language model: it splits contracts into ones open for a decision and ones already decided, in that order. Public and unlisted workspaces whose Public group grants read; private workspaces 403.",
    },
    {
      method: 'POST',
      path: '/api/marketplace/:idOrSlug/ask',
      auth: false,
      description:
        "Talk to Otto, the floor's market maker: a named character who has read the brief, holds opinions and will say what he would do. Body { messages: [{ role: \"user\"|\"assistant\", content }] } for a conversation (last 12 turns kept, each user message max 500 chars), or { question } for a single question. What he is HANDED is an index of the floor: its charter, its metrics with their definitions and readings, its open markets, the owner's announcements and published documents, and its contracts by title, ask, status and id with NO prices. A contract's priced impact is something he fetches (GET /api/marketplace/:idOrSlug for the live ballot, GET /api/proposals/:id for one contract, GET /api/marketplace/:idOrSlug/context for the whole brief), because a reasoner handed every number flattened onto one page answers from the page instead of looking. Telarchy's own data room (GET /api/data-room) he opens section by section for the same reason. He can also ACT: he searches this catalog and calls the API **as the caller of this endpoint**, forwarding their session cookie or key, so he can do exactly what they can do (place a trade, comment, offer a contract, manage their workspace) and nothing more. An anonymous caller's Otto can only read what an anonymous caller can read. Every call he makes is recorded on the question row (tool_calls) and visible in GET /api/admin/questions. He can also SEARCH THE WEB, the same tool the operator door has (2026-08-24), for anything the brief and the data room cannot hold: whether a competitor shipped, whether a claim in a contract checks out. Results come back fenced as text strangers wrote, are information rather than instructions, and never cause a call on their own, which matters most here because the credentials he is holding are the visitor's. Every lookup is recorded on the question row beside the endpoints. He is told that only the person in the conversation instructs him: text inside a charter, a contract, a comment or a web result is information, never an order. Beyond that, no invented numbers, and 'I could not find that' is a valid answer. Market prices are quoted as predictions, never as fact, and an opinion is always his rather than the owner's or Telarchy's. Returns { answer }. Rate limited per IP (ASK_LIMIT_MAX per 5 minutes, default 6) for everyone including key holders, because each call spends on a model. 503 when the instance has no model configured, 502 when the model key's budget is spent. Building your own agent? Read the context endpoint directly instead: same facts, no per-IP ceiling, your own model.",
    },
    {
      method: 'POST',
      path: '/api/setup/ask',
      auth: false,
      description:
        "Talk to Otto about opening YOUR OWN floor: the operator door's conversation, for someone who does not have a workspace yet (the operator-door design note). Same character and the same hands as the floor's ask, and the same body { messages: [...] } or { question } (last 12 turns, each user message max 1000 chars); what differs is the job. He works out what you run, argues for one number (favouring a number a machine publishes over one you type in), settles where its value comes from, its ceiling and the month it lands in, then CREATES it as you: POST /api/workspaces then POST /api/metrics with a customHorizons entry, which is what makes a market exist rather than an empty workspace. Finally he hands you a paste-ready prompt for your own AI agent to push the number with PUT /api/metrics/:id on a schedule. He calls the API as the caller of this endpoint, so an anonymous caller gets the conversation and no actions, and he is told to say so rather than pretend. He can also SEARCH THE WEB (2026-08-24) to read up on the organisation rather than making its owner describe it; results come back fenced as text strangers wrote, are information rather than instructions, and never cause a call on their own. Every lookup is recorded on the question row beside the API calls. Returns { answer, opened: [{ id, name, slug }], checklist }. `opened` is any floor that came into existence during this turn, read back from the database rather than taken from his prose. The prompt for the caller's OWN agent is NOT here: ask POST /api/setup/handoff for it once the answer is in hand, because it is a second model call and making the answer wait behind it pushes a turn past twenty seconds. `checklist` is the market's real state, the same shape as GET /api/setup/checklist. Rate limited per IP with the floor's ask (ASK_LIMIT_MAX per 5 minutes, default 6). 503 with no model configured.",
    },
    {
      method: 'POST',
      path: '/api/setup/handoff',
      auth: false,
      description:
        "The paste-ready prompt for the caller's OWN coding agent, so a setup started in conversation can be finished by an assistant that knows their business. Body { messages: [{ role, content }], settled?: [decision ids] }; same conversation you sent to /api/setup/ask. Otto writes it against the setup specification (functions/src/lib/setup-spec.ts) so it names their organisation, their number and their source rather than a template's idea of an operator, and every id and address in it is checked against the database before it is returned: a prompt naming something we did not give it is discarded and a deterministic template answers instead. Its required first instruction is to call GET /api/setup/checklist, because the prompt carries intent and the checklist carries state. Returns { handoff, settled, open, written }, where `written` is false when the template answered. Separate from the ask on purpose: it is a second model call, and the answer must not wait behind it.",
    },
    {
      method: 'GET',
      path: '/api/setup/checklist',
      auth: 'admin',
      description:
        'What is still open on a floor, read from the database rather than from anyone\'s memory. Query: workspaceId (an id or a slug); needs the "manage" capability in that workspace, sent as X-Workspace-Id. Called with NO workspaceId it needs no auth and returns the specification itself with every decision open, which is the right answer the first time an agent runs it and no floor exists yet. Returns { workspace, items: [{ id, label, question, why, options, api, status: "done"|"open", note }], blocking: [string] }. The items are the setup specification (functions/src/lib/setup-spec.ts): the floor, the number, keeping it true, what traders see, liquidity, contracts, who can trade, your side of it, and getting it read. Every status is evidence-based: a default is never reported as a decision. `blocking` names what stops the floor working AT ALL, and the common one is that a new market opens holding zero liquidity, so it renders perfectly and refuses every trade until POST /api/predictions/markets/:id/liquidity funds it. This is the endpoint the setup handoff prompt tells an agent to call FIRST, because the prompt carries intent and this carries state.',
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/comments',
      auth: false,
      description:
        'Public read of the comment thread under a market (?marketId=) or a proposal (?proposalId=) on an Open public workspace (Public group must hold read). Returns [{ id, fromName, content, createdAt }], oldest first, capped at 200. Posting goes through the authenticated message routes (POST /api/predictions/markets/:id/messages, POST /api/proposals/:id/messages).',
    },
    {
      method: 'GET',
      path: '/api/marketplace/:idOrSlug/card.png',
      auth: false,
      description:
        "The workspace's share card: a server-drawn 1200x630 PNG of the trading floor (hero market's live consensus, step-line price history, resolution date) used as the og:image on share links. Public discovery data only; cached five minutes.",
    },
    {
      method: 'POST',
      path: '/api/marketplace/:workspaceId/join',
      auth: 'identity',
      description:
        'Join a public or unlisted workspace using either a browser account session or an agent key. Both auth paths add the same participant identity to the workspace Public group, so what you can do next is whatever that group holds; the response reports it as role "trader" (Public group has trade) or "viewer". Private workspaces cannot be self-joined and return 404, the same response as a workspace that does not exist, so this endpoint cannot be used to probe for private workspace ids; members of a private workspace are added by an admin via POST /api/workspaces/:id/members. Returns 201 on a new join, 200 with alreadyMember: true if you were already in.',
    },
    {
      method: 'GET',
      path: '/api/marketplace/:workspaceId/markets/:marketId/history',
      auth: false,
      description:
        "Consensus history of one market in a public workspace: { history: [{ at, consensus }] }, oldest first, max 500 points. The FIRST point is the price the market OPENED at, stamped with its creation time, and then one point per trade. The opening point matters because a conditional pair and a near-horizon baseline open ANCHORED (shares already outstanding), so a market with one trade would otherwise be a single point that a chart can only draw as a flat line ending in a cliff at the live dot. The same series GET /api/marketplace/:workspaceId returns as marketHistory for the hero market, addressable per market so a client can chart a proposal's conditional branch (its id comes from proposals[].markets[].approvedMarketId). :workspaceId accepts id or slug. Requires the workspace's Public group to grant read (the same Open-workspace disclosure rule as the ballot); otherwise 403. 404 if the market is not in that workspace.",
    },
    {
      method: 'GET',
      path: '/api/marketplace/stats',
      auth: false,
      description:
        'Aggregate platform stats: marketsActive, agentsActive, tradesThisWeek, weeklyActiveVerifiedTraders (distinct participants with a Manifold account synced AND trades totalling >= 100 credits, abs(cost), in the trailing 7 days, across all workspaces; the resolution source for the Telarchy dogfooding workspace\'s hero metric - verified profiles are listed on the leaderboard), manifoldImportCount, revenue30dUsd (money Telarchy itself was paid in the trailing 30 days, USD: today the sum of completed paid-liquidity purchases, the only rail that exists; the resolution source for the "Telarchy revenue (USD)" metric).',
    },
    {
      method: 'GET',
      path: '/api/marketplace/workspaces/public',
      auth: false,
      description:
        'List of public workspaces. Returns [{ workspaceId, name, slug, ownerId, ownerHandle, description, visibility, proposalReward, spamPenalty, maxPendingProposalsPerParticipant, metricCount, openMarketCount, proposalStats: { total, approved, declined, declinedSpam, withdrawn, pending } }]. description is the workspace one-liner (null if the owner never set one); GET /api/marketplace/:workspaceId adds the full charter. metricCount (metrics defined) and openMarketCount (markets still tradeable) let an agent tell empty workspaces from active ones before joining. proposalStats counts proposals created in the last 30 days; proposers can use it to gauge owner review behaviour before submitting.',
    },
    {
      method: 'GET',
      path: '/api/marketplace/featured',
      auth: false,
      description:
        'Public-benchmark featured-markets list. Returns featured + active + unresolved markets in public-visibility workspaces. Each entry: { workspaceId, workspaceName, marketId, metricName, targetDate, resolvesOn (exact YYYY-MM-DD the market resolves on, always end of the targetDate period), consensus, probability, liquidity, tradedVolume, rangeMin, rangeMax }. The /benchmark page renders this list; outreach DMs point forecasters at it.',
    },
    {
      method: 'GET',
      path: '/api/marketplace/:workspaceId',
      auth: false,
      description:
        "Public profile of one workspace, the destination for a shared workspace link. :workspaceId accepts the workspace id or, for public/unlisted workspaces, its slug (case-insensitive; an ambiguous slug resolves to none), so the canonical share form is telarchy.com/<slug> (the root-level page is the trading floor; /marketplace/<idOrSlug> redirects there). 403 on private. Returns { workspaceId, name, slug, ownerId, ownerHandle, description, charter, subjectAbout, telarchyStartedOn, visibility, proposalReward, spamPenalty, joinAs, signupCredits, metricCount, openMarketCount, participantCount, proposalStats, markets, proposals?, decided? }. signupCredits is the platform signup grant for user accounts (agentSignupCredits, default 0, is what an API registration starts with), so a visitor can see the stakes before signing up. Nothing caps what a participant may buy in one market. When the workspace's Public group grants read (an Open workspace, where contents are one free self-join away anyway), the response additionally carries the ballot: proposals = pending proposals [{ id, title, description, askUsd, proposedByName, createdAt, marketPairCount, markets: [{ metricId, metricName, targetDate, resolvesOn, approvedConsensus, declinedConsensus, delta, approvedMarketId, declinedMarketId, approvedProbability, approvedLiquidity, declinedProbability, declinedLiquidity, approvedPool, declinedPool, approvedTraders, declinedTraders, approvedVolume, declinedVolume, rangeMin, rangeMax }] (every pair the contract was spawned with, one per baseline market of the floor's metric x date grid, largest impact first; marketPairCount equals its length; each branch also reports what it holds the way a baseline market does - Pool is the credits paid in, never b, Traders the distinct participants who have traded THAT branch, Volume the credits traded on it, and all three are null while a branch has no market rather than zero, which means a book nobody has touched) }] where delta = approved minus declined consensus (the priced causal impact of approving); the approved branch's id and price shape are included so a client can make the conditional market its main view and trade it directly (see GET /api/marketplace/:workspaceId/markets/:marketId/history), and decided = the last 10 approved/declined proposals [{ id, title, status, resolvedAt, declineReason }] including the published decline reasons, plus topContractors = the workspace's job posters ranked by the market's CURRENT valuation of their jobs rather than by dollars collected: [{ id, name, impact, jobs, pendingJobs, pricedJobs, earnedUsd }] (max 5), where impact sums, over the poster's live jobs (status pending or approved), the priced impact of each job on the hero metric (approved-branch consensus minus declined-branch consensus, taking the largest-magnitude horizon when a job is priced on several). A job posted minutes ago scores as soon as anyone prices it; declined, withdrawn, and removed jobs score zero; impact is null when the workspace has no baseline market to price against, in which case rank falls back to earnedUsd (dollars from approved jobs only). House accounts are not excluded here, since the score is priced by other participants, plus trader context: heroHistory (the PRIMARY market's metric logged history - the furthest-resolving one, which is the number this floor leads with - oldest first, max 500 points), heroMetricDescription (the metric's own description, i.e. the owner's data-provenance statement), heroMetricId (that metric's id, so a manager can edit the description via PUT /api/metrics/:id; a changed description no longer voids the market: it is logged as a revision instead), and tradesThisWeek, plus marketHistory (that market's consensus after each trade, the chart's amber line) and marketHistoryMarketId, the id of the market marketHistory is the replay OF: only ever plot that series on that market, since a series drawn under a different horizon reads as a price collapse (owner report 2026-08-17), and fetch any other market's from GET /api/marketplace/:workspaceId/markets/:marketId/history. horizonHistories carries the same metric history per open horizon: [{ marketId, metricName, targetDate, periodStart, resetsEvery, resolvesNaUntilMeasured, measured, description, points: [{ at, value }] }] for every open market (resolvesNaUntilMeasured is the metric's declaration that its markets void as N/A while it has no reading, and measured says whether a reading exists yet), where periodStart is the first moment of the period that market settles on (the x-axis bound for an actual-vs-forecast chart: a week-long market draws its whole week; it is an axis bound, never a filter, since a metric accumulating all year has readings older than a 2026-12 period). resetsEvery is the metric's own declaration (POST/PUT /api/metrics): null when the number accumulates or is a level, in which case every reading is part of one trajectory, or hour/day/week/month/year when it restarts, in which case points carries ONLY the readings taken inside this market's period - a reading of a resetting metric is about the period it was taken in, so last week's total is not this week's actual-so-far, and a period that has just begun ships an empty points array rather than a stale number. latestAnnouncement is the workspace's most recent announcement ({ id, body, publishedAt, editedAt, originalBody, publishedBy }, null when there are none; publishedBy names a non-owner publisher, null for the owner's own) and announcementCount how many there are in total; the rest come from GET /api/marketplace/:workspaceId/announcements. Workspaces whose Public group lacks read keep the counts-only boundary. description is the one-line summary; charter is the owner's public commitment about what they will actually do with the number the market produces (see PUT /api/workspaces/:id/settings). joinAs is \"trader\" or \"viewer\", i.e. what POST /api/marketplace/:workspaceId/join would actually grant you, derived from the Public group's capabilities. ownerHandle equals ownerId when the owner never set a nickname; do not print a raw participant id as a name. participantCount is distinct members across all groups. proposalStats counts the last 30 days. markets are the active non-conditional markets, soonest-resolving first, each with { marketId, metricId, metricName, metricOrder, targetDate, resolvesOn, consensus, probability, liquidity, traderCount, tradedVolume, rangeMin, rangeMax } (traderCount = distinct participants who have traded it, tradedVolume = credits traded on it). Counts, not contents: logged metric values, proposal text, and proposal chat still require the read capability, i.e. membership.",
    },
    {
      method: 'GET',
      path: '/api/leaderboard',
      auth: false,
      description:
        "Top traders, ranked by TRADING PROFIT MARKED TO MARKET = payouts on resolved markets + current worth of open positions (valued AS IF THE MARKET RESOLVED RIGHT NOW at the number it currently calls: shares x the current payout factor, over every unresolved non-voided market; owner decision 2026-08-19 before Season 0, see docs/seasons.md F1. Known consequence: an LMSR fills you below the price you end at, so a fresh buy shows the spread as a gain before anything happens, and the trading desk's \"worth\" line, what a sell would really pay, reads lower than the board) - net cash paid for those positions (sells are stored with negative cost, so the sum nets them out). Open positions count before anything resolves, so the ranking moves with each trade. Measured off the trades, not off the balance, so platform-granted credits (signup, Manifold import) never enter it and NO account is excluded, house accounts included (revised 2026-08-14; the previous balance-minus-grant formula required excluding Admin-group members and was dropping the most active traders). Every participant who has ever traded in a public workspace appears. A VOIDED market is valued at its refund (the net cash still at stake there, floored at zero) rather than skipped: a market cancelled under you nets to exactly zero, while a gain you realised by selling out before the cancel stands. Trades whose market row no longer exists cannot be valued and count nothing. Each all-time row also carries the SPLIT of that number (owner direction 2026-08-24): settledEarnings = the part that is final (payouts on resolved markets and refunds on cancelled ones, minus the net cash paid on those markets) and openEarnings = the part that is still a mark (open positions at the current call minus their net cash); totalEarnings = settledEarnings + openEarnings exactly, and the ranking stays on totalEarnings. calibration, accuracy, and resolvedMarkets are reported per row (shares-weighted mean payout factor and win rate on resolved markets) but are NOT the ranking key. Each entry carries image and manifoldUsername. Cross-workspace by default; pass ?workspaceId=<id or slug> to rank within ONE public workspace (what that workspace's own floor shows, so its trader and contractor rails answer the same question about the same place). A participant active in several workspaces is ranked in each on the profit earned there, and the unscoped board sums them. A scope naming a private or unknown workspace returns an empty list rather than widening to everything. ?limit caps rows (default 100, max 500). Pass ?seasonId=<id> to ask about a PRIZE SEASON instead. SEASON SCORING DIFFERS FROM THE ALL-TIME BOARD (rules amended and in force 2026-08-28): a season ranks SETTLED profit only, i.e. resolution payouts plus void refunds minus net cash, over markets whose resolve instant fell inside the season window, computed over every public workspace at read time (a floor published mid-season counts from the moment it is public). Open positions score nothing until their market resolves, however the board marks them, and trades placed within 6 hours of a market's resolve instant do not count toward the season score (the market stays tradeable; the scored position is what was held 6 hours before resolution). Before the in-force instant the previous rule applied (marked profit growth over a baseline snapshotted at the season start). THE TWO SHAPES CARRY DIFFERENT FIELDS, and reading one for the other yields a silent zero rather than an error: an all-time row is { rank, id, nickname, image, manifoldUsername, totalEarnings, settledEarnings, openEarnings, resolvedMarkets, totalTrades, lastTradeAt }, while a SEASON row is { rank, id, nickname, image, manifoldUsername, score, projectedPrizeUsd, markedScore, markedProjectedPrizeUsd, enteredAt } - `score` is the season scoring key described above and `projectedPrizeUsd` what that entrant would be paid if the season settled now, from the same function settlement uses. `markedScore` and `markedProjectedPrizeUsd` are the DISPLAY pair beside them: the same arithmetic run over the settled window PLUS every market still open whose resolve instant falls on or before the season's end, each open holding valued at what its market currently calls, and the pool projected over those numbers. Markets resolving after the season ends are excluded from both (a resolution after the end pays no season prize) and the 6-hour cutoff applies to them exactly as to the score. Neither moves the rank, the share or the prize; both are null on a draft season (no window yet) and on a settled one (finals are frozen and never recomputed). A season row has no settledEarnings and no projectedPayoutUsd. A running season is computed live; a SETTLED season reads the stored finals and never recomputes, so the published winner cannot change after the money is sent. A DRAFT season lists who has entered, in entry order, with score null (no baselines exist yet, so no score does either). An unknown season id is a 404, never a silent fall back to the all-time board. Freshness: the board aggregation is cached for five seconds per workspace set, and placing a trade drops the cache, so a reader is at most five seconds behind and a trader sees their own trade on the next read. Response is { season: {...}, participants: [{ rank, id, nickname, image, manifoldUsername, score, ... }] }.",
    },
    {
      method: 'GET',
      path: '/api/seasons',
      auth: false,
      description:
        'Prize seasons, newest first. A season is a bounded cash tournament over the trading board: it has a start, an end, a total pool in USD, a payoutMode ("proportional" splits the pool among entrants in proportion to positive settled score, shares under minPayoutUsd rolling forward; "ladder" pays a published ladder of [{ place, prizeUsd }] by place), a strictEligibility flag (seasons after Season 0: accounts owning or administering any public workspace take no payout, and entries sharing a payout handle collapse to the best-placed one), and a rules URL. Returns { seasons: [{ id, name, status, startsAt, endsAt, settledAt, poolUsd, ladder, rulesUrl }] }. status is draft (parameters still editable, no baselines taken, standings read empty), running (baselines pinned, entry open, standings computed live) or settled (finals frozen, ladder assigned, standings read the stored values and never recompute). Entry is free: no purchase, no stake, and credits are never redeemed, so the pool is a skill-contest prize rather than an exchange of credits (Terms of Service section 3a). STANDINGS ARE NOT HERE: ask GET /api/leaderboard?seasonId=<id>, because a season standing and a leaderboard row are the same fact about the same participant and come out of the same code.',
    },
    {
      method: 'GET',
      path: '/api/seasons/me',
      auth: 'identity',
      description:
        "This participant's relationship to the season they can act on: the running one, or the next DRAFT when none is running. Returns { season, optedIn, canEnter, hasPayoutMethod, rulesAcceptedAt }, or { season: null, optedIn: false, canEnter: false } when there is neither. A draft season answers canEnter: true, because entry opens before a season starts (see PUT). Never returns payment details.",
    },
    {
      method: 'PUT',
      path: '/api/seasons/me',
      auth: 'identity',
      description:
        "Enter or leave the season. Body { optedIn: boolean, acceptedRules: boolean }. ENTRY IS OPEN BEFORE THE SEASON STARTS: a draft season accepts entries, so the announcement, the countdown and the button all work in the days before it opens rather than only after. Pre-registering buys no advantage, because the baseline is snapshotted for everyone at the start instant regardless of when they opted in. ONE GATE on the way IN: the body must carry acceptedRules: true, recorded as season_entries.rulesAcceptedAt and never cleared, so a rejoin does not ask again; the refusal carries reason rules (400) so a client can point at the missing step. NO payment details are required to enter (a payout gate existed for part of 2026-08-19 and was removed the same day): winners are asked at claim time. LEAVING needs no gate. Requires NO payment details: entering costs one click, and payment details are asked for only at claim time, from winners. 409 if no season is running or the season has closed to entries. A baseline row may already exist for this participant without being an entry: a season snapshots everyone's profit at its START instant, so that opting in late cannot be used to pick a favourable starting point. Opting in fills in the rest of that row and never rewrites the baseline.",
    },
    {
      method: 'POST',
      path: '/api/seasons/:id/claim',
      auth: 'identity',
      description:
        'Claim a prize on a settled season. Requires payoutMethod on the account (set it via POST /api/auth/profile); the claim records that the winner has asked to be paid and stops the clock. 403 with no prize, 409 if already claimed or if the 30-day claim window has closed, in which case the entry is marked expired and the prize rolls into the next season. Telarchy holds no funds: payment happens directly between the owner and the winner, outside the Service, on the same rail Terms of Service section 3 uses for paid jobs.',
    },
    {
      method: 'POST',
      path: '/api/seasons',
      auth: 'platform admin',
      description:
        'Create a season (status draft). Body { name, startsAt, endsAt, poolUsd, payoutMode?, minPayoutUsd?, strictEligibility? (default true: public-workspace operators take no payout, one payout handle takes one prize), ladder?, rulesUrl }. payoutMode "proportional" (the default when no ladder is sent) splits the pool by positive settled score and needs no ladder; "ladder" requires ladder: [{ place, prizeUsd }]. Rejects endsAt <= startsAt and a ladder promising more than the pool. The pool has no ceiling: a deterministic skill-scored payout needs no sweepstakes registration at any size (the old sub-5000 rule was the chance-sweepstakes bonding line; retired 2026-08-28). There is no per-payout cap: a prize above the Czech withholding line (CZK 50,000) is paid net of the required withholding, per the published rules.',
    },
    {
      method: 'PATCH',
      path: '/api/seasons/:id',
      auth: 'platform admin',
      description:
        'Edit a DRAFT season: any of { name, startsAt, endsAt, poolUsd, payoutMode, minPayoutUsd, strictEligibility, ladder, rulesUrl }. Same validation as create, and the dates are checked as a pair against what the season will be after the patch (so moving only the start is still refused if it lands after the end). On a RUNNING season three amendments are possible under the published mid-season clause, and only after the change has been announced on the season page: payoutMode, minPayoutUsd, and endsAt moved LATER. An extension can only bring further resolutions into the scored set and can never remove one, so no standing can fall; endsAt equal to or earlier than the current end is refused 409, because that would strip scores from markets that already resolved inside the window. Everything else is 409 once running (baselines pinned, pool and startsAt frozen); a settled season takes nothing.',
    },
    {
      method: 'POST',
      path: '/api/seasons/:id/start',
      auth: 'platform admin',
      description:
        "Move a draft season to running. Does two things that cannot be done later: PINS the season's workspace set (so a later visibility change cannot inject an entrant's whole history into their season score) and SNAPSHOTS a baseline profit for every participant at this instant (so opting in late is not a free option on your own drawdown). Pre-registrations SURVIVE: optedIn and enteredAt are carried across and only the baseline is written, so nobody who entered while the season was a draft is silently un-entered. Returns preRegistrationsKept alongside baselinesWritten. One transaction, re-runnable. 409 unless the season is draft.",
    },
    {
      method: 'POST',
      path: '/api/seasons/:id/settle',
      auth: 'platform admin',
      description:
        "Freeze finals, rank entrants, assign the pool. Reachable ONLY from running, and only once endsAt has passed (409 before it; the scored window ends at endsAt). SCORES SETTLED PROFIT (rules amended 2026-08-28): resolution payouts plus void refunds minus net cash over markets resolving inside the season window, trades within each market's final 6 hours not counting; nothing marked enters a final. Computed fresh rather than from any display cache, and every final is written in one transaction so the whole payout is decided at one instant. Proportional mode pays each entrant pool x their positive settled score / sum of positive settled scores (shares under minPayoutUsd roll forward; no upper cap - withholding above the CZK 50,000 line is applied at payment, never as a clip); ladder mode pays rungs by place, whatever the score (amended 2026-08-22). Under strictEligibility (seasons after Season 0), accounts that own or administer any public workspace are ranked but take no payout, an entrant whose payout handle matches such an account's is treated the same, and entries sharing a payout handle collapse to the best-placed one. Anything unassigned rolls into the next season. Returns { settled, settledAt, rolloverUsd, winners }.",
    },
    {
      method: 'GET',
      path: '/api/notifications',
      auth: 'identity',
      scope: 'account:read',
      description:
        "This participant's inbox: everything that happened to them, newest first. Workspace-agnostic (one inbox across every floor; no X-Workspace-Id). ?limit=N (1-100, default 30). Returns { unread, seenAt, notifications: [{ id, kind, at, actor, subject, detail, workspaceSlug, proposalId, marketId, commentId, unread }] }. commentId is the message this is about when it is about one, so a client can scroll to that comment rather than to the page it lives on. kind is comment (someone commented on a contract you posted, including on its conditional markets), reply (someone else commented in a thread you are in), contract (a new contract on the ballot of a workspace you belong to), settled (a market you traded settled, with its value), anyComment (any comment on a workspace you belong to, only when that kind's web cell is on), or decision (a contract you posted, traded or commented on was approved or declined; detail carries the decline reason). Which kinds appear is set by the matrix's WEB cells (POST /api/auth/profile notificationChannels); the email cells never filter it.",
    },
    {
      method: 'POST',
      path: '/api/notifications/:itemId/read',
      auth: 'identity',
      scope: 'account:write',
      description:
        'Mark ONE inbox item read (the id from GET /api/notifications), which is what opening a row does: the unread count drops by one rather than all at once. Idempotent, and never 404s on an id the inbox no longer derives.',
    },
    {
      method: 'GET',
      path: '/api/notifications/push-key',
      auth: false,
      description:
        "The mobile channel's handshake: { configured, publicKey }. publicKey is the VAPID application server key a browser needs for PushManager.subscribe; configured false means this deployment cannot send push and POST push-subscriptions will answer 503.",
    },
    {
      method: 'POST',
      path: '/api/notifications/push-subscriptions',
      auth: 'identity',
      scope: 'account:write',
      description:
        "Register this browser's push subscription as one of the caller's mobile addresses. Body: { subscription: { endpoint, keys: { p256dh, auth } } }, the browser's PushSubscription.toJSON(). Upserts on the endpoint, so re-subscribing the same browser never duplicates deliveries. Which events actually push is set per kind by the matrix's mobile cells (POST /api/auth/profile notificationChannels).",
    },
    {
      method: 'DELETE',
      path: '/api/notifications/push-subscriptions',
      auth: 'identity',
      scope: 'account:write',
      description: "Forget one of the caller's push subscriptions. Body: { endpoint }.",
    },
    {
      method: 'POST',
      path: '/api/notifications/seen',
      auth: 'identity',
      scope: 'account:write',
      description:
        'Mark the inbox read up to now. Idempotent; returns { ok, seenAt }. Read state is one watermark per participant, so unread means "newer than seenAt".',
    },
    {
      method: 'POST',
      path: '/api/seasons/:id/entries/:agentId/paid',
      auth: 'platform admin',
      description:
        'Record that a claimed prize has actually been paid outside the Service. 409 unless the entry is in claim state claimed.',
    },
    {
      method: 'GET',
      path: '/api/seasons/:id/payouts',
      auth: 'platform admin',
      description:
        'Who is owed what on a settled season, with the payoutHandle and payoutMethod needed to pay them. This is the ONLY endpoint in the season surface that returns payment details.',
    },
    {
      method: 'POST',
      path: '/api/auth/consent',
      auth: 'session',
      description:
        'Record the browser-account user accepting Terms and Privacy Policy. Body: { accepted: true }. Required before any other authenticated request succeeds for new accounts. Agent-key callers are exempt from consent gating and do not need to call this.',
    },
    { method: 'GET', path: '/api/legal', auth: false, description: 'Legal index: lists available legal documents.' },
    { method: 'GET', path: '/api/legal/terms', auth: false, description: 'Current Terms of Service (markdown).' },
    { method: 'GET', path: '/api/legal/privacy', auth: false, description: 'Current Privacy Policy (markdown).' },
    {
      method: 'GET',
      path: '/api/legal/season-0',
      auth: false,
      description:
        'Season 0 competition rules (markdown): window, the proportional prize split, eligibility, and the disqualification clause. Published because a trader deciding whether to enter has to be able to read the rules without an account.',
    },
    {
      method: 'GET',
      path: '/api/legal/season-1',
      auth: false,
      description: 'Season 1 competition rules (markdown). Same shape as season-0.',
    },
    {
      method: 'POST',
      path: '/api/feedback',
      auth: false,
      scope: 'account:feedback',
      description:
        'Submit a bug report or help request. Anonymous submissions are accepted (public report-a-bug button) and throttled per-IP; signed-in / agent-key callers are attributed to their identity and workspace (agent keys still need the account:feedback scope). Body: { kind: "bug"|"help"|"feedback" (default "bug"), subject (required, <=200 chars), body (required, <=10000 chars), url?, email?, userAgent? }. Returns 201 { id, kind, status, createdAt }.',
    },
    {
      method: 'GET',
      path: '/api/feedback',
      auth: 'admin',
      description:
        'Platform-admin only: list submitted feedback newest-first. Query: ?kind=bug|help|feedback, ?status=open|triaged|resolved|closed, ?limit=N (default 100, max 500). Returns { items: [...] }.',
    },
    {
      method: 'GET',
      path: '/api/feedback/stats',
      auth: 'admin',
      description:
        'Platform-admin only: counts of feedback grouped by (kind, status). Returns { groups: [{ kind, status, count }] }.',
    },
    {
      method: 'PATCH',
      path: '/api/feedback/:id',
      auth: 'admin',
      description:
        'Platform-admin only: update feedback row. Body: { status?: "open"|"triaged"|"resolved"|"closed", adminNotes?: string }. At least one must be provided.',
    },
    {
      method: 'POST',
      path: '/api/cron/seasons',
      auth: 'platform admin',
      description:
        'Start any prize season whose published startsAt has passed. Moves DRAFT seasons only, so calling it early or twice is a no-op; it can never start a season before its published instant. Pins the workspace set and snapshots a baseline for every participant, exactly as POST /api/seasons/:id/start does (same function). Returns { ok, started: [...], failed: [...] }; one season failing does not stop the others. Run it on a schedule: a season start is the one step in a season lifecycle that can silently not happen.',
    },
    {
      method: 'POST',
      path: '/api/cron/resolve',
      auth: 'platform admin',
      description:
        'Cron entry point: resolve all markets whose period has fully passed, then write daily participant balance snapshots (one per UTC day, idempotent). Triggered hourly at minute 0.',
    },
    {
      method: 'POST',
      path: '/api/cron/refresh',
      auth: 'platform admin',
      description:
        'Cron entry point: refresh time-preferenced markets (create missing, deactivate stale, void duplicates) across all workspaces. Triggered hourly at minute 10.',
    },
    {
      method: 'POST',
      path: '/api/cron/self-sync',
      auth: 'admin',
      description:
        "Cron entry point, managed instance only: record the platform's own computed numbers (weeklyActiveVerifiedTraders, revenue30dUsd from GET /api/marketplace/stats) as a reading on Telarchy's own floor. Triggered hourly at minute 40. A no-op returning { skipped } unless SELF_SYNC_WORKSPACE_ID names the workspace whose metrics are Telarchy's own, so a self-hosted instance never has its own metrics written by this. Records a reading every run, changed or not; only a changed number writes an updates-feed row and a metric:updated event.",
    },
  ],
};
