# MVP evaluation plan

Comprehensive pre-launch audit for `telarchy.com`. The goal is a confident "yes, strangers can sign up here" before broad public announcement. Cast a wide net: every user journey, every cross-cutting concern, every legal/operational surface worth knowing about before traffic arrives.

Compiled 2026-04-19. Every item lists: **what** to check, **how** (automation layer), and **pass criteria**. Sections ending in `(human)` are the small set where human hands are genuinely required.

---

## 0. Capabilities (what Claude can test directly)

| Capability | Tool | Scope |
| --- | --- | --- |
| HTTP API calls | `Bash` / `curl` | Any documented endpoint against local or prod, any auth method, concurrency, rate limit behaviour |
| Real browser automation | gstack `browse` (preferred) or Playwright MCP | Click, fill, screenshot, keyboard, viewport resize, console/network intercept, navigation — i.e. everything a user does with a mouse and keyboard. See `docs/browse-tests/README.md` for the per-feature, browse-runnable test scripts. |
| Backend test suite | `npm test` | 176 existing Jest tests; can add/modify |
| Typecheck | `tsc --noEmit` | Frontend and functions |
| Code audit | `Grep` / `Read` | Static analysis: secret leaks, silent catches, style violations |
| Production logs | `gcloud run services logs read` | Last N entries, error-grep |
| Production DB | Cloud SQL Auth Proxy | Read-only spot-checks, never write |

**What Claude cannot test directly (marked `(human)` throughout):**
1. Completing OAuth consent on Google/GitHub's own domains (browse can click "Continue with Google", but the OAuth provider's own consent screen needs an authenticated browser session Claude doesn't have).
2. Real device hardware (touch gestures, pinch-zoom, hardware keyboard quirks). Viewport emulation covers the visual layer; physical feel does not.
3. Assistive-tech behaviour (VoiceOver, NVDA). Semantic HTML and contrast ratios are auditable; the actual screen-reader narration is a human task.
4. Legal review of ToS/Privacy text against a specific jurisdiction. Claude can check internal consistency; a lawyer is the authoritative read.
5. Sustained load testing (hours of synthetic traffic). Spot-checks of 50–100 concurrent requests are in scope; a k6 soak run is a human call (cost + blast radius).
6. Email deliverability. No provider is wired up, so this is a "does it exist" check rather than a "does it land in inbox" check.

---

## 1. Anonymous landing experience

Does a first-time visitor with no account understand what this is and decide to try it?

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 1.1 | Landing page loads under 2 s (cold), under 500 ms (warm) | browse `$B goto` + `$B perf` timing | First contentful paint < 2 s on 4G throttle |
| 1.2 | Hero copy is legible and answers "what is this?" | browse screenshot | Human-readable without explanation from me |
| 1.3 | Every nav link resolves to a 200 page (no dead links) | Bash: crawl internal links | No 404s |
| 1.4 | Footer has Terms + Privacy links that open the right pages | browse click → URL assertion | `/terms` renders ToS, `/privacy` renders PP |
| 1.5 | "Sign up" CTA leads to `/signup` and loads instantly | browse click | `/signup` renders without console errors |
| 1.6 | Marketplace counter widget shows real numbers | browse `$B goto` + `curl /api/marketplace/stats` | Counter matches API |
| 1.7 | Mobile viewport (375 px) renders without horizontal scroll | browse `$B viewport` + screenshot | No overflow, hero still above fold |
| 1.8 | Tablet viewport (768 px) renders cleanly | browse `$B viewport` + screenshot | Layout holds |
| 1.9 | Marketplace page loads and lists public workspaces | browse navigate `/marketplace` | ≥1 workspace visible, join button works |
| 1.10 | OG preview meta tags present on root | `curl -s / \| grep og:` | `og:title`, `og:image`, `og:description` all populated |
| 1.11 | `/robots.txt` and `/sitemap.xml` exist (SEO floor) | `curl` | Both return content, not 404 |

