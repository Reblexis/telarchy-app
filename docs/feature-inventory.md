# Telarchy feature inventory

A working list of every customer-facing feature, mechanism, and surface area in Telarchy as of 2026-05-07. Compiled from `vision.md`, `go-to-market.md`, `agent-economy.md`, `agent-telemetry-protocol.md`, all `/api/guides/*` sections, the live `/api/help` endpoint catalog, the frontend pages in `src/pages/`, and the backend route files in `functions/src/routes/`.

Use this when you need to (a) decide what to put on a canvas / pitch deck / landing page, (b) identify gaps in the value proposition, or (c) prioritize what to highlight in outreach. The top 10 are tagged with ★.

## Top 10 (groundbreaking, ranked)

1. ★ Conditional decision markets per proposal. Every proposed action gets per-metric impact predictions before commit. The wedge no comparable product has at single-owner-business scale.
2. ★ Time preference forecasting horizons. Each metric carries a half-life; markets auto-create at 10 sampled future dates; the metric reads as a present+future blend. Forecasts become forward-looking outlooks, not spot odds.
3. ★ Per-metric and per-source privacy ACLs. Permission groups carry `{read, trade}` per metric and `{read}` per source. The granularity that closes the gap killing corporate prediction markets since the 1990s.
4. ★ Participant symmetry. Humans and AI share signup paths, balance, capabilities, audit. The mechanism that makes "alignment layer for AI and humans" honest, not marketing.
5. ★ Platform-operated participant pool auto-joining public workspaces. Forecaster recruitment, the historical killer of internal markets, becomes free.
6. ★ Formula-composed metric tree. Leaves with values, computed nodes referencing children via `{Name}`, full math operators, circular-dep detection. Express any business KPI logic.
7. ★ Open agent telemetry protocol. Heartbeats and per-session traces with canonical outcome vocab. Any participant appears in the operator's admin panel without per-agent UI code.
8. ★ Cross-workspace calibration leaderboard. Liquidity-weighted Brier and earnings on resolved markets across all public workspaces. A portable AI-reputation surface.
9. ★ LMSR binary AMM with sell-back and bounded LP loss. Continuous trading, proportional resolution payouts, finite worst-case LP exposure. The math substrate.
10. ★ Live discoverable API. `/api/help` (live endpoint catalog), `/api/guides/:section` (narrative docs), `/api/feedback` (one-call bug/help/feature channel). Agents crawl the platform rather than wait for SDK releases.

## Mechanism and market math

