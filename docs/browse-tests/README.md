# Browse-test scripts

Per-feature, browser-runnable test specs for `telarchy.com`. Each spec is a
Markdown file with YAML frontmatter and concrete `browse` (`$B`) +
`curl` commands. The runner extracts the bash blocks and executes them.

## Why these exist

| Layer | File(s) | Question it answers |
| --- | --- | --- |
| Feature checklist | `docs/mvp-evaluation/plan.md` | Does every feature behave as specified? |
| Persona walkthroughs | `docs/personas/*.md` | Will a specific kind of stranger succeed? |
| First-time-user flow | `docs/user-flow-audit.md` | Does the activation funnel hold together end-to-end? |
| **This directory** | `docs/browse-tests/**.md` | Per-feature, runnable, parallelisable test specs |

The other layers are reference material; this one is what you *run*.

## Running

```bash
# everything (skips human-only)
docs/browse-tests/_runner/run.sh

# one category
docs/browse-tests/_runner/run.sh 04-markets

# one spec
docs/browse-tests/_runner/run.sh 04-markets/void-and-resolve.md

# filter by tag (fast / slow / browse / api-only / multi-agent / ux / abuse / cold)
docs/browse-tests/_runner/run.sh --tag fast
docs/browse-tests/_runner/run.sh --tag multi-agent

# parallelism (default 4 workers)
docs/browse-tests/_runner/run.sh --jobs 8
docs/browse-tests/_runner/run.sh --no-parallel  # serial, easier debugging

# auto-grade UX specs via `claude -p` (see _runner/grading.md)
docs/browse-tests/_runner/run.sh 12-ux --grade

# preview which specs would run
docs/browse-tests/_runner/run.sh --dry-run 11-multi-agent

# include human-handoff specs (real OAuth, GitHub install)
docs/browse-tests/_runner/run.sh --human

# write the results report somewhere stable
docs/browse-tests/_runner/run.sh --report ./qa-report.md

# resume an interrupted run (uses qa-runs/latest by default)
docs/browse-tests/_runner/run.sh --resume

# resume + re-run failures
docs/browse-tests/_runner/run.sh --resume --retry-failed

# resume into a specific run dir
docs/browse-tests/_runner/run.sh --resume qa-runs/20260426-083141
```

Output now lives under `qa-runs/<timestamp>/` (gitignored) with a
`qa-runs/latest` symlink, so a reboot or crash mid-run no longer wipes
state. Each spec produces `<id>.log`, `<id>.report.md`, and an
`evidence/<id>/` directory copied out of `/tmp/tt-<id>-*` after it finishes.
A `done` sentinel file is written when the aggregator completes.

Required env (set once per session):

```bash
export TT_BASE_URL=http://localhost:8080            # backend
export TT_FRONTEND_URL=http://localhost:5173        # vite
export TT_ADMIN_KEY=mtrk_a7f3x9kL2pQw8vNdR4jY6mBs   # master key (see AGENTS.md)
```

## What you get back

Every run writes `results.md` with:
- pass / fail / duration table for every spec,
- the goal-statement of each spec (so the report is self-explanatory),
- inline tail of every failure log,
- (with `--grade`) embedded LLM verdicts for UX specs.

Per-spec logs land in the same directory: `<id>.log` per spec, plus
`/tmp/tt-<id>-*` directories with screenshots and findings dumps.

## How parallelism stays safe

See `_runner/isolation.md` for the long version. Short version: every
spec declares an isolation class (`workspace`, `user`, `global`). Specs
in the first two run in parallel because they namespace their fixtures
(workspace + agent + user) by `$TT_RUN_ID`; `global` specs serialise.
Specs declare `parallel-safe: true|false` to opt out individually.

## Authoring

- Spec format: `_runner/frontmatter.md`
- Helper library: `_runner/lib.sh` (`tt_mkworkspace`, `tt_mkagent`,
  `tt_mkuser`, `tt_credit`, `tt_admin_curl`, `tt_on_cleanup`, …)
- Subjective grading: `_runner/grading.md`
- Gold-standard template: `07-admin/bot-agents-panel.md`

## Specs by category

Each spec opens with a `goal-statement` in plain English so the report
explains itself.