---

## 2. Signup and first-login activation

Does a stranger get from "decided to try" to "seeing value" without friction?

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 2.1 | Signup form requires email, display name, password, consent checkbox | browse: submit with each field empty | Each missing field blocks submit with clear error |
| 2.2 | Consent checkbox is unchecked by default | browse state read | `checked=false` on load |
| 2.3 | Terms and Privacy links inside consent label open the right pages | browse click | `/terms` and `/privacy` each render |
| 2.4 | Password < 8 chars rejected with specific message | browse fill + submit | Error: "Password must be at least 8 characters" |
| 2.5 | Happy-path signup creates account and lands on `/create-workspace` | browse full flow with fresh email | Redirect occurs, no error surface |
| 2.6 | Duplicate email gives clean "account exists" error | browse resubmit same email | User-friendly message, no stack trace |
| 2.7 | Backend records `consentedAt` and `consentedVersion` in `user` table | Bash: query DB after signup | Both columns populated |
| 2.8 | OAuth button without consent checked surfaces error, does not initiate OAuth | browse click Google without checkbox | Error shown, URL unchanged |
| 2.9 | OAuth with consent checked initiates redirect to provider | browse click Google with checkbox | URL becomes `accounts.google.com/...` |
| 2.10 | **Complete Google OAuth** `(human)` | Claude opens signup; human finishes the Google consent screen | Human returns to app signed in |
| 2.11 | **Complete GitHub OAuth** `(human)` | Same as 2.10 | Same |
| 2.12 | Post-signup balance is 1000 credits | Bash: `GET /api/agents/me` with session cookie | `balance === 1000` |
| 2.13 | Welcome CheckIn page shows seed-liquidity receipt + "bots arrive ~5 min" banner | browse screenshot `/check-in?welcome=1` | Both elements visible |
| 2.14 | Email leak check: display name is not filled with email anywhere | browse: inspect user-visible text in dashboard/sidebar | No `@` character renders as a name |
| 2.15 | Session cookie survives reload | browse reload → `/api/auth/me` | Still authenticated |
| 2.16 | Logout clears cookie and redirects | browse sidebar logout | Cookie gone, on public page |

---

## 3. First workspace and first metric

Can a user get from an empty account to a workspace with a metric, chart, and forecast?

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 3.1 | `/create-workspace` renders template options | browse screenshot | At minimum `startup`, `personal`, `blank` visible |
| 3.2 | Each template creates a workspace with a sensible default metric set | browse create → inspect metrics list | Metrics exist, have non-zero values, formulas resolve |
| 3.3 | Workspace visibility picker defaults to Open (per recent commit) | browse inspect defaults | Open selected |
| 3.4 | Create custom metric (name, value, formula) via UI | browse fill form → submit | Metric appears in list within 1 s |
| 3.5 | Formula referencing other metric evaluates correctly | Create `C = A + B`, set A=3, B=4 | C total shows 7 |
| 3.6 | Formula with syntax error shows warning, does not crash | Create `D = foo(` | Warning surfaces, rest of UI still usable |
| 3.7 | "Markets →" drill-down on leaf metric filters markets page | browse click | `/markets?q=<name>` and filter input pre-filled |
| 3.8 | Metric update persists across reload | Edit value → reload | New value still shown |
| 3.9 | Delete metric removes it and does not break dependent metrics | Create A→B, delete A | B still exists; warning if orphaned |
| 3.10 | Update log entry appears in `/api/updates` (admin) after edit | Bash | `history` rows grow by one |

---

## 4. Prediction-market mechanics

