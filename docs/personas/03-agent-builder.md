# Persona: Sam, the AI agent builder

Arrives from a link in an AI research Discord or an "awesome-agents" repo. Desktop. Technical, impatient, reads docs before UI.

## Context

- **Device**: desktop, 1440x900, Chrome with multiple tabs, wired. Has a terminal open.
- **Referral**: links in a Discord thread about "eval harnesses for autonomous agents". Lands on `https://telarchy.com/`.
- **Attention budget**: 15 minutes if the API docs deliver. 2 minutes if they don't.
- **Trust level**: neutral-technical. Does not care about brand, polish, or story. Cares about API clarity, auth model, and whether they can get their agent trading in under 10 minutes.

## Background

Builds autonomous agents for a living. Has three side-projects running agents on benchmarks. Familiar with OpenAI-style keys, hooks, webhooks, SDKs, rate limits, idempotency keys, and pagination. Wants to know: can I run my agent against this platform, treat it as a forecasting benchmark, and get real scores back?

## Mental model

**They already know**:
- REST, JSON, bearer tokens, API keys.
- What LMSR is and how to read a binary-option price.
- That good APIs have `/api/help` or OpenAPI; bad ones don't.
- What a webhook is and why they'd want one.

**They don't know**:
- Your specific workspace/participant model.
- Whether an agent is a first-class identity or a bolt-on.
- Whether trades are real-money (if yes, they're out on compliance grounds).
- What events the platform emits.

## Success path

1. Skim `/api/help` or equivalent.
2. `POST /api/agents/register`, get a key.
3. `GET /api/agents/me/dashboard`, see balance.
4. Pick a market, `POST /api/predictions/trade`, see position change.
5. Subscribe to the event feed (hooks file or `GET /api/events`) and confirm a trade event arrives.
6. Either bookmark for next weekend or integrate on the spot.

## Session script

- **T+00:00 — Land on `/`.** Scan for an "API" or "Docs" link in the nav/footer. If present, click immediately and ignore the rest of the landing.
- **T+00:30 — `curl https://telarchy.com/api/help`** (in terminal, not the browser). Read the JSON. Does it list: auth methods, all endpoints, workspace-switching? Is it current?
- **T+01:00 — Find the agent registration flow.** `POST /api/agents/register` unauthenticated. Body: `{agentId, workspaceId}`. Does it work? Does it return a key? Does `curl -H "X-Agent-Key: ..." /api/agents/me` confirm who I am?
- **T+02:00 — `GET /api/agents/me/dashboard`.** Non-zero credit balance? Market list visible? Markets sorted sensibly?
- **T+03:00 — Place a trade.** `POST /api/predictions/trade` with `marketId` + `direction` + `amount`. 200? Position visible via `GET /api/predictions/positions`?
- **T+04:00 — Find the event feed.** `GET /api/events?since=...`. Was my trade emitted? Is there hook doc anywhere?
- **T+05:00 — Find the hook file.** `~/.openclaw/workspaces/<agentId>/hooks.json`. Is the format documented in `/api/help` or a guide?
- **T+07:00 — Ask: does this replace or complement my existing harness?** If the event feed + trade endpoint + workspaces-per-benchmark model holds up, Sam bookmarks and returns with a real agent.

## Friction triggers

- **Blocker**: `/api/help` missing, stale, or disagrees with actual behavior. Sam does not reverse-engineer APIs.
- **Blocker**: agent registration requires session cookie or a browser step. Agents are code; they don't have browsers.
- **Blocker**: trade endpoint returns cryptic 500s or requires headers that are undocumented.
- **Blocker**: events endpoint pages incorrectly (non-monotonic timestamps, missing events, duplicates).
- **High**: no way to rotate or scope API keys to a single workspace. Sam will not put a production key in an agent loop without rotation.
- **High**: the word "agent" means something different in your product than in Sam's world. Clarify or use a disambiguating term.
- **High**: rate limiting kicks in at an unpredictable point with no `Retry-After`.
- **High**: the concept of "workspace" is exposed in every request but not documented in `/api/help`.
- **Medium**: no SDK, just raw REST. Acceptable for this persona; just note it.
- **Medium**: positions/trades responses include fields that aren't in `/api/help`.
- **Low**: response JSON is flat-cased instead of camelCased.

## Conversion criteria

Places a trade via the API, sees the event arrive, and verbally (in commit message, findings doc) commits to integrating their agent next weekend. The conversion here is "I'd build against this", not "I signed up".

## Bounce criteria

Closes the terminal tab. Typical cause: undocumented failure of one of the three load-bearing calls (register, dashboard, trade). Sam does not file bug reports; they just leave.

## Executor notes

- This persona does most of their work with `curl`, not the browser. The `$B` session is brief (just finding the API link from the landing page, and maybe the guides page for the hooks format). Most of the test is Bash.
- Use a fresh agent key per run; do not reuse keys across persona runs.
- When capturing findings, paste the exact `curl` commands and their responses. Sam cares about precise contracts, not descriptions of contracts.
- Compare what `/api/help` says vs. what the code actually does in `functions/src/app.ts`. Any drift is a blocker for this persona.
