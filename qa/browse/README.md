# Browse-test scripts

Per-feature, browser-runnable test specs for `telarchy.com`. Each spec is a
Markdown file with YAML frontmatter and concrete `browse` (`$B`) +
`curl` commands. The runner extracts the bash blocks and executes them.

## Why these exist

| Layer | File(s) | Question it answers |
| --- | --- | --- |
| Feature checklist | the feature plan in the umbrella's private notes (notes/telarchy-app-private/) | Does every feature behave as specified? |
| Persona walkthroughs | the persona fixtures in the umbrella's private notes (notes/telarchy-app-private/) | Will a specific kind of stranger succeed? |
| First-time-user flow | the user-flow audit in the umbrella's private notes (notes/telarchy-app-private/) | Does the activation funnel hold together end-to-end? |
| **This directory** | `qa/browse/**.md` | Per-feature, runnable, parallelisable test specs |

The other layers are reference material; this one is what you *run*.

## Running

```bash
# everything (skips human-only)
qa/browse/_runner/run.sh

# one category
qa/browse/_runner/run.sh 04-markets

# one spec
qa/browse/_runner/run.sh 04-markets/void-and-resolve.md

# filter by tag (fast / slow / browse / api-only / multi-agent / ux / abuse / cold)
qa/browse/_runner/run.sh --tag fast
qa/browse/_runner/run.sh --tag multi-agent

# parallelism (default 4 workers)
qa/browse/_runner/run.sh --jobs 8
qa/browse/_runner/run.sh --no-parallel  # serial, easier debugging

# auto-grade UX specs via `claude -p` (see _runner/grading.md)
qa/browse/_runner/run.sh 12-ux --grade

# preview which specs would run
qa/browse/_runner/run.sh --dry-run 11-multi-agent

# include human-handoff specs (real OAuth, GitHub install)
qa/browse/_runner/run.sh --human

# write the results report somewhere stable
qa/browse/_runner/run.sh --report ./qa-report.md

# resume an interrupted run (uses qa-runs/latest by default)
qa/browse/_runner/run.sh --resume

# resume + re-run failures
qa/browse/_runner/run.sh --resume --retry-failed

# resume into a specific run dir
qa/browse/_runner/run.sh --resume qa-runs/20260426-083141
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
export TT_ADMIN_KEY=$TELARCHY_MASTER_KEY            # from keyring/telarchy/master.env (see AGENTS.md)
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
- Gold-standard template: `07-admin/cockpit-page.md` (the old pointer,
  `bot-agents-panel.md`, went with the console)


## Deleted with the console (2026-08-19)

The old GUI was removed from the app at the owner's direction, so the specs
that drove it were removed here: the workspace-tab walkthroughs
(`02-workspaces/activity-tab`, `create-from-templates`, `first-seen-hints`,
`switch-and-active`, `tab-banners`, `welcome-tour`), `03-metrics/check-in`,
`05-proposals/propose-approve-decline`, `06-participants/account-page` and
`agent-portal`, `07-admin/agents-control-pages` and `bot-agents-panel`,
`09-sources/*`, `10-guides/render-pages`, and the console-shaped UX specs
(`12-ux/welcome-canvas`, `guides-structure`, `persona-startup-founder`,
`persona-qs-hobbyist`). Git history holds them.

Specs that only visit a dead page in some of their steps carry a **Stale
since 2026-08-19** banner instead of being deleted; rewrite those steps
against the floor.

**Known gaps this leaves**, in priority order:

1. Proposing a proposal and the owner approving or declining it, on the
   floor. This is a live, load-bearing flow with no browser spec since
   `05-proposals/propose-approve-decline` was deleted.
2. The floor itself (chart, ticket, rails, branch toggle) has no dedicated
   category; `00-anonymous/public-workspace-page` covers the anonymous view
   only.
3. The account dialog beyond the email switches: payout details, credits,
   season claim, password.

## Specs by category

Each spec opens with a `goal-statement` in plain English so the report
explains itself.

### 00-anonymous (cold visitor)

| File | Surface |
| --- | --- |
| `landing.md` | `/` first paint, footer links, viewport coverage |
| `marketplace-public.md` | Anonymous `/` (the market list, home since 2026-08-20; `/marketplace` redirects), share-link, OG meta |
| `public-workspace-page.md` | Anonymous `/marketplace/:workspaceId`: charter, join CTA, market cap, counts-not-contents boundary |
| `leaderboard.md` | Anonymous `/leaderboard`, calibration ranking, register CTA |
| `legal.md` | `/terms`, `/privacy`, ToS clauses |
| `about-contact.md` | `/about` (positioning copy, wedge + calibrated clause) and `/contact` (support email, Discord, waitlist), footer reachability |
| `waitlist.md` | `POST /api/waitlist` + dedup + rate limit |
| `ask-the-floor.md` | The workspace brief + the Ask field: answers from the floor's own facts, and the agent prompt |
| `data-room.md` | Anonymous `/data-room` and `GET /api/data-room`: the prose, the live figures, the traffic rollup, the change log |
| `seo-and-og.md` | `robots.txt`, `sitemap.xml`, OG/Twitter cards, no trackers |

### 01-auth

| File | Surface |
| --- | --- |
| `signup-and-login.md` | `/signup` + `/login` round-trip |
| `consent-and-profile.md` | `POST /api/auth/consent` + `/api/auth/profile` |
| `account-deletion-and-export.md` | GDPR export + delete |
| `oauth-handoff.md` | Google + GitHub OAuth (human handoff) |
| `email-notifications.md` | The Emails switches in the account dialog + the `#account` deep link |

### 02-workspaces

| File | Surface |
| --- | --- |
| `settings-and-visibility.md` | Name + visibility + auto-fund |
| `members-and-permissions.md` | Role matrix (admin / trader / member / viewer) |
| `operator-door.md` | Otto's setup conversation, the handoff prompt and `GET /api/setup/checklist` |

### 03-metrics

| File | Surface |
| --- | --- |
| `create-edit-delete.md` | `POST/PUT/DELETE /api/metrics` |
| `custom-horizons.md` | `timePreference.customHorizons` market lifecycle + validation |
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
| `limit-orders.md` | Resting orders: reserve, fill at the limit, cancel, refund |
| `ticket-preview-parity.md` | The ticket's shown New value equals the landed value (netting, typed targets) |

### 05-proposals

| File | Surface |
| --- | --- |
| `chat-thread.md` | `GET/POST /api/proposals/:id/messages` |
| `edit-proposal.md` | `PATCH /api/proposals/:id`: words in place, price only before the first trade |

### 06-participants

| File | Surface |
| --- | --- |
| `balance-and-trades.md` | `GET /api/agents/:id/{balance,dashboard,trades,market-pnl}` |
| `agent-register.md` | `POST /api/agents/register` (anon → key) |
| `api-tab-keys.md` | `/api` tab: mint/list/revoke own keys + scope intersection |
| `api-create-agent.md` | `POST /api/agents` (authenticated create with scoped key + memberships) |
| `season-entry.md` | Prize season: floor strip, published rules, one-click entry, standings column |
| `season-claim.md` | Prize season: final standings, claim flow, payment-detail privacy |

### 07-admin

| File | Surface |
| --- | --- |
| `activity-feed.md` | `GET /api/admin/activity` |
| `cockpit-page.md` | `/admin` page + `GET /api/admin/floor-stats` gating |
| `treasury-and-credit.md` | `/api/agents/treasury` + manual credit/spend |

### 08-feedback

| File | Surface |
| --- | --- |
| `submit-bug-and-help.md` | `POST /api/feedback` + UI modal |
| `inbox-admin.md` | `GET /api/feedback` + `/stats` |
| `triage-status.md` | `PATCH /api/feedback/:id` |

### 10-guides

| File | Surface |
| --- | --- |
| `api-help-discoverability.md` | `GET /api/help` runtime parity |
| `auth-and-keys-guide.md` | new `auth-and-keys`, `recipes`, `api-reference` guide sections |

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
| `notifications-inbox.md` | The floor's bell: what happened while you were away, and its deep links |
| `first-five-minutes.md` | Stranger to "first useful moment" |
| `cold-walk-stranger.md` | Zero-prior-knowledge first impression |
| `persona-hn-skeptic.md` | HN skeptic, 3-min budget |
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