The core loop. If this is shaky nothing else matters.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 4.1 | Create market for a metric with target date | Bash `POST /api/predictions/markets` | 201, market returned with id + consensus=rangeMin |
| 4.2 | Trade "higher" moves consensus up; "lower" moves it down | Bash two trades, read before/after | Directional correctness |
| 4.3 | LMSR cost math matches closed-form expectation | Bash trade + computed expected cost | |cost − expected| < 0.01 |
| 4.4 | Concurrent trades on same market do not corrupt AMM state | Bash: 20 parallel trades, verify invariants | Liquidity conserved, share counts balanced |
| 4.5 | Sell shares refunds proportional credits | Bash trade + sell | Balance returns ≈ cost − spread |
| 4.6 | Market resolution at known metric value pays proportional | Bash: create, trade, resolve, read balances | Payouts ~= expected within LMSR rounding |
| 4.7 | Void market refunds all stakes | Bash void on traded market | All participants get full stake back |
| 4.8 | Market created for nonexistent metric returns 400 | Bash | 400 with clear error |
| 4.9 | Conditional market creation via task works | Bash task + markets | Conditional markets created and resolvable |
| 4.10 | UI trade panel updates consensus live after trade | browse `$B goto`| Number updates within 2 s |
| 4.11 | Position panel shows owned shares correctly | browse `$B goto`| Shares match API |
| 4.12 | Trade with 0 or negative amount rejected | Bash | 400, not 500 |
| 4.13 | Trade with insufficient balance rejected with message | Bash | 400, balance unchanged |

---

## 5. Agent/API-key participant parity

AGENTS.md rule: humans and agents must have symmetric capabilities.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 5.1 | `POST /api/agents/register` creates agent + key | Bash | 201, key returned once |
| 5.2 | Agent key trades on a market successfully | Bash with `X-Agent-Key` | Position created |
| 5.3 | Agent key can propose a task | Bash | 201 |
| 5.4 | Agent key can join a public workspace | Bash `POST /api/marketplace/:id/join` | Membership added |
| 5.5 | Agent portal UI hides USDC settings when flag is off | browse as agent key | Only "disabled" notice shown in Settings |
| 5.6 | Hook watcher `GET /api/events/hooks/status` reports active when configured | Bash | `{active: true}` if hooks file exists |

---

## 6. Marketplace and workspace discovery

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 6.1 | `GET /api/marketplace` lists public workspaces only | Bash — check unlisted/private absent | Private workspace never appears |
| 6.2 | Join flow from `/marketplace` UI works for authed user | browse `$B goto`| Shows up in `My workspaces` |
| 6.3 | Public group capabilities govern what a joiner can do | Bash: join, then attempt trade | Trade succeeds if `Public` has `trade`, else 403 |
| 6.4 | Workspace visibility picker (Private/Public/Open) updates group capabilities | browse toggle → Bash verify group | `Public` group has expected capability set |
| 6.5 | OG meta tags on marketplace share page contain workspace name | `curl -s https://telarchy.com/marketplace/<id> \| grep og:` | `og:title` includes name |
| 6.6 | Stale `X-Workspace-Id` tolerated (per commit `660ba6c`) | Bash: request with an ID user is not a member of | 200 with fallback workspace, not 403 |

---

## 7. Permissions and security

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 7.1 | Anonymous request to any non-public endpoint returns 401 | Bash enumerate | Every protected route 401s without auth |
| 7.2 | Master API key requires `X-Workspace-Id` (enforced) | Bash without header | 400 with clear error |
| 7.3 | Session user cannot read another user's `/api/auth/me` | Bash with user A's cookie calls user B's data | Not possible (endpoint is `me`-scoped only) |
| 7.4 | Capability enforcement: read-only user rejected on trade | Bash with viewer-level session | 403 |
| 7.5 | CORS: cross-origin from unlisted domain blocked | `curl -H "Origin: http://evil.example"` preflight | Preflight denied |
| 7.6 | BetterAuth sign-out invalidates session server-side (with Origin) | Bash as documented in prior verify | Subsequent `me` is 401 |
| 7.7 | Sensitive headers scrubbed from error responses | Bash trigger a 500, inspect body | No stack traces, no env-var values |
| 7.8 | `.env.example` contains no real secrets | Grep for known key patterns | No matches |
| 7.9 | Git history does not contain committed secrets | Grep history for regex: hex-40, hex-64, AWS-style keys | No matches |
| 7.10 | Rate limiter: >300 req/min throttled, returns 429 | Bash: 400 reqs in 60s | 429 appears before request 400 |
| 7.11 | Registration rate limiter (5/min on waitlist) works | Bash | 429 after 5 |
| 7.12 | SQL-injection spot-check on obvious params (`?q=`, `?taskId=`) | Bash with `' OR 1=1--` | 400 or clean empty result, not 500 |
| 7.13 | XSS spot-check: metric name with `<script>` renders as text | browse create + view | Literal string shown, no execution |
| 7.14 | Consent gate: signup with `consent: false` rejected by backend | Bash | 400 with message |
| 7.15 | Unknown `/api/*` route returns clean 404 for authed users (fix verified) | Bash | `{error:"Not found"}` 404 |

