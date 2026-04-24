# Browse-test scripts

Per-feature, browser-runnable test specs for `telarchy.com`. Each file is a
checklist of concrete `browse` (`$B`) commands plus expected post-conditions,
written so a human or AI agent can replay them end-to-end without inferring
intent.

## Why these exist

The repo already has three layers of pre-launch evaluation docs:

| Layer | File(s) | Question it answers |
| --- | --- | --- |
| Feature checklist | `docs/mvp-evaluation-plan.md` | Does every feature behave as specified? |
| Persona walkthroughs | `docs/personas/*.md` | Will a specific kind of stranger succeed? |
| First-time-user flow | `docs/user-flow-audit.md` | Does the activation funnel hold together end-to-end? |

What was missing: a focused, per-feature **browser script** that reads like a
test runner spec. Every command, every selector, every assertion. No prose, no
persona psychology — just steps and expected results. That's what
`docs/browse-tests/` is for.

These specs are complementary. The feature checklist points at them
(section 17 → `admin-observability.md`); the persona walkthroughs invoke them
implicitly when their script crosses the same surface; this directory is the
authoritative place to look up "what should happen when I click X".

## How to run a spec

1. Read the spec top-to-bottom once. Note any preconditions (auth, fixtures,
   feature flags) and prepare them.
2. Set `B` once at the top of your shell session — this resolves to whichever
   `browse` binary is installed on this machine:

   ```bash
   _ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
   B=""
   [ -n "$_ROOT" ] && [ -x "$_ROOT/.claude/skills/gstack/browse/dist/browse" ] && B="$_ROOT/.claude/skills/gstack/browse/dist/browse"
   [ -z "$B" ] && B="$HOME/.claude/skills/gstack/browse/dist/browse"
   ```
3. Run each test in order unless the spec says otherwise. Some specs depend on
   state created by earlier tests in the same file.
4. Capture screenshots for every step that has a visual outcome:
   `$B screenshot /tmp/<spec>-<test>-<step>.png`.
5. After every navigation or DOM-mutating action, refresh the snapshot:
   `$B snapshot -i` (refs become stale across navigation).
6. On a failure, file the result against the relevant section of
   `mvp-evaluation-plan.md` (or open a bug if there is no matching row).

## Writing-style rules

- Every step is a single command, line by line, no markdown lists nested
  inside steps.
- Expected results are concrete: a string that must appear, an HTTP status,
  a CSS selector that must be visible. No "should look right".
- If a step depends on backend state (a market existing, a heartbeat being
  recent), state how to seed that state — never assume it.
- Do not embed credentials. Reference them by location (e.g. "use the
  AGENTS.md credentials" or "use `$ADMIN_KEY`").

## Browse cheat sheet

Most-used commands when writing or running these specs. Full reference:
`~/.claude/skills/browse/SKILL.md`.

| What | Command | Notes |
| --- | --- | --- |
| Open a page | `$B goto https://telarchy.com/admin` | Auto-starts the headless server |
| Resize viewport | `$B viewport 1440x900` | Or `390x844` for phone |
| List interactive refs | `$B snapshot -i` | Returns @e1, @e2, … refs and labels |
| Read page text | `$B text` | Cleaned text, easy to grep |
| Click | `$B click @e3` | Or any CSS selector |
| Fill input | `$B fill @e3 "value"` | Or `$B fill #email "x@y"` |
| Wait for navigation | `$B wait --networkidle` | 15s timeout |
| Assert state | `$B is visible ".panel"` | Other props: enabled, checked, focused |
| Console errors | `$B console --errors` | Filter to errors/warnings |
| Network log | `$B network` | Use to spot 4xx/5xx |
| Screenshot | `$B screenshot /tmp/x.png` | Full page; add `--selector .panel` to crop |
| Diff a region | `$B snapshot -D` | Unified diff vs previous snapshot |
| Save/load state | `$B state save anon` / `$B state load anon` | Cookies + URLs |
| Hand off to user | `$B handoff "Need OAuth"` | Opens visible Chrome for human takeover |

## Specs

Concrete browser-driven tests, by surface. Items marked `(stub)` exist as
placeholders to claim coverage and have basic structure but need fuller
assertions filled in on next QA pass — they are the next-best-thing-to-a-real-test
and a known followup. Filling them in is mechanical, not creative.

| File | Surface | Depends on |
| --- | --- | --- |
| `admin-observability.md` | `/admin` Bot agents panel and activity feed | telarchy-agents service running, master API key for direct POSTs |
| `signup-and-login.md` | `/signup`, `/login`, post-signup landing | Fresh email per run |
| `metrics-and-check-in.md` | `/metrics`, `/check-in`, edit modals, formula evaluation | Authenticated user with at least one workspace |
| `markets-trading.md` | `/markets`, trade panel, position panel | Workspace with markets that have liquidity |
| `marketplace-public.md` | Logged-out `/marketplace`, share-link query param, anonymous filtering | Anonymous (no cookies) |
| `tasks-flow.md` | `/tasks`, propose → approve → payout, conditional markets | Two participants (proposer + approver) |
| `sources.md` (stub) | `/sources` text + GitHub flows | Admin user; GitHub App installation for non-text |
| `workspaces.md` (stub) | Create/switch/delete workspace, visibility flags | Authenticated user |
| `agent-portal.md` (stub) | `/agent-portal/<id>` post-key registration | A registered agent and its API key |

Add a new spec when a feature ships that crosses the UI layer and isn't
covered above. Don't add a spec for backend-only changes — those go into
`mvp-evaluation-plan.md` and are exercised by `npm test`.