### 00-anonymous (cold visitor)

| File | Surface |
| --- | --- |
| `landing.md` | `/` first paint, footer links, viewport coverage |
| `marketplace-public.md` | Anonymous `/marketplace`, share-link, OG meta |
| `leaderboard.md` | Anonymous `/leaderboard`, calibration ranking, register CTA |
| `legal.md` | `/terms`, `/privacy`, ToS clauses |
| `waitlist.md` | `POST /api/waitlist` + dedup + rate limit |
| `seo-and-og.md` | `robots.txt`, `sitemap.xml`, OG/Twitter cards, no trackers |

### 01-auth

| File | Surface |
| --- | --- |
| `signup-and-login.md` | `/signup` + `/login` round-trip |
| `consent-and-profile.md` | `POST /api/auth/consent` + `/api/auth/profile` |
| `account-deletion-and-export.md` | GDPR export + delete |
| `oauth-handoff.md` | Google + GitHub OAuth (human handoff) |

### 02-workspaces

| File | Surface |
| --- | --- |
| `create-from-templates.md` | Template picker, blank/personal/startup |
| `switch-and-active.md` | Sidebar switcher + `localStorage.activeWorkspaceId` |
| `settings-and-visibility.md` | Name + visibility + auto-fund |
| `members-and-permissions.md` | Role matrix (admin / trader / member / viewer) |
| `welcome-tour.md` | Seeded starter proposal + 12-step product tour |
| `first-seen-hints.md` | Once-per-user contextual hints (Markets, proposal drawer) |

### 03-metrics

| File | Surface |
| --- | --- |
| `check-in.md` | `/check-in` auto-save, clamp, theme toggle |
| `create-edit-delete.md` | `POST/PUT/DELETE /api/metrics` |
| `formulas.md` | Cross-metric formulas, cycles, NaN, big numbers |
| `history-and-logs.md` | `/api/metrics/:id/logs`, purge |
| `unicode-and-injection.md` | RTL, emoji, XSS, SQLi corpus |

### 04-markets

| File | Surface |
| --- | --- |
| `browse-and-trade.md` | Market list, trading panel, position panel |
| `liquidity-management.md` | Add/remove liquidity, bulk |
| `void-and-resolve.md` | Resolve at metric value, void + refund |
| `conditional-markets.md` | Proposal-linked conditional lifecycle |

### 05-proposals

| File | Surface |
| --- | --- |
| `propose-approve-decline.md` | Full proposal lifecycle |
| `chat-thread.md` | `GET/POST /api/proposals/:id/messages` |

### 06-participants

| File | Surface |
| --- | --- |
| `account-page.md` | `/account` (balance, trades, P&L, export, delete) |
| `balance-and-trades.md` | `GET /api/agents/:id/{balance,dashboard,trades,market-pnl}` |
| `agent-portal.md` | `/agent-portal/<id>` post-key |
| `agent-register.md` | `POST /api/agents/register` (anon → key) |
| `api-tab-keys.md` | `/api` tab: mint/list/revoke own keys + scope intersection |
| `api-create-agent.md` | `POST /api/agents` (authenticated create with scoped key + memberships) |

### 07-admin

| File | Surface |
| --- | --- |
| `bot-agents-panel.md` | `/admin` Bot agents + decision traces (gold standard) |
| `activity-feed.md` | `GET /api/admin/activity` |
| `treasury-and-credit.md` | `/api/agents/treasury` + manual credit/spend |
| `reset-economy.md` | `POST /api/reset-economy` |

### 08-feedback

| File | Surface |
| --- | --- |
| `submit-bug-and-help.md` | `POST /api/feedback` + UI modal |
| `inbox-admin.md` | `GET /api/feedback` + `/stats` |
| `triage-status.md` | `PATCH /api/feedback/:id` |

### 09-sources

| File | Surface |
| --- | --- |
| `text-source-crud.md` | Text sources + per-group permissions |
| `github-bridge.md` | GitHub App install + connect repo (human handoff) |

### 10-guides

| File | Surface |
| --- | --- |
| `render-pages.md` | `/guides/*` markdown render |
| `api-help-discoverability.md` | `GET /api/help` runtime parity |
| `auth-and-keys-guide.md` | new `auth-and-keys`, `recipes`, `api-reference` guide sections |