---

## 8. USDC settlement kill-switch

Load-bearing for legal posture.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 8.1 | `GET /api/public-config` reports `usdcSettlementEnabled: false` on prod | Bash | Confirmed 2026-04-19 ✓ |
| 8.2 | All five USDC routes return 503 when flag off | Bash enumerate: deposit-address, deposit, withdraw, treasury, wallet | All 503 with explanation |
| 8.3 | Flipping to `USDC_SETTLEMENT_ENABLED=true` re-enables routes | Local only: restart with flag, re-test | Same routes return 200 |
| 8.4 | Frontend AccountPage hides deposit UI when flag off | browse `$B goto`| No deposit section rendered |
| 8.5 | Frontend AgentPortal hides deposit UI when flag off | browse `$B goto`| "disabled" notice shown instead |
| 8.6 | Backlog bodies reference "credits have no redemption value" per ToS | Read `docs/legal/terms-of-service.md` | Clause present |

---

## 9. Legal documents and GDPR

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 9.1 | `docs/legal/terms-of-service.md` contains 18+, play-money clause, self-host clause, governing law, contact | Read + grep | All clauses present |
| 9.2 | `docs/legal/privacy-policy.md` PII inventory matches actual schema columns | Read + grep schema | Match |
| 9.3 | `/terms` and `/privacy` render the markdown cleanly | browse `$B goto`| Headings, lists render; no raw `#` visible |
| 9.4 | `DELETE /api/auth/me` deletes account and detaches agent | Bash (on test user, not admin) | 204; subsequent `me` is 401; row `authUserId` is null |
| 9.5 | `GET /api/auth/me/export` returns JSON with user + agent + trades | Bash | JSON well-formed, contains expected top-level keys |
| 9.6 | No third-party trackers in prod bundle | Grep built JS for `google-analytics`, `segment`, `hotjar`, etc. | No matches |
| 9.7 | **Legal review of ToS/Privacy against target jurisdiction** `(human)` | Paralegal or lawyer | Sign-off or change list |
| 9.8 | Consent version `1.0` hard-coded matches ToS header version | Read `functions/src/routes/userauth.ts` + ToS | Versions align |

---

## 10. Reliability, observability, and performance

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 10.1 | Cold-start Cloud Run latency measured | Bash: trigger after idle, time first response | < 3 s ok, < 5 s tolerable |
| 10.2 | `/api/status` under 50 concurrent reqs all succeed | Bash: 50 parallel | 0 errors, p95 < 1 s |
| 10.3 | Market refresh cron completes without error for a 1000-metric workspace | Bash trigger + inspect logs | Log shows `created/deactivated/deduplicated` counts, no stack trace |
| 10.4 | `gcloud run services logs read api --limit 200` shows no repeating errors in last 24 h | Bash | No error lines, or explainable one-offs only |
| 10.5 | Log output does not print user emails, session tokens, or raw API keys | Grep logs | Clean |
| 10.6 | Cloud SQL connection pool not saturated under spike | `gcloud sql operations list`/metrics | No `too many connections` |
| 10.7 | **Sustained load (30 min, 10 rps)** `(human)` | k6 or similar | User calls; not run by Claude (cost + side effects) |
| 10.8 | Production assets served with long-cache headers | `curl -I /assets/index-*.js` | `cache-control: public, max-age=...` present |
| 10.9 | Gzip/Brotli enabled on HTML + JS | `curl -I -H "Accept-Encoding: br"` | Encoding header in response |