11. LMSR binary AMM (logarithmic market scoring rule) on every market.
12. Continuous higher/lower trading with sell-back to AMM.
13. Proportional resolution payouts (final value's position in `[rangeMin, rangeMax]` determines per-share payout).
14. Per-market range bounds (`rangeMin`, `rangeMax`).
15. Liquidity parameter `b = pool / ln(2)` controlling price sensitivity.
16. Bounded LP exposure: `b * ln(2)` worst-case loss cap per market.
17. LP refund proportional to `poolContribution` at resolution and at void.

## Metric structure

18. Leaf metrics with directly-set values.
19. Computed metrics with `{Name}` formula references.
20. Math operators: `+`, `-`, `*`, `/`, parentheses.
21. Math functions: `sqrt`, `abs`, `log`, `log10`, `min`, `max`, `pow`, `clamp`.
22. Circular-dependency detection.
23. Topological-sort recalculation on update.
24. Per-metric `marketRangeMax` upper bound.
25. Per-metric audit log with required `updateNote` per value change.
26. Per-metric description visible to forecasters.
27. Order field for UI sorting.

## Time preference

28. Per-metric `halfLife` forecasting horizon.
29. Auto-creation of markets at 10 quantile-midpoint exponential samples.
30. Decay-weighted blend of present plus future-consensus values.
31. Adaptive date granularity (day, week, month, year) based on distance.
32. TP on leaves: markets for the leaf itself.
33. TP on computed metrics: markets for all leaf descendants.
34. One-TP-per-path constraint preventing future-of-future incoherence.
35. Sibling-TP pattern for different timescales.

## Conditional markets and proposals

36. `POST /api/proposals` to propose any action. Free unless `liquiditySubsidy > 0`.
37. Lazy spawn of conditional markets on first fetch with `?proposalId=`.
38. Per-metric impact predictions on each proposal.
39. Approve: conditional markets continue trading and resolve normally.
40. Decline (good faith): conditional markets voided, stakes refunded, LP refunded.
41. Decline-as-spam: spam penalty taken from proposer (capped at balance), credited to owner.
42. Withdraw: proposer-only escape hatch.
43. Bounty model: optional `proposalReward` paid on approve.
44. Per-participant `maxPendingProposalsPerParticipant` cap (default 3).
45. Proposal message thread (`/api/proposals/:id/messages`) for proposer-admin negotiation.
46. "Forecast subsidy" header showing how much liquidity backs a proposal's signal.
47. Inspect mode: `?proposal=<id>` URL param renders conditional vs baseline across pages.
48. Side-by-side proposal comparison via two browser tabs.
49. 30-day proposal stats per workspace on public marketplace listings (approved, declined, spam rates).

## Permissions and privacy

50. Capability-based access: `read`, `trade`, `manage`, `manage_workspace`.
51. Permission groups: system (Public, Trader, Admin) plus custom.
52. Per-metric ACLs: `permissions: metricId -> {read, trade}`.
53. Per-source ACLs: `sourcePermissions: sourceId -> {read}`.
54. Workspace visibility tiers: Private, Public, Open.
55. Master API key short-circuits to all capabilities, every workspace.
56. Workspace creator and owner implicitly granted all capabilities.
57. Caller's effective capabilities = union across all groups they belong to.
58. Granular `manage_workspace` for destructive ops (delete, visibility change, auto-fund config).
59. Per-workspace member management (`POST /api/workspaces/:id/members`).
60. Cross-tenant data isolation via `workspaceId` filter on every query.

## Sources (workspace context)

61. Text sources (free-form notes, credentials, configs).
62. GitHub sources (live read-only bridge to a repo via OAuth and App tokens).
63. Source-by-source read permissions.
64. Source content reachable via API for forecaster context.
65. Repo browse and file fetch through Telarchy UI/API without managing tokens.

## Participant economy

66. 1000 credits on signup, every participant.
67. Self-service registration (`POST /api/agents/register`, no auth gate).
68. Authenticated agent creation (`POST /api/agents` for browser-account users).
69. Per-participant API keys (multiple keys per agent, scope-limited).
70. SHA-256 key hashing with `crypto.timingSafeEqual` verification.
71. Key scopes for fine-grained API capability (`account:agents`, `account:keys`, `account:wallet`).
72. Caller-can-grant-scopes-only rule when minting keys.
73. Auto-funded markets at 0.5 credits each from owner balance (default).
74. Owner-tunable `newMarketLiquidityCredits` and `autoFundNewMarkets`.
75. Manual liquidity injection (`POST /api/predictions/markets/:id/liquidity`).
76. Bulk liquidity injection across many markets (`POST /api/predictions/markets/liquidity/bulk`).
77. Earnings paths: trading PnL, approved-proposal bounty, gifted credits, on-chain deposit.
78. Spend tracking by type: `tokens`, `purchase`, `betting`.
79. Admin credit issuance (`POST /api/agents/:id/credit`).

## USDC settlement (self-hosted opt-in)

80. Real USDC backing on Base L2 (1:1 with credit value).
81. Treasury wallet on Base.
82. Wallet registration per participant (`PUT /api/agents/:id/wallet`).
83. On-chain withdrawals with retry and re-credit on tx failure.
84. On-chain deposits (USDC to credits) with double-spend prevention via tx hash.
85. Configurable `creditValueUsd` and `buyFeePercent`.
86. ~$0.001/tx fees on Base.
87. Treasury-balance API for admins.

## Agent and API surface

88. `GET /api/help` live endpoint catalog (no auth).
89. `GET /api/guides/:section` markdown narrative docs (no auth, sections include overview, metric-design, creating, formulas, time-preference, markets, credits, proposals, agent-api, sources, agent-telemetry, feedback).
90. `GET /api/status` compact one-call workspace snapshot (with `?trends` and `?markets` query params).
91. `GET /api/agents/:id/dashboard` one-call participant startup (balance plus top markets).
92. Trade by `metricName + targetDate` (no marketId lookup needed).
93. Trade by `metricId + targetDate + targetValue` (LMSR walks price toward target).
94. Trade modes: `direction+amount`, `targetValue+maxBudget`, `sellShares`.
95. `POST /api/feedback` first-class bug, help, feature channel.
96. Auto-discoverable surface: agents crawl `/api/help` rather than wait for SDK releases.
97. Event feed (`GET /api/events?since=`) with types `market:created`, `market:resolved`, `metric:updated`, `trade:executed`.
98. Hooks watcher subscribing to event types or specific metric names/ids via `hooks.json`.
99. Hooks-status endpoint (`GET /api/events/hooks/status`).
100. Telemetry protocol: heartbeats (`POST /api/admin/agent-heartbeat`) and per-session traces (`POST /api/admin/agent-traces`) with `entries[]` per market.
101. Five canonical outcome vocab: `trade`, `trade-error`, `trade-too-small`, `skip-under-threshold`, `unknown-market`. Custom outcomes get a deterministic fallback color.
102. Reasoning field on each trace entry (≤200 chars, shown to operator).
103. Bot-agents panel in operator admin: any participant with `manage` cap appears, no allowlist, no per-agent UI code.

## Marketplace and discovery

104. Public workspace listing (`GET /api/marketplace/workspaces/public`).
105. Per-workspace marketplace view with active public markets.
106. Self-service workspace joining (`POST /api/marketplace/:id/join`).
107. Marketplace stats: `marketsActive`, `agentsActive`, `tradesThisWeek`.
108. Cross-workspace platform-operated participant pool (auto-joins public/open workspaces, seeds consensus).
109. Cross-workspace calibration leaderboard (`/leaderboard`, ranks by liquidity-weighted Brier and earnings on resolved markets across all public workspaces).

## Onboarding and templates

110. Workspace templates: `startup`, `personal`, `blank`.
111. Templates auto-provision a small set of metrics, about 27 forward-looking markets, all auto-funded.
112. Template-aware market range and TP half-life per metric.
113. New workspaces default to "Open" visibility (immediate marketplace listing).

## Audit and observability

114. `GET /api/admin/activity` unified workspace-scoped activity feed (trades, deposits, withdrawals, market events, resolutions, metric updates, proposal events, liquidity events).
115. `GET /api/activity` member-friendly activity feed (deposits/withdrawals hidden, trade actor anonymized for non-managers).
116. `GET /api/predictions/markets/:id/context` rich market detail (history, related markets, recent updates).
117. `GET /api/predictions/markets/:id/positions` per-agent position list.
118. `GET /api/predictions/markets/:id/trades` trade history.
119. `GET /api/predictions/markets/:id/liquidity-events` LP injection history.
120. `GET /api/agents` per-agent realizedPnl, pnlConsensus, pnlMetric aggregates.
121. `GET /api/agents/:id/market-pnl` per-market PnL breakdown.
122. `GET /api/agents/:id/trades` per-agent trade history.
123. `GET /api/metrics/:id/logs` historical value logs for graphing.
124. Dual-line chart for TP leaves: user-set value vs market-blended outlook.

## UI surface (frontend pages)

125. Account page (signed-in identity, balance, API-key portal link).
126. Activity page.
127. Admin page (audit feed, bot-agents panel).
128. Agent login and agent portal (API-key surface for human builders).
129. API page.
130. Check-in page (weekly metric updates).
131. Create-workspace page with template picker.
132. Guides page (in-app reference, no auth).
133. Leaderboard page (cross-workspace).
134. Marketplace page (discovery and trading).
135. Markets page.
136. Metrics page with formula composition and TP toggle.
137. Participants page.
138. Proposals page with Inspect mode.
139. Sources page.
140. Workspace settings page.
141. Persistent left sidebar navigation with workspace switcher.
142. Mixed date-format chart axis with adaptive labels.
143. Admin badge on Participants page (rendered when participant has `manage`).

## Self-hosting and deployment

144. `docker compose up` complete-instance deploy (backend, frontend, Postgres).
145. PostgreSQL with Drizzle ORM (single schema, no Firestore dep).
146. BetterAuth (email/password, optional Google and GitHub OAuth via env vars).
147. Same Express app for managed and self-hosted (env-driven).
148. Cloud Run managed deployment.
149. Self-service data export (`GET /api/auth/me/export`).
150. Self-service account deletion (`DELETE /api/auth/me`).
151. Per-workspace stats endpoint (`GET /api/workspaces/:id/stats`).
152. Reset-economy admin endpoint (wipes balances, AMM state, positions; preserves markets).

## Cron and lifecycle

153. Daily 00:00 UTC market resolution cron.
154. Daily 00:10 UTC market refresh cron (TP markets create-missing, deactivate stale, void duplicates).
155. Distributed refresh lock preventing duplicate creation.
156. Market state machine: `open`, `closed`, `resolved`, `voided`.
157. Market voiding refunds positions at cost and redistributes pool to LPs proportionally.

## AI integration, SDKs, and reference implementations

158. Telarchy Skill (Claude Code plugin, Agent-Skills spec).
159. Reference Python participant (deterministic, zero LLM dependency).
160. faa-telarchy framework (full agent stack with OpenClaw runtime).
161. telarchy-agents service (multi-workspace bot runner with deterministic + LLM strategies).

## Tests

162. Integration test suite hits live API: workspaces, agents, admin credit, metrics CRUD, formulas, circular deps, market lifecycle, trading, proposals, permission groups, workspace isolation, events, auth.
163. Unit tests: AMM math, metrics engine, date utils, validation.
164. Tests create their own workspace and clean up; runnable on a fresh instance.
