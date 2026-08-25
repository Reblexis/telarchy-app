# Isolation and parallelism

How browse-tests run in bulk without colliding on shared state.

## The problem

Most specs touch the same backend: one Postgres database, one workspace
(`default`), one master key, one BetterAuth user table, one bot service. Two
specs running in parallel can step on each other in subtle ways:

- Spec A creates a market at metric `X`; spec B refreshes markets for the
  same workspace and deduplicates A's market away.
- Spec A signs up `qa+happy@example.test`; spec B reuses the same email.
- Spec A trades 10 credits as the default user; spec B asserts the default
  user's balance is exactly 1000.
- Spec A deletes the workspace it created; spec B was about to read a market
  inside it.

The runner solves this with namespacing, not locking.

## Three isolation classes

Every spec declares one in its frontmatter. Default is `workspace`.

### `isolation: workspace` (default)

The spec creates a new workspace at start and deletes it at end. Everything
inside (metrics, markets, members, agents joined to it) goes with it. The
spec is otherwise free to create and destroy whatever it wants.

Workspace name is `tt-<spec-id>-<run-id>` — derived from `$TT_NS` in lib.sh.
Two parallel runs of the same spec get different `$TT_RUN_ID`s, so they
never collide. Cleanup is registered via `tt_on_cleanup` and runs on EXIT.

This is the default because it composes: a spec can do anything except touch
the `default` workspace and still parallelise freely.

### `isolation: user`

The spec creates a fresh BetterAuth user (`qa+<spec-id>-<run-id>@example.test`)
in addition to the workspace. Use this when the spec needs to assert
session-cookie behaviour (signup, OAuth handoff, account deletion).

The runner expects the spec to delete its user via `tt_rm_user`. If a spec
fails before cleanup, periodic GC cleans up rows matching `qa+%@example.test`.

### `isolation: global`

The spec mutates global state that cannot be namespaced: the `default`
workspace, system-wide cron, the bot service config, master-key permissions.
Specs marked `global` always run serialised, after all parallel-safe specs.

Reserve this for genuinely cross-cutting tests: rate-limit measurement,
USDC kill-switch toggle, workspace deletion. If you find yourself reaching for
`global` because a feature happens to live on the default workspace, stop —
either move the test to a fresh workspace or fix the feature so it doesn't
require a specific workspace.

## Parallel-safe flag

`parallel-safe: false` forces serial execution even within an isolation class.
Use it for specs whose timing depends on external services (e.g. tests that
expect the bot service to complete a cycle within `pollInterval` — running
two of those in parallel doubles the pressure on the API and skews the
timing assertions).

`parallel-safe: true` is the default for `workspace` and `user` isolation.

## Concurrency limit

`run.sh --jobs N` caps the number of worker processes (default 4). The
limiting factor is usually the headless browser: each browse-driven spec
spawns a Chromium that takes ~150 MB. On a 16 GB machine, jobs=8 is fine for
API-only specs but jobs=4 is safer when most specs use `$B`.

Inside a single spec, every `$B` command shares one daemon, so a spec is
effectively serialised internally. Parallelism is between specs only.

## Why not Docker / a separate database per worker?

Considered and rejected for now. A throwaway Postgres per worker would solve
the cleanup question outright but adds maintenance: schema migrations have to
run per worker, fixtures (master key, default workspace, bot service auth)
have to be seeded per worker, and the runner becomes responsible for tearing
the DB down. Namespacing achieves the same isolation for ~99% of specs
because Telarchy already partitions data by workspace.

Revisit if the namespace prefix collisions show up in practice.

## Authoring rules

1. **Never reference `default` as a workspace** in a spec. Always create one.
2. **Never reference fixed emails** (`viktor.cihal@gmail.com`) in a spec.
   Mint a fresh one with `tt_mkuser`.
3. **Always register cleanups** with `tt_on_cleanup` so a spec that fails
   mid-way still tears down its fixtures.
4. **Use `$TT_NS`** as a prefix for any name a human might see in the DB
   (workspace name, agent id, source name) so post-mortem cleanup is grep-able.
5. **Don't sleep** unless you must (timing-dependent tests). Polling
   `tt_admin_curl ... | jq` until a condition is met is preferred.