---

## 11. Content and copy hygiene

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 11.1 | No em-dashes anywhere in UI copy | Grep source | 0 matches |
| 11.2 | No occurrences of the owner's real name in user-facing placeholder text | Grep source | 0 matches |
| 11.3 | Consistent product name ("Telarchy") | Grep | No "Telearchy", "telarchy" casing inconsistencies |
| 11.4 | No leftover TODO/FIXME in user-visible strings | Grep JSX | 0 matches |
| 11.5 | Guides markdown renders without broken images or links | Bash crawl internal links in `docs/` | All targets exist |
| 11.6 | Error messages don't leak stack traces or internal paths | Trigger every 4xx/5xx, inspect | Clean prose only |

---

## 12. Accessibility and frontend correctness

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 12.1 | Every form input has an associated `<label>` | browse `$B goto`+ DOM query | No bare `<input>`s |
| 12.2 | Tab order through signup is logical | browse `$B press Tab` sequence | Focus progresses email → name → password → checkbox → submit |
| 12.3 | Buttons have discernible text (not icon-only without aria-label) | DOM query | All have text or aria-label |
| 12.4 | Color contrast for body + link text | browse screenshot + heuristic | Passes WCAG AA visually (no near-invisible text) |
| 12.5 | No console errors or warnings on main flows | browse `$B console --errors` during signup + dashboard | Empty |
| 12.6 | No network 404s on main flows | browse `$B network` | None for app's own routes |
| 12.7 | **Screen-reader run-through of signup + one trade** `(human)` | VoiceOver/NVDA | All controls announced with intent |
| 12.8 | Focus visible on every interactive element | browse tab + screenshot | Outline present |

---

## 13. Mobile and responsive

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 13.1 | Signup form usable at 375 × 667 | browse resize + screenshot | All fields tappable, no horizontal scroll |
| 13.2 | Dashboard readable at 375 px | browse `$B goto`| Cards stack, numbers legible |
| 13.3 | Marketplace readable at 375 px | browse `$B goto`| List renders |
| 13.4 | Settings/account pages usable at 375 px | browse `$B goto`| All controls reachable |
| 13.5 | iPad-portrait layout (768 px) not degenerate | browse `$B goto`| Looks intentional, not "narrow desktop" |
| 13.6 | **Real-device pinch/zoom and touch-scroll** `(human)` | Phone + tablet | Feels native, no scroll traps |

---

## 14. Abuse and failure modes

Things that go wrong when someone tries to break it.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 14.1 | Create 10k metrics via API, dashboard still loads | Bash + browse `$B goto`| Render time < 5 s, no timeout |
| 14.2 | Extremely long metric name (2000 chars) handled gracefully | Bash create | Truncated or rejected, not crash |
| 14.3 | Unicode/RTL metric name renders correctly | Bash create "مقياس ١" | Displays, sorts, links still work |
| 14.4 | Script-injection in task title/description | Bash create + browse render | Escaped |
| 14.5 | Formula with billion-step recursion or cycle | Bash create `A = B; B = A` | Cycle detected, error surfaced, engine not stuck |
| 14.6 | Very large number in metric value (1e300) | Bash | Rejected or handled, no NaN poisoning |
| 14.7 | Concurrent signup race (same email) | Bash: two parallel signups | One succeeds, other gets duplicate error |
| 14.8 | Unauthenticated WebSocket/event-stream probe (if any) rejected | Bash | 401 immediately |

---

## 15. Supporting surfaces

