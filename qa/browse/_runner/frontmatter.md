# Spec frontmatter format

Every spec under `qa/browse/<NN>-<category>/*.md` starts with a YAML
frontmatter block the runner reads. The block is human-editable; nothing
generates it.

```yaml
---
id: 04-markets-trade-and-sell
tags: [browse, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key]
timeout: 90s
goal-horizon: short          # short | long
goal-statement: |
  As a participant with credits, I can buy a directional position on a
  market and sell some of it back, ending with a balance and consensus
  consistent with the LMSR math.
---
```

## Field reference

- **id** (required): stable kebab id. Determines log filename and fixture
  namespace. Conventionally `<NN>-<category>-<short-name>`.
- **tags** (required): subset of:
  - `fast` — runs in <30s on a warm backend.
  - `slow` — needs longer (e.g. waiting on cron, on-chain settlement).
  - `browse` — uses the headless browser (`$B`).
  - `api-only` — pure HTTP, no browser.
  - `human` — has at least one step that can only be done by a person
    (real OAuth, screen reader). Skipped by default; `--human` opts in.
  - `multi-agent` — exercises ≥2 participants on shared state.
  - `ux` — subjective: looks, intuitiveness, ease. Mostly screenshot-and-judge.
  - `abuse` — security / overflow / injection.
- **isolation**: `workspace` (default), `user`, or `global`. See
  `isolation.md`.
- **parallel-safe**: `true` (default) or `false`.
- **needs**: capabilities the spec requires:
  - `auth` — at least one authenticated participant (browser session).
  - `master-key` — `$TT_ADMIN_KEY` must be set (admin-only flows).
  - `browse` — the gstack browse binary.
  - `telarchy-agents` — the bot service is running and reporting heartbeats.
  - `github-app` — GitHub App env (`GITHUB_APP_ID`, etc.) is configured.
  - `usdc-on` — `USDC_SETTLEMENT_ENABLED=true`.
- **timeout**: max wall clock for the spec's runnable bash blocks. Runner
  kills the worker after this. Default 60s.
- **goal-horizon**: `short` (the user is doing one thing in this session) or
  `long` (the spec spans multiple sessions / cron / external state). Long-
  horizon specs document how to fast-forward time or simulate the gap.
- **goal-statement**: one paragraph. What the user is trying to do, in
  user-language. Drives whether the spec is testing the right thing.

## Body convention

Every spec body has these sections in this order:

1. `## What this tests` — one paragraph. The behaviour under test, the
   surface(s) it touches, what makes the spec pass or fail.
2. `## Preconditions` — environment, fixtures, capabilities. Anything
   `tt_*` cannot create itself.
3. `## Setup` — one fenced ` ```bash run ``` ` block that sources
   `_runner/lib.sh`, sets up fixtures, declares cleanup hooks.
4. `## Tests` — numbered sub-sections, one tested behaviour per heading.
   Each step is concrete: a command and an expected post-condition, no
   vague "should look right".
5. `## Cleanup` — usually a single line: "registered via `tt_on_cleanup` in
   Setup". If the spec creates anything outside the auto-namespaced fixtures,
   document the manual cleanup here.
6. `## Known gaps` — followups, scenarios this spec doesn't cover yet.

## Runnable code blocks

The runner extracts and executes:

- ` ```bash ` (no tag) — runnable.
- ` ```bash run ``` ` — runnable.

It skips:

- ` ```bash skip ``` ` — documented sample, not executed.
- Any other language (` ```ts `, ` ```sql `, etc.).

If a block reads stdin from a previous block (e.g. captures a workspace id),
chain it via shell variables. The runner concatenates all runnable blocks
into one bash invocation, so variables persist across blocks.
