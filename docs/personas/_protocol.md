# Persona walkthrough protocol

How to run a persona test, and what to produce when done. Shared across every persona file in this directory.

## Why personas

Feature tests tell us a button works. Persona walkthroughs tell us whether a stranger with a specific mental model can succeed at something they care about before giving up. These two things fail independently. A screen can pass every unit test and still lose every new user in the first thirty seconds.

A persona is a cheap proxy for a real user. It is not a marketing document; it is a test fixture. Treat the persona's context (device, attention budget, trust level, prior knowledge) as the hard constraints of the test. Do not exceed them to make the product look better.

## What counts as friction

When executing a persona, flag anything in these categories:

- **Dead end**: the persona knows what they want to do next and cannot find the path to it within their attention budget.
- **Trust break**: a typo, a stale year, a broken link, a generic stock photo, raw JSON output, a stack trace, obviously AI-generated filler text, a value of `null` shown as text, a date formatted as `1970-01-01`.
- **Confusion**: the persona arrives at a screen and cannot answer "what is this for, and what do I do next?" within 5 seconds.
- **Premature commitment**: the product asks for an input (name, email, permission) before the persona has enough information to want to give it.
- **Silent failure**: an action that should do something appears to do nothing (no toast, no redirect, no updated state) even if the backend succeeded.
- **Scope surprise**: a signup gate appears where the persona expected to be able to look first.
- **Persona-conflict**: copy, imagery, or defaults that signal the product is not for this persona even though they are part of the target audience.

Severity tags for findings: **blocker** (persona would bounce), **high** (persona would hesitate, possibly bounce), **medium** (noticed but would continue), **low** (polish).

## Tooling

Use gstack `browse` (`$B`) as the canonical browser-driver for these scripts. It's a persistent headless Chromium with the same primitives Playwright MCP exposed (goto, click, fill, snapshot, console, network, screenshot, viewport resize). The previous `browser_navigate` / `browser_console_messages` references in this directory map directly to `$B goto` / `$B console`. See `qa/browse/README.md` for the command cheat sheet and per-feature scripts.

## How to execute

One persona per session. Do not blend observations from multiple personas into a single test.

1. **Cold-start the browser context.** Each persona starts with no cookies, no localStorage, no prior auth, no cached assets unless the persona file says otherwise. Use a fresh `$B` session (`$B stop` then a new command auto-restarts it), or `$B state save <name>` / `$B state load <name>` to switch between known-good fixtures.
2. **Enter the site through the referral channel named in the persona.** A persona that arrives from Hacker News lands on the root page after following a link; a persona that arrived from a mobile share link lands on `/marketplace/<workspaceId>`. Do not just `$B goto` to whatever is convenient.
3. **Set the viewport to the persona's device profile** before the first navigation: `$B viewport 1440x900` (desktop), `1280x800` (laptop), `390x844` (phone, iPhone 15), `820x1180` (tablet portrait).
4. **Start a timer.** The persona has an explicit attention budget. When that budget is spent, the test ends. If the persona has not yet reached their conversion milestone by then, the outcome is "bounce".
5. **Follow the session script in order.** At each step, ask yourself the persona's question ("if I were them, what would I do next?"). Script deviations are allowed and expected; note them.
6. **Capture evidence.** Screenshot every screen the persona sees with `$B screenshot <path>` (or `$B snapshot -a -o <path>` for a refs-annotated version), especially at friction points. Use `$B console` and `$B network` to catch errors invisible to the user.
7. **Do not break character to make the test pass.** If the persona would not read a tooltip, do not hover to get past a confusing label. If the persona would not open devtools, do not use devtools.
8. **Stay in sandbox.** Do not complete real OAuth flows. Use fresh email aliases of the form `qa+<persona-id>-<timestamp>@example.test`. Never trade with real USDC (settlement is off anyway).

## Findings template

Produce this block per run, either inline in conversation or as a new file under `docs/personas/findings/<persona-id>-YYYY-MM-DD.md`:

```markdown
# Persona findings: <persona name>
Date: YYYY-MM-DD. Executor: Claude. Budget: <N min>. Used: <M min>.

## Outcome
<converted | partial | bounced>. One-sentence summary.

## Session log
1. T+00:00 — action — observation.
2. T+00:15 — action — observation.
...

## Friction found
- [blocker] description — screenshot ref — which persona step.
- [high] description — screenshot ref — which persona step.
- [medium] ...
- [low] ...

## What worked
- Specific moments where the product matched or exceeded the persona's expectations.

## Would they come back?
<yes | no | maybe>. Why.

## Recommended changes
- [priority] concrete change, scoped to this persona's friction.

## Console / network anomalies
- Any 4xx/5xx, console errors, slow requests captured via `$B console` / `$B network`.
```

## Re-running

Persona tests should be cheap to re-run after any material UX change (landing copy, signup flow, onboarding, dashboard, marketplace). A change that affects multiple persona files is a signal the change is large. Re-run only the personas whose script intersects the changed surface.

## Complement to feature tests, not replacement

Persona walkthroughs complement `docs/mvp-evaluation/plan.md`. If a persona fails at step 4 because the backend returned 500, that's a bug that feature tests should have caught; file it against the relevant feature, not the persona. Persona findings are reserved for the UX-layer gaps that feature tests can't see.