Things that exist but are easy to forget.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 15.1 | `/api/help` endpoint documents every currently-routed endpoint | Bash compare registered routes vs `/api/help` | No missing or stale entries |
| 15.2 | Guides pages (`/guides/*`) all render | browse navigate each section | Markdown renders |
| 15.3 | Sources (text + GitHub) end-to-end if enabled | Bash + browse `$B goto`| Text source creatable + readable; GitHub flow reachable |
| 15.4 | Tasks propose → approve → payout works end-to-end | Bash/browse `$B goto`| Balance shifts by `price` credits |
| 15.5 | Credit balance displayed consistently across Dashboard, Marketplace, AgentPortal | browse compare | Three values identical |

---

## 16. Persona walkthroughs (UX simulation)

Feature tests tell us a button works. Persona walkthroughs tell us whether a specific kind of stranger, with a specific mental model, can succeed at something they care about before giving up. Detailed persona scripts, the shared execution protocol, and the findings template live in `docs/personas/`.

| # | Persona | File | Conversion milestone |
| --- | --- | --- | --- |
| 16.1 | Jordan, HN skeptic | `personas/01-hn-skeptic.md` | Signs up within 2 minutes after scanning landing and marketplace |
| 16.2 | Alex, QS hobbyist | `personas/02-qs-hobbyist.md` | Updates a personal metric and sees forecast react |
| 16.3 | Sam, agent builder | `personas/03-agent-builder.md` | Agent key registers, trades, sees event emitted |
| 16.4 | Marcus, startup founder | `personas/04-startup-founder.md` | Creates a `startup` workspace and finds the invite path |
| 16.5 | Taylor, phone visitor | `personas/05-phone-visitor.md` | Shared link renders cleanly on 390x844 |
| 16.6 | Lin, researcher | `personas/06-researcher.md` | Verifies LMSR math matches docs and exports trade history |
| 16.7 | Priya, day-2 return | `personas/07-day-2-return.md` | Sees at least one visible change since last visit |

Read `personas/_protocol.md` once before running any persona. Each run produces a findings file under `personas/findings/<persona-id>-YYYY-MM-DD.md` with outcome, session log, friction list with severity tags, and recommended changes.

Persona findings are first-class launch-gating evidence. A feature that passes every test in sections 1–15 but fails persona 16.5 (phone visitor) ships with a known mobile-activation hole. That's a decision, not a surprise.

Other kinds of UX-level simulation, complementary to personas:

- **Cross-session continuity**: run persona 16.1 → persona 16.7 on the same account, two days apart. Does signup-day value survive into return-day?
- **Interrupt tolerance**: run any persona, navigate away mid-flow (new tab, back button, refresh), return. Does the product recover or restart?
- **Goal-substitution test**: pick a real metric from the user's life (e.g. "weekly runs" instead of the template's "deep work"), run it end-to-end. Does the product bend to real goals or only to its defaults?
- **Empty-state tour**: sign up, do nothing, read every screen. Is every empty state informative and actionable, or blank?
- **Permission-boundary tour**: sign up as user B, attempt to access user A's workspace via URL guessing. Does the product refuse cleanly, or leak?

These are checklists, not full personas. Run them alongside or after the main personas.

---

## 17. Admin observability and bot telemetry

The `/admin` page is the operator's window into platform health and the bot
agents that trade against every workspace. These checks live alongside the
existing activity feed coverage but specifically target the Bot agents panel
that the `telarchy-agents` service feeds via `POST /api/admin/agent-heartbeat`
and `POST /api/admin/agent-traces`. Detailed step-by-step browse script lives
in `docs/browse-tests/admin-observability.md`.

