<!-- Record, 2026-09-09. Written by Codex (codex-cli 0.153.4) on the owner's
     instruction: "ask codex to design it and create it instead and also check
     each information is correct .. and figure out whats worth actually
     mentioning". Its prose rewrite shipped; the follow-up recommendations
     below are not built. -->

# Proposed data room

The page should answer what is being measured, what could change the next reading, and how much evidence there is of use. The content rewrite reduces 16 sections to 8 and removes the funnel, lifetime traction and shipping blocks. It preserves the small-number promise, qualification distinctions, play-money and prize disclaimers, experimental-season notice and public verification routes.

## Running order implemented

| Section | Question and reader | Blocks |
| --- | --- | --- |
| Overview | What is this, and what qualifies for the headline count? Both readers. | pulse |
| The readings | What has actually changed, and where are observations missing? Primarily the forecaster. | rates |
| Behind the next reading | Who is near a threshold, what expires, and what decisions or payments can count? Primarily the forecaster. | window |
| Trading | Is there continuing trading activity, including activity outside the verified set? Both readers. | trading |
| Traffic | Are requests arriving, and what can these counts tell us about visitors? Primarily someone considering building, buying or funding. | traffic |
| Proposals and decisions | What has been approved, what money was committed, and which recent actions provide context? Both readers. | contracts, events |
| What is scheduled | Which dates and recorded outreach stages could matter next? Primarily the forecaster. | calendar |
| Limits and checking | What does this evidence leave unresolved, and where can I inspect the figures and binding rules? Both readers. | None |

Keep the existing part IDs and titles. The first three sections sit in The numbers, activity and proposals in The place, and scheduled dates and limitations in The plan. `DataRoomPage.tsx` hardcodes the part titles independently, so changing only `KNOWN_PARTS` would not rename the visible index. There is no benefit to a partial rename.

## Recommended follow-up, outside this edit

### Make each metric readable with its own evidence

Extend the feed with stable metric IDs, units, live values, source routes, thresholds, window lengths, inclusion rules and observation timestamps. Then group each metric's `TimeChart` and relevant window evidence together: trader count with its `RankChart` and lapses, profitable forecasters with its profit distribution, outside owners with decisions and pending proposals, revenue with completed payments. This would avoid making a reader remember a chart through the entire rates block before reaching its underlying rows. The current block contract cannot do this rearrangement.

Expose the precise paid-Manifold-claim definition, distinct from a free link, with machine-owned eligibility parameters. Likewise expose the profit window and open-market horizon, outside-owner exclusions and revenue window. The rewrite refers to existing thresholds without typing their values into prose; the blocks still need the remaining definition fields to be self-contained.

### Correct the drawings and captions

Use only the existing `TimeChart` and `RankChart` components:

- Readings: keep daily lines and the printed weekly values, but date every weekly sample and mark the current interval as partial. Show the actual last observation time. A missing observation is not zero and a line between observations is not proof of measurement in between.
- Trading: make distinct participants per day the first `TimeChart`. Put credit volume second, retaining a clearly labelled log scale where useful. The trade-count chart adds less than either and can move behind a detail control. Use "participants", not "people". Publish the scope difference from the active-trader metric in the chart caption.
- Zero-activity days: distinguish a known zero from missing collection. `buildTradingByDay()` currently omits days without rows and the line can connect across short gaps. Generate complete dated series for known coverage; do not apply that zero-fill rule to missing metric observations.
- Thresholds: keep sorted `RankChart` distributions, the threshold rule and full over-cap values. Do not round profits before deciding which side of the threshold a bar occupies. `forecastersBlock()` rounds to whole credits while the metric counts unrounded profit; a value just below the threshold can appear to qualify. Trader spend has a similar cent-rounding boundary risk.
- Lapses: compute exact threshold-crossing instants from expiring trades, then aggregate by UTC date for the `TimeChart`. Daily-offset sampling can label the crossing a day late. Include the current day if a trader can lapse before midnight. Label the assumption of no new trades.
- Traffic: retain separate request and distinct-address `TimeChart` axes. Replace "Humans only" and "distinct visitors" with the quantities actually counted. Either apply `isPageLoad()` consistently to the published metric or keep the explicit filtered-request definition. Historical rollups cannot simply be recomputed after raw-row retention expires; any changed definition needs a dated boundary.
- Events: keep a single readable dated list tied to chart marks. Limit annotations to the relevant chart period and expose the event-list coverage/cap. Approval and delivery remain separate kinds. Their proximity to a reading is not causation.
- Outreach: replace the unlabeled opacity grid with plain hairline stage totals. Pipeline categories are not a time series and do not justify a third chart type. Stage counts describe entered statuses, not measured conversion rates.

### Publish missing decision and financial evidence

- Outside owners: add anonymised qualifying recent decisions with their expiry dates, grouped so that several proposals from the same floor cannot imply several owners. Match starter and house exclusions to the metric. Public pending proposals are not a ceiling on a metric that also counts private floors. Preserve private-floor anonymity; publish no private slug or participant name.
- Revenue: show the current total from the same stats result beside the payment rows, identify completed versus pending amounts, and publish scope and duration. A $0 completed row is not a paying customer. Do not infer company-wide revenue from the liquidity rail or its trailing window.
- Commitments: separate approvals, verified deliveries and payments. Currently approved asks establish only the commitment total. Change the renderer's blanket "with a written reason" unless the service actually enforces it for every included decision.
- Independent adoption: add an explicit, audited house/outside breakdown if that is needed to evaluate demand. A public-floor count is not a customer count; participant and auth-account counts cannot estimate humans versus bots. Do not publish a new composition number until its classification is defined.
- Operating costs, cash, runway, staffing and concentration: these are absent. They matter to a buyer or funder, but should be computed from recorded sources or marked unpublished. No values should be inserted into prose.

### Repair provenance and consistency

The database is the source, but requests currently share cached results and the constituent queries do not use one transaction snapshot. Publish computation and observation times where they differ; either align the calculations to a common instant or document their bounded skew. The verification route is evidence provenance, not a promise the endpoint cannot contain bugs.

Define missing-data states per block. A failed feed is currently a rejected request, not a complete document with null fields. Do not claim otherwise. Remove dash glyphs from missing-value rendering to comply with the brief's punctuation rule.

Keep omitted blocks available in `/api/data-room`. Before restoring them, the funnel needs actual linked cohorts, the signup total needs its opening balance, and shipping needs author-date versus deployment-date labels plus a clear quoted-list limit. Raw commit pace is still not an adoption metric.

Update the hardcoded page lead to match the shorter contents and acknowledge cached readings. If part names change later, make the frontend consume the server's declared names rather than maintaining another list. The parser currently collects a section's prose separately from all its blocks; it does not preserve inline block insertion positions. This rewrite puts explanatory prose before the blocks accordingly.

## Scope and verification

Only `FINDINGS.md`, `PROPOSAL.md` and `functions/src/content/data-room.ts` are deliverables. Backend, frontend, governing docs, browser specs and tests remain unchanged as instructed. The brief explicitly says not to run the test suite. Static review checks the content's headings, part/block directives, punctuation and absence of typed figures; no browser or production verification is claimed. Any later implementation of the recommendations needs the corresponding governing-doc, tests and browser-spec changes.