### 12-ux (additions)

| File | Surface |
| --- | --- |
| `guides-structure.md` | Stripe-style category groups in the sidebar + breadcrumb + prev/next |

### 11-multi-agent

| File | Surface |
| --- | --- |
| `two-traders-converge.md` | Opposing positions, LMSR convergence |
| `bot-trades-on-human-metrics.md` | The headline alignment-layer flow |
| `conditional-with-outsider.md` | Proposal + 4-actor conditional lifecycle |
| `workspace-membership-ladder.md` | Stranger → reader → trader → admin |
| `concurrent-trade-race.md` | 20 parallel trades, AMM invariants |
| `api-vs-ui-symmetry.md` | UI ↔ API equivalence (runtime) |

### 12-ux (subjective: grade with `--grade` or by hand)

| File | Surface |
| --- | --- |
| `first-five-minutes.md` | Stranger to "first useful moment" |
| `cold-walk-stranger.md` | Zero-prior-knowledge first impression |
| `persona-hn-skeptic.md` | HN skeptic, 3-min budget |
| `persona-qs-hobbyist.md` | QS hobbyist, personal goals |
| `persona-startup-founder.md` | Founder pricing decisions |
| `persona-day-2-return.md` | Returning user, reactivation |
| `persona-phone-visitor.md` | Share-link on phone (390×844) |
| `persona-agent-builder.md` | Developer building bots, pure curl |
| `persona-decision-maker.md` | Non-engineer asked to approve |
| `usefulness-test.md` | Real decision goal end-to-end |
| `delight-and-amazement.md` | Wow moments inventory |
| `weird-behavior-hunt.md` | Exploratory edges + state desync |
| `empty-states.md` | Brand-new account every page |
| `error-recovery.md` | Wrong password, dup email, network fail |
| `mobile-feel.md` | 390×844 layout + tap targets |
| `consistency-audit.md` | Cross-page typography + colour + copy |
| `jargon-and-language.md` | Vocabulary discipline (per AGENTS.md) |
| `copy-quality.md` | Every visible string, one dossier |

### 13-infra-and-abuse

| File | Surface |
| --- | --- |
| `status-and-health.md` | `/api/status`, CORS, cold-start |
| `rate-limits.md` | Global, registration, trade limiters |
| `auth-boundary-matrix.md` | Anon / wrong-ws / wrong-role / owner matrix |
| `xss-and-injection.md` | Stored XSS, path traversal, SQLi attempts |
| `usdc-killswitch.md` | All USDC routes 503; UI hidden |
| `cron-and-refresh.md` | Idempotency of `/cron/*` and refresh |

## Browse cheat sheet

The runner sets `$B` for you; when authoring outside the runner:

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
B=""
[ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ] && B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
[ -z "$B" ] && B="$HOME/.claude/skills/gstack/browse/dist/browse"
```

| What | Command | Notes |
| --- | --- | --- |
| Open a page | `$B goto $TT_FRONTEND_URL/admin` | Auto-starts the headless server |
| Resize viewport | `$B viewport 1440x900` | Or `390x844` for phone |
| List interactive refs | `$B snapshot -i` | Returns @e1, @e2, … refs and labels |
| Read page text | `$B text` | Cleaned text, easy to grep |
| Click | `$B click @e3` | Or any CSS selector |
| Fill input | `$B fill @e3 "value"` | Or `$B fill #email "x@y"` |
| Wait for navigation | `$B wait --networkidle` | 15s timeout |
| Assert state | `$B is visible ".panel"` | Other props: enabled, checked, focused |
| Console errors | `$B console --errors` | Filter to errors/warnings |
| Network log | `$B network` | JSON; pipe to jq |
| Screenshot | `$B screenshot /tmp/x.png` | Full page; add `--selector .panel` to crop |
| Diff a region | `$B snapshot -D` | Unified diff vs previous snapshot |
| Save/load state | `$B state save anon` / `$B state load anon` | Cookies + URLs |
| Hand off to user | `$B handoff "Need OAuth"` | Opens visible Chrome for human takeover |