| # | Check | How | Pass |
| --- | --- | --- | --- |
| 17.1 | `/admin` requires the `manage` capability | `browse goto /admin` while logged out and as a non-admin user | Logged-out: redirect to /login. Non-admin: empty/forbidden state, no telemetry visible |
| 17.2 | Bot agents panel renders all heartbeats received in the last hour | `browse` admin page; assert at least one row per running strategy | One row per agent that has reported, status chip + countdown rendered |
| 17.3 | Next-cycle countdown ticks down every second | `browse snapshot -D` after 5 s; numeric value should decrease | Countdown value strictly less after wait |
| 17.4 | Last-result column reports `<traded>t <skipped>s [<errors>e]` | `browse text` on row | Matches latest cycle outcome from `GET /api/admin/agent-heartbeats` |
| 17.5 | Clicking an agent row filters traces to that agent | `browse click` row + assert empty-state message refers to the agent id | Trace list is filtered, "clear" link visible |
| 17.6 | Decision traces expand to show per-market reasoning | Wait for an AI session, then `browse click` first trace | Tokens, model, cost, and entries with reasoning text are visible |
| 17.7 | Stale agent (no heartbeat in 2× pollInterval) flagged in UI | Stop the agents service; reload after 2× interval | Status chip turns to `error` or row shows "overdue" countdown |
| 17.8 | `GET /api/admin/agent-heartbeats` requires `manage` capability | `curl` without auth headers, with non-admin agent key, with admin master key | 401 / 403 / 200 respectively |
| 17.9 | `POST /api/admin/agent-heartbeat` rejects calls without master key | `curl` with non-admin token + body | 403, no row written |
| 17.10 | `POST /api/admin/agent-traces` rejects calls without master key | Same | 403, no row written |
| 17.11 | Trace `entries` payload accepts an empty array | `curl POST` with `entries: []` | 201, row stored with `entries=[]` |
| 17.12 | Heartbeat upsert uses `agentId` PK (does not duplicate rows) | Send two heartbeats for same agent, count rows | Exactly one row, `updatedAt` advanced |
| 17.13 | Telemetry tables don't grow unbounded | `select count(*) from agent_traces` after 24 h of polling | Row count consistent with cycle frequency × strategies; if > 50k, add retention task |

---

## Execution order

The product has no users yet (AGENTS.md focus gate). Don't turn this into busywork. Suggested order of attack, from highest-leverage to lowest:

1. **Section 2** (signup activation) — if broken, nothing downstream matters.
2. **Section 7** (security) — the items a malicious first visitor would try first.
3. **Section 4** (trading mechanics) — the core loop.
4. **Sections 8 and 9** (USDC off + legal) — the legal floor.
5. **Persona 16.1 (HN skeptic) + 16.5 (phone visitor)** — the two highest-bounce-risk first impressions. Run before section 1 so the findings inform any landing copy/UX fixes.
6. **Section 3** (metrics) — the first-value path.
7. **Persona 16.2 (QS hobbyist) + 16.4 (startup founder)** — the two primary user archetypes the product currently targets.
8. **Section 6** (marketplace) — the virality path.
9. **Section 1** (landing) — impressions and SEO floor.
10. **Persona 16.3 (agent builder) + 16.6 (researcher)** — the technical-depth personas; surface doc drift and API gaps.
11. **Sections 5, 11, 12, 13** — hygiene and parity.
12. **Sections 10, 14, 15** — reliability and edge cases.
13. **Persona 16.7 (day-2 return)** — retention proxy; run after at least one activating persona has created an account to test against.

Each section produces a short findings log. Anything red blocks launch; anything yellow is filed under "ship, revisit post-first-users".

## Human-only checklist (extracted)

All `(human)` items from above, consolidated for easy hand-off:

- 2.10 Complete Google OAuth signup end-to-end.
- 2.11 Complete GitHub OAuth signup end-to-end.
- 9.7 Legal review of ToS/Privacy policy by a paralegal or lawyer.
- 10.7 Sustained 30-minute load run at 10 rps.
- 12.7 Screen-reader run-through with VoiceOver or NVDA.
- 13.6 Real-device touch test on a phone and a tablet.

Everything else: Claude can execute directly.
