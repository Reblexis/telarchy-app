# First conformance audit, 2026-08-25

Non-author verification of `telarchy-app` against its `./docs`, per
[ddd-practice](https://github.com/Reblexis/ddd-practice) (`docs/practice.md`,
`implementation/operating.md`: the conformance loop, doc quality, derived
runtime documents, the human-readable mirror). Read-only: nothing under `docs/`
or in code was changed; this file is the only artifact.

State audited: working tree at `055e4b1` at start; during the audit other
sessions committed `4bf63b9` (21:42, practice footer, contributor statement,
`browse/index.html`, `scripts/build-docs-mirror.py`), `e7d6845` (21:43,
`docs/infra/deploy.md`), `6a703e3` (21:50, mirror regenerated). Both states are
recorded where they differ. Line numbers are those of the file at the moment it
was read; `docs/infra/deploy.md` grew from 658 to 667 lines mid-audit and its
numbers are for the 667-line version.

Method: every file under `docs/` was read in full (6,774 lines at start). Doc
quality was judged per the practice's five failure modes. For the contract docs
each checkable claim was listed, precise ones first, and checked against
`functions/src` (routes, services, lib, middleware, db, drizzle) and `src/` for
UI claims. Four areas were verified by separate fresh agents (guides and legal
derivation, the five long docs, `seasons.md`, `vision.md`); the rest by the
auditing session. Only claims that were actually traced to a file and line are
reported as CONFORMS.

## Summary

Code vs docs, 275 claims checked across 13 documents:

| Classification | Count |
|---|---|
| CONFORMS | 192 |
| Code bug (doc right, code fails it) | 4 |
| Doc bug (code sensible, doc stale or wrong) | 48 |
| Ambiguity (two readings, code picked one) | 12 |
| Unspecified (significant behavior the docs never state) | 19 |

Per document (claims / conforms / code bug / doc bug / ambiguity / unspecified):

| Doc | Claims | C | Code | Doc | Amb | Unsp |
|---|---|---|---|---|---|---|
| `formulas.md` | 12 | 9 | 0 | 1 | 1 | 1 |
| `metrics.md` | 5 | 3 | 0 | 1 | 0 | 1 |
| `agent-economy.md` | 16 | 12 | 0 | 3 | 1 | 0 |
| `data-room.md` | 16 | 14 | 0 | 2 | 0 | 0 |
| `limit-orders.md` | 24 | 18 | 0 | 3 | 2 | 1 |
| `market-integrity.md` | 25 | 22 | 1 | 1 | 1 | 0 |
| `seasons.md` | 60 | 40 | 2 | 10 | 2 | 6 |
| `vision.md` (three areas) | 78 | 55 | 1 | 11 | 3 | 8 |
| `agent-telemetry-protocol.md` | 12 | 7 | 0 | 3 | 1 | 1 |
| `infra/deploy.md` | 18 | 8 | 0 | 8 | 1 | 1 |
| `about-page.md` | 5 | 3 | 0 | 2 | 0 | 0 |
| guides and legal derivation | 4 | 1 | 0 | 3 | 0 | 0 |

Doc quality: 33 files, 267 lines carrying a date. 15 governing files hold
records (dated decisions, owner quotes, incident and fix history) that the
practice says live outside `./docs`; three files (`ui-conventions.md` 120 dated
lines, `vision.md` 49, `seasons.md` 33) are changelogs wearing a doc's title;
one (`otto.md`) is a research memo, not a spec; `infra/deploy.md` is a runbook
with four factually wrong claims. The index (`docs/README.md`) is complete and
every listed file exists. Guides derive exactly (zero drift); legal text is
hand-copied into code and the privacy policy's version stamp is behind the
served one. Nothing consumes `./docs` at run time. The mirror, footer and
contributor statement were missing at the start of the audit and present, with
one seven-minute staleness, by its end.

The five most important divergences:

1. `vision.md:354-357` says approving a paid contract IS the payment because
   the platform moves the money; no code path pays `askUsd` (`contract_payment`
   is declared in `services/credits.ts:45` and applied nowhere), and
   `vision.md:578-608` has the owner paying by hand. Doc bug, and the doc is
   the root vision.
2. `seasons.md:385, 404, 413-417` still reasons from a `score > 0` prize bar;
   `lib/seasons.ts:142-144` and `legal/season-0-rules.md` (amended 2026-08-22)
   pay by place alone. The design doc never records the amendment. Doc bug.
   The same stale bar and the pinned-set claim are served to API participants
   in `/api/help` (`help-catalog.ts:1111, 1160, 1167`). Code bug.
3. `routes/leaderboard.ts:277-280` computes the all-time board's
   `seasonPrizeUsd` over the PINNED season workspace set while `/season`
   standings and settlement use every public workspace (`seasons.md:19-23`).
   Code bug: a floor published mid-season shows a different prize on two
   surfaces.
4. `market-integrity.md:90-92, 102-104` says `proposal_revisions` is
   append-only; migration 0066 creates the table without the append-only
   trigger that 0055 and 0060 attach to the other four ledgers. Code bug.
5. `limit-orders.md:61` says "no cron loop"; `server.ts:161-170` runs a
   12-second in-process sweep that fills crossed resting orders without a
   trade. `limit-orders.md:66` says only orders inside the range the price
   just crossed fill; `services/trading.ts:425-437` fills any crossed order.
   Doc bugs; the code is the intended behavior (owner report 2026-08-11).

## Doc quality (per file)

Legend: (a) records accreted, (b) narration, (c) tests or step lists inside
the doc, (d) restates behavior another doc or repo owns, (e) structure.

### `docs/README.md` (25 lines)

- (a) none. (b) none. (c) none.
- (e) Index of every file: all 33 files are covered directly or via
  `guides/`, `legal/`, `infra/deploy.md`; every entry exists. Line 3 cites
  `` `CONTRIBUTING.md` `` without a path (it lives at the repo root).
- At start: no statement that contributors follow the practice. After
  `4bf63b9`: lines 4-9 state it, link ddd-practice, name the mirror and the
  script. Line 22 says `otto.md` owns "Otto, the in-app assistant"; it does
  not (see `otto.md` below; `vision.md:548-576` does).
- Verdict: designed index; two nits.

### `docs/vision.md` (901 lines)

- (a) 49 dated lines, about 55 markers: 5, 29, 39, 50, 66-67, 82, 96-98, 210,
  234, 475, 478, 483, 488, 490, 492, 494, 503, 509, 511, 513, 515, 521, 522,
  524, 530, 532, 534, 540, 548, 556, 558, 560, 562, 566, 570, 572, 574, 578,
  591, 610, 614, 620, 694, 807, 846, 861, 863, 892, 896. Eight verbatim owner
  chat instructions stored in the doc: 97-98, 494, 503, 515, 530, 556, 566,
  591-592. A stale DONE block trails the Tests section (892-901: says
  telarchy.com redirects to `/lookpilot` and the console is in alpha; line 807
  says the console was deleted 2026-08-19).
- (b) Pitch and investor register: 7-9, 22-27, 130-146, 152-155, 171-228
  (benchmark table, "strictly better growth model"); stage report and
  founder bio 234-253; a 130-line second-person tutorial on writing proposals
  265-398; motivating stories at 486, 492, 511, 534, 540, 562, 616, 618; Otto
  prompt rules as prose at 558.
- (c) 865-889 "Tests" table of test files with `npm test` and integration env
  vars; 863 self-hosting steps; 745 settlement env steps; 755-761 hook watcher
  file format; 739 which UI panels render which endpoint.
- (d) 429-436 and 470-476 restate `agent-economy.md` (capabilities, auth,
  credits, joining) and the two copies disagree with the code (three
  capabilities vs four, see P26). 496-499 announcements API duplicated in
  `agent-economy.md:72-73` and `help-catalog.ts:799-813`. 503-507 duplicated
  in `ui-conventions.md:839-880`. 546 and 823-825 duplicated in
  `ui-conventions.md:359-364, 467`. 556-572 Otto (owner unclear, see
  `otto.md`). 574 data room. 82-91 seasons. 692-694 void refund. 805-830
  navigation. 857-863 infra. Dangling references: `go-to-market.md` (202)
  and `docs/canvas/value-prop-canvas.html` (220) do not exist.
- (e) Accreted log. "Current State" (419-761) is twenty subsections in
  shipping order (Phase 1, 2, Formula, 4, 1b, dated features, 5, 7, 8);
  revisions appended inline rather than folded (503, 513, 515, 694); a
  superseded plan kept beside its replacement (846-848); the charter
  enforcement rule under "Per-market position cap" (626); the notifications
  inbox 100 lines from the matrix it belongs to.
- Verdict: fails (a), (b), (c), (d), (e). Disposition: a root vision of
  ~150 lines (what Telarchy is, the mechanisms as present-tense rules, the
  business model); the proposal-writing tutorial to `docs/guides/`; the
  tests section to `CONTRIBUTING.md`; every dated marker and owner quote to
  the telarchy umbrella `notes/` (decision log), referenced once.

### `docs/formulas.md` (65 lines)

- (a) 1: lines 55-65 "History" (`DECIDED 2026-08-24`, the C1 security
  finding, production counts at the switch, the parity script).
- (b) none. (c) none. (d) `docs/guides/formulas.md` is a second,
  independently worded grammar (one shared line); one should derive from the
  other.
- (e) Designed: grammar, rejected, arithmetic. The best-formed doc in the set.
- Verdict: passes except the History section. Disposition: move 55-65 to
  `notes/`, keep one sentence ("`^` is power; it was bitwise XOR before
  2026-08-24, see notes").

### `docs/agent-economy.md` (84 lines)

- (a) 3: line 13 "added 2026-07-12"; 21 "Added 2026-08-24"; 62 "revised
  2026-08-07: previously this read ... and the code matched" (fix history).
- (b) 82-84 "Operational rule" instructs maintainers ("update this file ...
  immediately"), a process note rather than a specification.
- (c) none. (d) 66-80 "Main APIs" restates the endpoint catalog
  (`functions/src/lib/help-catalog.ts`), which AGENTS.md names as the owner
  of the API surface; it has already drifted (the announcements shape lacks
  `publishedBy`, `POST /api/onboard` is paused).
- (e) Designed: identity, auth order, economy, trading, access, APIs.
- Verdict: mostly a spec; evict the three markers and the process note, turn
  "Main APIs" into references.

### `docs/agent-telemetry-protocol.md` (237 lines)

- (a) none.
- (b) Second-person coaching throughout: 15-24, 134-139, 155-163, 167-179;
  Python example 181-205.
- (c) 183-205 the example is the only place the required headers appear
  together.
- (d) The same wire protocol is defined four times: this file,
  `docs/guides/agent-telemetry.md` (served, points back here at line 62 to a
  path an `/api/guides` consumer cannot fetch), `help-catalog.ts:601-604,
  640-652`, and `~/src/telarchy/telarchy-agents/cli-agents/README.md:92-120`
  (the consumer). The three in this repo disagree on the entries cap (~25
  advisory here, "<= 25" in the guide, 40 rows / 64 KB hard in the catalog and
  the code).
- (e) Designed, but a third of it (207-224 display rules, 3-11 "appears in
  `/admin -> Bot agents`") specifies a panel deleted on 2026-08-19; no
  component under `src/` reads `agent-heartbeats` or `agent-traces`.
- Verdict: narrates; two numeric guarantees wrong (see conformance); half its
  purpose gone. Disposition: one owner for the wire contract (the catalog
  carries fields, caps, codes; the served guide carries the human spec); keep
  here only what the catalog cannot hold (outcome vocabulary, reasoning
  contract, cadence, retention 90 days) or delete; drop the display rules.

### `docs/data-room.md` (144 lines)

- (a) 4: lines 5-7 owner quote 2026-08-20; 100-101 owner direction quote;
  115 heading carrying "noted 2026-08-24 ... eng review 2026-08-24". (Line 84
  "History accumulates from 2026-08-20" is a fact of the published data, not
  a record.)
- (b) 103-108 rationale essay ("That split is deliberate ... would charge
  every visitor").
- (c) 142-144 names the test file as rule 4 (pointer to the guarantee,
  acceptable).
- (d) none material; references `ui-conventions.md` for the page design.
- (e) Designed: readers, rules, sources, privacy, Otto, change log, change
  rules. Names code paths (fine for a contract doc) but one is wrong (134,
  see conformance).
- Verdict: passes on structure; evict three records.

### `docs/limit-orders.md` (147 lines)

- (a) 1: line 3 "Status: built (2026-08-10)".
- (b) 6-20 "Why they matter here" motivational, with a LookPilot worked
  example; 136-139 "the Manifold lesson worth taking".
- (c) none. (d) 103-110 API restates the catalog (acceptable as the contract
  summary; the catalog agrees).
- (e) Designed: model, funds, execution, API, UI, non-goals. Internal
  inconsistency: the toggle is `Quick` / `Limit` at 118 and "at my price" at
  121. Three em dashes at 105-107.
- Verdict: a spec with a motivational preamble; three stale sentences (see
  conformance).

### `docs/market-integrity.md` (231 lines)

- (a) 7: line 9 owner ask quote 2026-08-18; 31 "Changed 2026-08-18"; 82
  owner ask quote 2026-08-20; 93-95 "revised 2026-08-22, Viktor: ..." quote;
  146-147 "Used once so far, on 2026-08-19, to move the Telarchy floor's
  clock"; 159 "owner decision 2026-08-18"; 212-213 the 2026-08-14 OOM
  incident.
- (b) 31-41 history of the old void-on-edit rule; 149-161 "reset-economy is
  gone" is a removal record; 165-171 "Before this ..." history; 192-195
  migration rationale.
- (c) 202-210 table of test files (the "Enforces" column is specification,
  the file names are derived artifacts).
- (d) none; this is the owner of the three invariants and other docs cite it.
- (e) Designed: three invariants, each with its rule, the record it leaves,
  and the sanctioned escape. 227-231 "Known gap, not closed" is a todo.
- Verdict: the strongest contract doc after `formulas.md`; evict the seven
  records and the history paragraphs, keep the invariants.

### `docs/seasons.md` (504 lines)

- (a) 36 marker lines (33 dated, 8 Viktor, 24 "owner"): 9, 10, 15-31, 33-37,
  39-43, 45-49, 71-73, 111, 189, 193, 256, 292, 305-309, 325-326, 332, 364,
  368-370, 374, 376, 388, 397, 401, 419, 437, 449, 457, 461, 473, 477, 481.
  Three sections are dated by shipping day ("What shipped on 2026-08-20",
  "What shipped on 2026-08-19", "The field on day one, 2026-08-22").
- (b) 3-7, 51-56 purpose prose; 120-127, 182-202, 225-229 argument register;
  387-417 a diary about a family member's entry; 449-455 session log; 502-504
  instructions to future agents.
- (c) 111-118 production snapshot table; 148-153 sizing analysis; 168-174
  ramp table (the spec of `scripts/season-liquidity-ramp.mjs:48-53`, kept);
  364-374 decision tracker; 382-385 day-one field; 439-440, 483-486, 499 test
  inventory; 442-455 QA-account cleanup log; 490-500 production checklist and
  a bug report.
- (d) Eligibility (354-355, 397-411, 461-475) owned by
  `legal/season-0-rules.md:93-99`; rule immutability (6-7, 24-28, 502-504)
  owned by the rules doc and the ToS; the profit formula (64-80) by the
  catalog and `lib/leaderboard.ts`; F7 void refund by `vision.md:694`;
  valuation of open positions by the rules doc 62-74; deletion freeze by
  `market-integrity.md:128-134`.
- (e) Accreted log. The first 50 lines are five stacked dated revisions that
  contradict each other (7 vs 24-28 on whether rules change; 189-194 vs
  305-312 on whether the hero market resolves before or after the end). F1's
  mitigation is written and then reversed in place (182-202 vs 256). The
  lifecycle (draft/running/settled, claim window, ladder validation, the
  5,000 USD ceiling) is not in the doc at all; the de facto spec is the
  header comment in `lib/seasons.ts:10-22`.
- Verdict: fails (a) through (e). Disposition: a ~120-line spec (score,
  scoring set, eligibility by reference to the rules, liquidity policy,
  lifecycle, failure modes as rules); every dated paragraph to `notes/`.

### `docs/otto.md` (214 lines)

- (a) 6: 3 (question quote, Viktor 2026-08-24), 29, 54, 99, 120, 143.
- (b) The whole file is a research memo answering a chat question ("Answer:
  don't adopt a harness", framework survey 27-50, benchmark table 52-81, eval
  narrative 106-186, recommendation 188-202, sources 204-214). No sentence in
  it is a declarative specification of Otto's behavior.
- (c) 106-118 describes the eval harness and its `--repeat` flag.
- (d) Otto's governing sentences live in `vision.md:556-570` and
  `data-room.md:95-113`; the endpoint contract in `help-catalog.ts:1027,
  1034`. `docs/README.md:22` names this file the owner; it is not.
- Prompt text: the literal prompt is NOT stored here. The prompts are
  hand-maintained constants (`functions/src/lib/ask.ts:37-56`,
  `functions/src/lib/setup-brief.ts:24+`); no code reads any doc. Doc vs
  code: the four tools match (`otto-tools.ts:108, 137`); `MAX_TOOL_ROUNDS =
  6` matches `ask.ts:90`; "304 lines" is stale (335); of the "four rules"
  at 168-172 only "Never hand the blank page back" is findable in
  `setup-brief.ts:30`; the per-surface model and round budget at 192-196 are
  a recommendation the code does not implement (one `ASK_MODEL`, one
  `MAX_TOOL_ROUNDS`; only `SETUP_EFFORT` is per-surface, `routes/setup.ts:166`).
- Verdict: not a governing doc. Disposition: move verbatim to the umbrella
  `notes/otto-harness-research-2026-08-24.md`; replace with a short spec
  (two surfaces, identity guarantee, the hard rules the prompt must contain,
  tool set, round and token budgets and what exhaustion must do, the eval as
  the conformance check) or fold into `vision.md` and fix `docs/README.md:22`.

### `docs/metrics.md` (72 lines)

- (a) 2: line 54 "Added 2026-08-25 (Viktor: 'lets add revenue metric to
  telarchy')"; 62 "Added 2026-08-25 (Viktor: 'another metric of telarchy
  should be valuation ...')" (verbatim owner quotes).
- (b) "Why this metric" rationales are acceptable as specification of intent;
  line 3 cites "Lean Canvas cell #8", an artifact outside the repo.
- (c) none. (d) 58, 66 restate the three-clock rule owned by
  `ui-conventions.md` ("Two steppers"), by reference.
- (e) Designed. But see conformance: five of its seven metrics are computed
  nowhere, and the one metric the self-sync actually pushes is not in it.
- Verdict: a definitions doc with two records and a false "canonical
  computation" claim.

### `docs/ui-conventions.md` (1429 lines)

- (a) 120 dated lines, 14 Viktor, tens of verbatim owner quotes. Sample: 4,
  10, 33, 37, 100, 128, 146, 152, 166, 175, 214, 235, 310, 316, 352, 518,
  532, 536-537, 566, 574, 576-578, 611-612, 639, 657-661, 746, 768, 788, 804,
  826, 839, 854, 880, 882, 942, 954, 963, 977, 997-998, 1008, 1032, 1040,
  1053-1056, 1059, 1065-1090 (26-line history of a removed feature), 1092,
  1121, 1139, 1156-1158, 1211-1218 (6-line owner quote block), 1243 (dated
  2026-08-26, tomorrow), 1273-1274 ("kept for the rule it records"),
  1332-1336, 1373-1386 (incident narrative), 1398-1403 ("Why the tests missed
  it").
- (b) 24-31 coaching; 380-389, 396-399 essay; 1065-1110 argument for and
  against a feature; 1186-1199; 1350-1354.
- (c) 1398-1403 test description; 1158-1166 incident write-up.
- (d) Engine and settlement rules living in the frontend doc: netting
  195-203 (`services/trading.ts`); anchoring and `b` sizing 230-261; top
  traders scoring 599-636 restates `seasons.md` "The score"; proposal stake
  and Manifold import 813-823; announcements 839-852 restate `vision.md`;
  `resolvesNaUntilMeasured` 1338-1348 is a settlement contract that
  `help-catalog.ts:174, 196` and `routes/metrics.ts:551` cite as governed
  HERE; level metrics and `primaryMarket` 1296-1324; contract pair payload
  1388-1396; base-aware links 33-45 duplicate `infra/deploy.md:169-173`;
  data room 1405-1418 duplicates `data-room.md`.
- (e) Internal contradictions left standing: floor poll cadence 5 s (301) vs
  15 s (641; code is 15 s at `src/pages/TradePage.tsx:590`); settle date in
  the headline (113-116 vs 804-807 vs 1138-1146 vs 1235-1240); ticket "not a
  panel" (697) vs "a card, superseding not-a-panel" (145-147); presets
  (148-149 vs 709-710); jobs board location (268-269 vs 812); metric
  description placement (684-689 vs 815-817 vs 1264); Otto placement
  (373-389 vs 418-431); "Jobs" (269) vs "Contracts" (1045); arrows current
  (1231-1242) vs gone (1243-1257) vs kept (1273-1294); 367-371 and 412-416
  are the same paragraph pasted twice. "Trading floor" runs 96-727 as one
  stream of bolded revision paragraphs; 804-1403 (600 lines) sit after "When
  in doubt" with no structure but dated leads.
- Verdict: a changelog wearing a doc's title. Disposition: ~200 lines of
  present-tense rules per surface; history to the umbrella `notes/`
  (`notes/floor-redesign-2026-08-24.md` already exists there); engine and
  settlement rules to `vision.md` or `market-integrity.md` with the code
  comments repointed (`routes/metrics.ts:551`, `services/predictions.ts:59,
  357`, `lib/baseline-order.ts:9`, `lib/contractors.ts:8`,
  `routes/marketplace.ts:797`).

### `docs/about-page.md` (85 lines)

- (a) 3: line 3 "added 2026-08-21 (owner ask)"; 19-28 "Revised 2026-08-22
  (Viktor)" with a verbatim quote and a canvas-approval stamp (61 is by-line
  copy, legitimate).
- (b) 19-28 is a change record. (c) none.
- (d) 13-17 restates AGENTS.md "Canonical positioning".
- (e) Small and designed (purpose, rules, `/about` copy, `/contact` copy).
- Verdict: passes minus one record block and one duplicate.

### `docs/infra/deploy.md` (667 lines)

- (a) 23 dated lines, 2 Viktor: 20, 24, 147, 186, 223, 242-243, 269, 349,
  357, 390-394 (inside a bash block), 406, 412-413 ("I read the numbers once
  and reported a rollback that had not happened"), 434, 457, 497, 513, 528,
  555, 562, 565-567, 592, 604, 643.
- (b) 10-18, 35-39, 178-184 (three-bugs anecdote), 307-316 (proxy-order
  incident), 427-432, 453-455.
- (c) Runbook material throughout: 52-143 one-time GCP setup (two gcloud
  scripts plus GitHub UI clicks); 331-344 publish and rollback commands;
  383-399 IAM script; 421-425; 534-543 rotation steps; 569-576 cron rollback;
  624-632 quota curls; 659-662 logging query. (Judgment call for an ops doc;
  the guarantees around them are the spec.)
- (d) 169-173 restates the base-path rule; 242-260 restates a perf plan held
  in umbrella notes; 580-584 mail matrix restates `vision.md`; 13-14 and
  32-50 runner and box operations duplicate
  `~/src/agent-economy/docs/operations.md:101`, the declared owner of
  machines and runners.
- (e) Accreted: title says "Backend deploy", content spans runner ops, GCP
  bootstrap, the beta design, connection budget, perf posture, Cloud Run
  gotchas, IAM, key rotation, cron, mail, AI budget, memory. Four claims are
  factually wrong (see conformance).
- Verdict: fails (a), (c), (d), plus wrong facts. Disposition: ~120 lines of
  pipeline guarantees; runners to `agent-economy/docs/operations.md`;
  scripts to a runbook; incidents to `notes/`.

### `docs/guides/*.md` (16 served files plus README)

Served at `/api/guides`; second-person tutorial register is their purpose and
is flagged only where it hides a defect.

- `onboarding.md` (304): (a) line 9 dated changelog note "Opening a floor
  (2026-08-21)". (b) 13-33 is prompt text stored as documentation ("Behave
  like a good setup wizard", "Open warmly", "Land the ending"); 204, 210, 242
  scripted lines to say verbatim. Internal contradiction: line 9 says
  `POST /api/onboard` "is still paused (403)" while Step 3 (90-107) presents
  it as "the default path".
- `api-reference.md` (163): (d) wholesale. Line 9 admits `/api/help` is the
  source of truth, then hand-restates 78 of its ~160 paths. Verified
  omissions: `/api/legal/season-0`, `/api/legal/season-1`, `/api/leaderboard`,
  `/api/guides/_categories`, `/api/feedback/stats`, `/api/feedback/:id`,
  `/api/agents/:idOrNickname/public`, `/api/import/manifold/*`,
  `/api/data-room`. Lines 42-44 document `deposit` and `withdraw` while the
  terms (`legal/terms-of-service.md:13`) say no deposits or withdrawals exist
  and `credits.md:61` says the managed instance does not offer them.
- `agent-telemetry.md` (62): (d) condensed copy of
  `agent-telemetry-protocol.md`; line 62 points at a repo path.
- `agent-api.md` (157): (a) 73 "null on rows written before 2026-04-23"; 40
  "for back-compat with pre-dual-branch clients". Inconsistent: 25 recommends
  `marketId` + `targetValue`, 55 and the samples at 111-153 use the form the
  guide calls second-best.
- `auth-and-keys.md` (157): (a) 127 "keys created before scopes were
  introduced are stored as `["*"]`" (migration record); 33 names the DB
  table.
- `markets.md` (68): (d) 29 and 49 state cron minutes owned by
  `infra/deploy.md`; 47-49 "no longer" narration; 16 em dashes.
- `overview.md` (37): (d) 13-19 positioning copy owned by `vision.md`.
- `formulas.md` (71): (d) second grammar, see `docs/formulas.md`.
- `time-preference.md`, `recipes.md`, `metric-design.md`, `feedback.md`,
  `creating.md`, `credits.md`, `proposals.md`, `sources.md`: clean or
  legitimately tutorial. `guides/README.md`: mechanism only, claims verified
  (script, npm scripts, sync test, four category ids).
- Em dashes in guides: markets 16, api-reference 11, recipes 4,
  agent-telemetry 3, time-preference 3, agent-api 2, onboarding 1.

### `docs/legal/*.md`

- `privacy-policy.md` (53): stamp `2026-08-11 (version 1.2)` at line 3 is
  stale; served text is `2026-08-17 (version 1.5)` (see derivation below).
- `terms-of-service.md` (59): clean; version stamp only.
- `season-0-rules.md` (116): 3-17 amendment preamble, 51 "(amended
  2026-08-22, see above)", 19-22 apologetic register. The amendment record is
  legally load-bearing (ToS 3a requires mid-season changes to be announced),
  so it stays; flagged only.

## Code vs docs (per doc, per claim)

Format: claim (doc line) | code (file:line) | verdict [classification, fix].

### `docs/formulas.md`

1. Grammar 10-19 (expr/term/unary/power/atom, `**` alias, `+` unary) |
   `lib/formula/parse.ts:157-257`, `tokenize.ts:63-67` | CONFORMS.
2. Whitespace inside braces trimmed; missing metric evaluates as 0 (22-23) |
   `tokenize.ts:44`; `lib/metrics-engine.ts:13` | CONFORMS.
3. Unknown value makes the formula null, never 0 (24-25) |
   `evaluate.ts:42-45`, `metrics-engine.ts:19` (`evaluateFormula`) | CONFORMS
   for current-value evaluation. `evaluateFormulaAtTime` (`metrics-engine.ts:
   36-70`) has no null path: a leaf without a consensus at the date
   contributes 0 (line 51). DIVERGES [ambiguity: the sentence is about the
   value, the projection is not covered. Add: "In a time-preference
   projection, a leaf with no market on the sampled date contributes 0."].
4. Precedence and associativity, `-2^2 = -4`, `2^3^2 = 512` (26-28) |
   `parse.ts:183-205` | CONFORMS.
5. Arity table (29-30) | `parse.ts:117-126, 241-245` | CONFORMS.
6. Empty or `0` marks a leaf (31-32) | `metrics-engine.ts:6, 247` | CONFORMS.
7. Rejections with column: bare identifier message text, `%`, comma outside
   call, unterminated `{` (36-43) | `parse.ts:222` + `tokenize.ts:22`
   ("... at column N"); `tokenize.ts:88`; `parse.ts:150`; `tokenize.ts:43` |
   CONFORMS.
8. "The formula editor shows the error" (45) | no formula editor exists under
   `src/` (the console was deleted 2026-08-19; `grep formula src/**/*.tsx`
   hits only `SeasonPage.tsx`); `validateFormula` (`metrics-engine.ts:77`)
   has no caller outside tests; `POST`/`PUT /api/metrics`
   (`routes/metrics.ts:240-246`) check circularity only and store any string
   | DIVERGES [doc bug: there is no editor. And unspecified: the API accepts
   a formula that does not parse. Proposed sentence (owner decision): "A
   formula that does not parse is refused by `POST` and `PUT /api/metrics`
   with 400 carrying the message and column." If accepted, that is a code
   change (call `validateFormula` in both routes).].
9. Stored unparseable formula evaluates to 0 and logs (45-47) |
   `metrics-engine.ts:25-27` | CONFORMS.
10. IEEE doubles; NaN evaluates to 0 with a logged error; nothing rounded
    (51-53) | `evaluate.ts` uses native operators; `metrics-engine.ts:20-22`
    | CONFORMS.
11. Engine lives in `functions/src/lib/formula/`; only interpreter (4) |
    `lib/formula/index.ts:88-91`, `metrics-engine.ts:2` | CONFORMS.
12. `scripts/formula-parity.mjs` exists (64) | present | CONFORMS (a record,
    not a rule).

### `docs/metrics.md`

1. "This doc is the canonical definition and computation" (3) and "Each
   metric here exists as a KPI in that workspace" (72) | no code computes
   weekly active workspaces with a priced decision, W1->W4 retention,
   liquidity-weighted Brier, positive-PnL forecaster count, or the
   predicted-vs-realized correlation (`grep -rl Brier functions/src` empty;
   `services/platform-stats.ts` has no cohort logic) | DIVERGES [doc bug:
   replace "canonical definition and computation" with "canonical
   definitions; none of the engagement or network-quality metrics is computed
   by the platform today, they are hand-entered or absent"].
2. The hero metric actually synced, `weeklyActiveVerifiedTraders`
   (`scripts/telarchy-self-sync.js:10-11, 105-106`; `help-catalog.ts:1083`
   calls it "the resolution source for the Telarchy dogfooding workspace's
   hero metric") | not defined in `metrics.md` at all | DIVERGES
   [unspecified: add its definition (distinct participants with a Manifold
   account synced and >= 100 credits of trades in the trailing 7 days) to
   the Network quality section].
3. Revenue: no rail, owner logs by hand, the self-sync will push it the way
   `weeklyActiveVerifiedTraders` is pushed (57) | `telarchy-self-sync.js`
   pushes only `weeklyActiveVerifiedTraders`; consistent with "when a rail
   exists" | CONFORMS.
4. Valuation declared `resolvesNaUntilMeasured`, markets void N/A with all
   bets refunded (65) | `services/predictions.ts:54`;
   `resolves-na-until-measured.test.ts` | CONFORMS (mechanism; the
   workspace's own configuration is data, not checkable here).
5. Three markets per floor metric (58, 66) | owned by `ui-conventions.md`
   ("Two steppers"); `lib/baseline-order.ts:9` cites it | CONFORMS by
   reference (not re-verified here).

### `docs/agent-economy.md`

1. `POST /api/onboard` creates a workspace-owning participant in one call
   (13) | `routes/onboard.ts:50-58` answers 403 "paused" unless
   `OWNER_ONBOARDING_OPEN=1`; `vision.md` "The owner side reopens" and
   `guides/onboarding.md:9` know this | DIVERGES [doc bug: append "Paused:
   the endpoint answers 403 unless the instance sets
   `OWNER_ONBOARDING_OPEN=1`; owners create a workspace via `POST
   /api/workspaces` after signing up."].
2. Unclaimed grant `UNCLAIMED_SIGNUP_CREDITS` default 100 clamped to
   `SIGNUP_CREDITS`; claim tops up (13) | `lib/validation.ts:101-103`;
   `routes/onboard.ts:263` | CONFORMS.
3. Nickname 3-30 chars, `[A-Za-z0-9_-]`, case-insensitive unique (15) |
   `lib/validation.ts:19-28`: first character must be alphanumeric
   (`^[A-Za-z0-9][A-Za-z0-9_-]*$`); uniqueness via `LOWER(nickname)`
   (`lib/participants.ts:141`, `routes/agents.ts:310`) | DIVERGES [doc bug,
   minor: "3-30 chars, `[A-Za-z0-9_-]`, starting with a letter or digit".
   Note the code's own error string uses an en dash between 3 and 30, against the
   repo's style rule.].
4. Attribution: `source` slug `[a-z0-9-]{1,32}`; `ta_ref` cookie 30 days;
   register accepts `source`; `POST /api/agents` inherits the creator's;
   never on public profiles; activated-participants script with 3+ trades on
   2 days (21-30) | `lib/attribution.ts:12, 44`; `src/lib/ref.ts:7-8`
   (`30 * 24 * 60 * 60`); `routes/agents.ts:129-132, 202, 1085-1088`;
   `scripts/activated-participants.mjs` present | CONFORMS.
5. Auth order master key, session, agent key (34-38) |
   `middleware/auth.ts:125, 137, 169` | CONFORMS.
6. Nanocredits, 1 credit = 1e9 (45) | `lib/validation.ts:72` | CONFORMS.
7. `SIGNUP_CREDITS` default 1000; registration succeeds at 0 (46) |
   `lib/validation.ts:76-91`; `economy.test.ts` | CONFORMS.
8. Self-join public or unlisted; private answers 404 indistinguishable from
   missing (62) | `routes/workspaces.ts:803-804`;
   `routes/marketplace.ts:1519+` (404 with the comment "so this cannot be
   used to probe") | CONFORMS.
9. Going private drops `trade` from the Public group, on every path including
   settings (63) | `routes/workspaces.ts:596-608` (settings) | CONFORMS for
   the settings route; other visibility-writing paths not enumerated.
10. Register requires `workspaceId`, auto-joins Public group (68) |
    `routes/agents.ts:147, 228-232`; `agent-register-auto-add.test.ts` |
    CONFORMS.
11. `GET /api/marketplace/:workspaceId`, no auth (70) |
    `routes/marketplace.ts:352-365` | CONFORMS. But a private workspace
    answers 403 "This workspace is private" (359-361), as do the history and
    announcements reads (1037, 1095), so the id IS probeable through the
    profile route even though the join route hides it (62) | DIVERGES
    [ambiguity: the 404 rule is stated for join only. Tighten 62: "... Every
    other public marketplace read answers 403 on a private workspace, so the
    existence of an id is not treated as a secret; only the join is hidden."
    Or make them all 404, a code change.].
12. Market history, oldest first, max 500, gated on Public `read` (71) |
    `routes/marketplace.ts:1011` (`slice(-500)`), gating block at 1092-1103 |
    CONFORMS.
13. Announcements shape `{ id, body, publishedAt, editedAt, originalBody }`,
    newest first, append-only, no delete (72) | `routes/marketplace.ts:
    1056-1069`: `desc(publishedAt)`, `.limit(100)`, and the payload also
    carries `publishedBy`; trigger in migrations 0057 and 0078; no DELETE
    route | DIVERGES [doc bug, minor: add `publishedBy` to the shape and
    "at most 100"].
14. `POST` and `PUT` announcements need `manage`; `publishedAt` server-side
    (73) | `routes/workspaces.ts:691-693, 713-719, 737` | CONFORMS (detail in
    the vision section, A1-A6).
15. `GET /api/agents/mine`, `POST /api/agents/transfer`, `GET
    /api/agents/transfers` (74-78) | `routes/agents.ts:242, 287, 368`;
    `help-catalog.ts:306, 375-379` | CONFORMS.
16. Balances global per participant (44) | `agents.balance` is one column on
    the participant row (`db/schema.ts:180+`), ledger rows carry
    `workspace_id` for provenance only | CONFORMS.

### `docs/data-room.md`

1. Content module `functions/src/content/data-room.ts`, `## ` headings become
   sections (34-36) | present; `data-room.test.ts:130` | CONFORMS.
2. Six known blocks, unknown throws at load (42-44) |
   `content/data-room.ts:20`; `data-room.test.ts:126` | CONFORMS.
3. `GET /api/data-room` public, uncredentialed (51) |
   `middleware/route-policy.ts:40`; `data-room.test.ts:149` | CONFORMS.
4. Cached 60 seconds (58) | `services/data-room.ts:42` `CACHE_MS = 60_000` |
   CONFORMS.
5. Contract counts exclude `removed` (62) | `services/data-room.ts:244-248`
   | CONFORMS.
6. Uncomputable term is `null`, rendered "not published" (67) |
   `data-room.test.ts:264` | CONFORMS.
7. `humanVisitFilter()` in `lib/visit-log.ts`, used by `/admin` and the data
   room (75) | `routes/admin.ts:148`; `services/data-room.ts:117, 280` |
   CONFORMS.
8. Raw visits purged at 30 days (79) | `services/maintenance.ts:26` |
   CONFORMS.
9. `traffic_daily` rollup written on every read, never purged, two counts
   and a date (80-83) | `services/data-room.ts:122-130` (upsert, greatest);
   `db/schema.ts:888`; maintenance never touches it | CONFORMS.
10. Otto tool `read_data_room`, index then one section (97-99) |
    `lib/ask.ts:45`; `data-room.test.ts:241` | CONFORMS.
11. "He gets at most three tool rounds" (110) | `lib/ask.ts:90`
    `MAX_TOOL_ROUNDS = 6` | DIVERGES [doc bug: "at most six tool rounds
    (two to reach a section, two to find and call an endpoint, a read then a
    write for a job)"].
12. Last request sent without tools (110-111) | `lib/ask.ts:300-303` |
    CONFORMS.
13. A failed lookup is handed back as text (111-113) | `data-room.test.ts:
    256` | CONFORMS.
14. Change log from `git log` via `scripts/build-changelog.mjs` into
    `content/changelog.ts`, committed, regenerated by `predeploy` (117-121) |
    `package.json:25`; module tracked | CONFORMS.
15. `[private]` counted, never quoted (123-127) |
    `scripts/build-changelog.mjs:13, 46` | CONFORMS.
16. "computed in `functions/src/routes/data-room.ts`" (134) | the route is 22
    lines; every number is computed in `services/data-room.ts` and
    `services/platform-stats.ts` | DIVERGES [doc bug: "computed in
    `functions/src/services/data-room.ts` from a live table"].

Not verified (UI): the `.pubws-doc` page design at 27-30.

### `docs/limit-orders.md`

1. Fields table (29-40) | `db/schema.ts:685-702` | CONFORMS except `status`:
   the code also writes `voided` (`services/trading.ts:541-583`
   `closeLimitOrderInTx` accepts `'voided'`; `releaseLimitOrdersForMarket`
   defaults to it, used by `services/markets.ts:154`) | DIVERGES [doc bug:
   status is `open | filled | cancelled | expired | voided`].
2. Direction and limit read together (42-46) | `trading.ts:366-368`
   `isCrossed`; placement guards `routes/predictions.ts:411-427` | CONFORMS.
3. Budget debited at placement into a reservation; cancel or expiry refunds
   the remainder (54-57) | `predictions.ts:452-459` (`limit_order_hold`);
   `closeLimitOrderInTx` (`limit_order_release`) | CONFORMS.
4. "No matching engine and no cron loop" (61) | `server.ts:161-170` runs
   `sweepLimitOrders` every 12 seconds, filling crossed orders with no
   triggering trade ("owner report 2026-08-11") | DIVERGES [doc bug: "No
   matching engine. Every trade triggers a fill pass in its own transaction,
   and an in-process sweep runs the same pass on every open market every 12
   seconds so an order crossed by a resolution, a liquidity change or a
   fill elsewhere does not wait for the next trade."].
5. Fill pass loads orders whose limit lies in `[c0, c1]` (66-68) |
   `trading.ts:425-437` selects any open order the CURRENT price has crossed,
   whatever range the trade moved through | DIVERGES [ambiguity, the code's
   reading is the sound one: "Load every open order on that market whose
   limit the current price has reached or passed"].
6. Deepest-crossed order fills first (67-68) | `trading.ts:430-436` |
   CONFORMS.
7. Buy min(remaining budget, amount to reach the limit); never past its own
   limit (69-72) | `trading.ts:469-474` (`targetValue` mode with `maxBudget`)
   | CONFORMS.
8. Stop when nothing is crossed (73) | `trading.ts:437` (`if (!next) break`;
   50-iteration backstop is internal) | CONFORMS.
9. Fills are ordinary trades through the one `executeTradeInTx` (75-79) |
   `trading.ts:54, 469`; `routes/predictions.ts:256-266` | CONFORMS.
10. Cap counts filled credits plus open reservations (79-81) |
    `trading.ts:325-345` `capUsage`; placement check `predictions.ts:439-448`
    | CONFORMS.
11. Each fill in its own savepoint; a failing fill unwinds alone (86-90) |
    `trading.ts:450-513` (`tx.transaction` per fill, catch, `blocked`) |
    CONFORMS.
12. Reservation released before the fill, unused part re-reserved (91-94) |
    `trading.ts:457-491` | CONFORMS.
13. Resolve or void refunds every resting order (96-97) |
    `services/predictions.ts:120` (`cancelled`), `services/markets.ts:154`
    (`voided`) | CONFORMS.
14. `POST /api/predictions/limit-orders` body, debits, 400 if already crossed
    (105) | `predictions.ts:327-486` | CONFORMS (also accepts `budget` and
    `amount` as aliases, internal freedom).
15. `GET ...?marketId=&status=`, admins may pass `agentId` (106) |
    `predictions.ts:492-548` | CONFORMS; the default when `status` is
    omitted is `open` and `status=all` lists every state | DIVERGES
    [unspecified: add "default `open`; `status=all` returns every state"].
16. `DELETE .../:id` cancel, refund, owner or admin (107) |
    `predictions.ts:555-575` | CONFORMS.
17. All three in `/api/help` and the skill (109-110) |
    `help-catalog.ts:438-452`; `telarchy-skill/.../SKILL.md` mentions
    `limit-orders` | CONFORMS.
18. `Quick` / `Limit` toggle in the ticket header, revealed once a side is
    picked, default Quick (118-120) | `TradeTicket.tsx:489`;
    `TradeTicket.test.tsx:30-38` | CONFORMS.
19. "Choosing `at my price` reveals one mono input ... confirm restates the
    whole instruction 'Buy higher with 25 cr while under $65,000'" (121-125)
    | the control is labelled `Limit` (118 and the code); the confirm reads
    "Buy Higher with 25 cr under $65,000" (`TradeTicket.tsx:324-331`) |
    DIVERGES [doc bug: name the control `Limit` in both bullets and quote
    the confirm as the code renders it].
20. Prefilled legal limit inside the call; wrong side refused in the ticket
    (126-129) | `TradeTicket.tsx:190-191`; tests 98-145 | CONFORMS.
21. Resting orders list under the ticket, one line each with cancel
    (132-135) | `TradeTicket.tsx:432-443` | CONFORMS.
22. Chart draws each resting order; above a handful, the trader's own only
    (136-140) | `MarketChart.tsx:30-33, 492-494` draws the VIEWER'S OWN
    orders only, always | DIVERGES [ambiguity: "The chart draws the viewer's
    own resting orders as faint rules at their limits"].
23. A limit order casts no ghost (130-131) | not verified.
24. Cap of 250 cr (18) | `workspaces.maxPositionCostPerMarket`
    (`trading.ts:311-317`) is per workspace; 250 is an example | CONFORMS
    (as an example).

### `docs/market-integrity.md`

1. I1: a definition edit never voids as a side effect (15-18) |
   `routes/metrics.ts:289-306, 385-397`; `metric-edit-does-not-void.test.ts`
   | CONFORMS.
2. Words apply in place; one `metric_definition_revisions` row per changed
   field; unchanged text writes nothing (53-62) | `routes/metrics.ts:
   686-706` (`recordDefinitionRevisions`, skips equal values) | CONFORMS.
3. Rename syncs `markets.metricName` on open markets (54-56) |
   `routes/metrics.ts:400-405` | CONFORMS.
4. `formula` and `marketRangeMax` refused with 409 naming the field and the
   open market (63-69) | `routes/metrics.ts:296-306` (`fields`,
   `openMarketId`, `targetDate`) | CONFORMS.
5. Leaf `value` always allowed; on a computed metric, setting `value` by hand
   overrides the formula and counts as machinery (70-72) |
   `settlementFieldChanges` (`routes/metrics.ts:656-668`) does count it, but
   line 258 forces `update.value = 0` on every computed-metric edit before
   that check, and the create route stores 0 for a computed metric (128), so
   a hand-set value is never stored and the "computed value" 409 can only
   fire if `oldRow.value` is non-zero, which no path produces | DIVERGES
   [doc bug: "On a computed metric `value` is not settable; a value in the
   request is ignored and the stored value is the formula's result."].
6. I1b: proposer or `manage` may edit; pending only, 409 otherwise (86-89,
   109-111) | `services/proposals.ts:776-786` (403, 409) | CONFORMS.
7. Words edit in place, pair untouched, `proposal_revisions` row (90-92) |
   `services/proposals.ts:843-859` | CONFORMS for the row; "append-only" is
   not enforced: migration `0066_proposal_revisions.sql` creates the table
   with no trigger, while 0055 and 0060 attach `telarchy_ledger_append_only`
   to the other four ledgers and `ledger-append-only.test.ts` covers only
   those | DIVERGES [code bug: new migration attaching the append-only
   trigger to `proposal_revisions`; extend `ledger-append-only.test.ts`. The
   Reconstruction section (219-225) lists four triggered tables and omits
   this one, so the doc should also add it there.].
8. Ask re-anchors while untraded (void and respawn); once traded the ask
   changes but markets stay (93-104) | `services/proposals.ts:822-841,
   862-871` | CONFORMS.
9. Title naming a different price than `askUsd` is 400 (105-108) |
   `services/proposals.ts:794-803` | CONFORMS (also 400 when the ask is 0 and
   the title carries a price, internal).
10. `payoutHandle` not part of the edit (113-114) | `ContractEdit` carries
    title, description, askUsd only | CONFORMS.
11. I2 table: void refused when traded; metric delete refused when any open
    market traded; workspace delete refused in a running season (124-128) |
    `routes/predictions.ts:1317-1320`; `routes/metrics.ts:442`;
    `routes/workspaces.ts:958`; `lib/market-freeze.ts` | CONFORMS.
12. Season membership read from pinned `prize_seasons.workspaceIds` (132-134)
    | `lib/market-freeze.ts:73-88` | CONFORMS.
13. Refusal is a 409 naming the count or the season (136-137) |
    `lib/market-freeze.ts:47-54, 82-86` | CONFORMS.
14. Escape: `acknowledgeTraded: true` plus a reason of at least ten
    characters, published on `market:resolved`; holders refunded (139-145) |
    `routes/predictions.ts:1317-1329`; `services/markets.ts:161-167` |
    CONFORMS for the mechanism. "Holders are still refunded in full" (144) vs
    the governing rule that a void refunds net cash floored at zero
    (`vision.md:692-694`, `services/markets.ts:110-160`) | DIVERGES
    [ambiguity: "Holders are refunded their net cash at stake, as any void
    does"].
15. `POST /api/system/reset-economy` gone (149-161) | `routes/system.ts:113`
    comment, no route; `credit-ledger-ownership.test.ts` pins it | CONFORMS.
16. I3: `applyCredits` the only writer, same transaction;
    `applyCreditsIfSufficient` floor (173-178) | `services/credits.ts:
    100-140`; ownership test | CONFORMS.
17. `credit_ledger` append-only under the same trigger (179-181) |
    `drizzle/0060:58-60` | CONFORMS.
18. Reason closed set of sixteen values (182-187) | `services/credits.ts:
    36-52`, identical list | CONFORMS.
19. Balance after stored on the row (188-189) | `db/schema.ts:614` | CONFORMS.
20. New participant at zero, granted through the ledger (190-191) |
    `signup_grant` reason; `economy.test.ts` | CONFORMS (by test, not traced
    to the register route).
21. Migration 0060 backfills `opening_balance` (192-195) | `drizzle/0060:85`
    | CONFORMS.
22. `workspace_id = 'platform'` for unscoped movements (196-197) |
    `services/credits.ts:60` | CONFORMS.
23. Tests table (204-210) | all five files exist under
    `functions/src/__tests__/` | CONFORMS.
24. Reconciliation aggregates in SQL (212-215) |
    `credit-ledger-reconciliation.test.ts:155-160` | CONFORMS.
25. Known gap: workspace delete removes `trades` and `liquidity_events` under
    `allowLedgerAdmin` (227-231) | `routes/workspaces.ts:976-980` | CONFORMS
    (gap still open).

Not verified (UI): the floor renders revisions under "What is this
market?" (59) and beside the contract (91).

### `docs/seasons.md`

Verified by a separate agent; claim numbers as in its report.

Score and marking:
1. Season score = profit now minus profit at start (61) |
   `lib/seasons.ts:117-119` | CONFORMS.
2. Profit grant-blind: payouts + open worth + refunds - net cash (64-69) |
   `lib/leaderboard.ts:112-130, 141-179` | CONFORMS.
3. All-time rows carry `settledEarnings`, `openEarnings`, total, ranking on
   total (73-78) | `routes/leaderboard.ts:205-219`; `lib/leaderboard.ts:
   198-213` | CONFORMS.
4. Profile reports the same two numbers (78-79) | `routes/agents.ts:749-750`
   | CONFORMS.
5. Season standings do not split (79-80) | `routes/leaderboard.ts:410-415` |
   CONFORMS.
6. Ranking key is profit; calibration and accuracy reported only (82-86) |
   `routes/leaderboard.ts:203-219` | CONFORMS.
7. Open position valued at shares x current payout factors, resolved or not
   (238-239, 262-265, 479-481) | `lib/leaderboard.ts:70-78, 163-168` |
   CONFORMS.
8. "`TradeTicket.tsx:287` shows position worth from `previewSell`" (245) |
   now `src/components/TradeTicket.tsx:348` | DIVERGES [doc bug: drop the
   line number].
9. `marked-profit-consensus.test.ts` pins the convention (483-486) | tests
   at 51, 60, 116 | CONFORMS.

Eligibility and prizes:
10. "none, `score > 0` fails" (385); "ineligible anyway because his mark is
    negative" (404); "$500 of live claim ... one under water" (413-417) |
    `lib/seasons.ts:142-144` `isPrizeEligible` returns `!platformOperated`
    only; `legal/season-0-rules.md:9-12, 51-54` amended 2026-08-22: place
    alone decides; `seasons.test.ts:110` "a losing field is still paid by
    place" | DIVERGES [doc bug, major: the design doc never records the
    2026-08-22 amendment. Add under Status: "Amended 2026-08-22 (owner): the
    score-above-zero bar is gone; place alone decides the prize, negative
    scores included. Only `agents.platform_operated` disqualifies." and
    rewrite 385, 404, 413-417.].
11. `isPrizeEligible` was one line, `score > 0` (423) | history, consistent
    with migration 0069's comment | CONFORMS as history.
12. House accounts rank but never take a rung; `agents.platform_operated`,
    migration 0069 (352-355, 374) | `lib/seasons.ts:181-190`;
    `drizzle/0069` | CONFORMS.
13. Which ids the flag covers (429-431) | 0069 sets `lookpilot-kpi-sync`,
    `lookpilot-roadmap`, `telarchy-self-sync`, `admin` and nicknames incl.
    `telarchy-agents`, `adminbot` | CONFORMS.
14. "`platformOperatedIds` is the only reader" (431-434) |
    `routes/admin.ts:742` and `lib/attribution.ts:84-101` also read the
    column | DIVERGES [doc bug: "the only reader on the money path; admin
    listing and attribution read the column for display and filtering"].
15. Ineligible is not hidden (436-438) | `lib/seasons.ts:182-189`;
    `seasons.test.ts:250-270` | CONFORMS.
16. Four tests pin it (439-440) | `describe('platform-operated entrants')`
    has four | CONFORMS.
17. Four QA accounts flagged in 0070, entries kept (442-447) |
    `drizzle/0070` | CONFORMS.
18. Workspace owners eligible: rules, served copy, season page, no code gate
    (461-475) | `season-0-rules.md:95-97`; `routes/legal.ts:224`;
    `SeasonPage.tsx:154-157`; no owner check in `lib/seasons.ts` | CONFORMS.
19. One entry per payout handle deferred (296-297, 373) | no such check in
    `routes/seasons.ts:551-617` | CONFORMS (deferred).
20. 48h time-weighted mark and activity floor deferred (371-372) | settle
    reads one instant | CONFORMS (deferred).
21. Five-rung ladder, $500 top (89, 286) | `season-0-rules.md:43-49` |
    CONFORMS (production data).

Scoring set and settlement:
22. Season scores over ALL public workspaces live; standings and settle read
    the same set (19-23) | `routes/leaderboard.ts:404-409`;
    `routes/seasons.ts:566-571` (`publicNow`) | CONFORMS.
23. Same claim, third surface: the all-time board's `seasonPrizeUsd` column
    | `routes/leaderboard.ts:277-280` `currentSeasonPrizes` uses the PINNED
    set (`pinned.filter(id => publicIds.has(id))`) | DIVERGES [code bug: use
    `publicNow` as `seasonStandings` does; add a test that a mid-season
    public workspace moves the prize column].
24. Pinned `workspaceIds` remain as a record (22-23) | `services/seasons.ts:
    50-51, 91`; `workspacesDropped` at `routes/leaderboard.ts:446` |
    CONFORMS.
25. What the pinned set still governs | `lib/market-freeze.ts:73-88` refuses
    deletion by the pinned set, so a floor published mid-season is scored
    but not frozen | DIVERGES [unspecified: add "Deletion freeze
    (`market-integrity.md`) still reads the pinned set, so a floor that goes
    public mid-season is scored but not protected from deletion."].
26. "Final standings are read at one fixed timestamp inside a transaction"
    (301-302) | `routes/seasons.ts:570-571` `loadBoard` runs outside the
    `db.transaction` at 592-606 (several queries, not snapshot-isolated) |
    DIVERGES [ambiguity: "Settlement reads the board once, uncached, then
    writes every final in one transaction; the read itself is not
    snapshot-isolated."].
27. No `endsAt` guard on settle (36-37) | `routes/seasons.ts:559-560` status
    only | CONFORMS.
28. End date may move only while draft (12-13) | `routes/seasons.ts:463-465`
    | CONFORMS.
29. Season 0 started via `POST /api/cron/seasons` (378) |
    `routes/cron.ts:51-62`; `services/seasons.ts:114-136`;
    `season-autostart.test.ts` | CONFORMS.
30. Draft standings list entrants in entry order, no score (29-31) |
    `routes/leaderboard.ts:339-367` | CONFORMS.

Entry:
31. "Entry already requires payment details on the account plus explicit
    rules acceptance (2026-08-19)" (291-292) | `routes/seasons.ts:289-294`
    "NO payment-details gate ... added and removed the same day";
    `season-preregistration.test.ts:362` | DIVERGES [doc bug: "Entry
    requires rules acceptance, an 18+ confirmation and a contact email;
    payment details are asked at claim time."].
32. No duplicate-contactEmail guard (33-37) | `routes/seasons.ts:269-278` |
    CONFORMS (declined).
33. ToS bumped to 1.5 with the mid-season-change exception (24-28) |
    `routes/legal.ts:10, 40` | CONFORMS.

Liquidity and ramp:
34. House exposure `b ln 2`; anchored open sizes b down (95-102) |
    `lib/amm.ts:140-145` | CONFORMS.
35. `dp = p(1-p) dq / b`; at p = 0.5, X credits buys about 2X shares (98,
    137-139) | verified numerically | CONFORMS.
36. Every number in the three impact tables (114-118, 148-153, 168-174) |
    recomputed with `cost = b ln((e^{q/b}+1)/2)` over a $25,000 range, all
    match to rounding | CONFORMS. (The script comment at
    `season-liquidity-ramp.mjs:41` says $2,588 and $1,330 for b = 4,000 and
    8,000; the doc's $2,766 and $1,469 are the correct values.)
37. Ramp schedule 1,386 / 2,772 / 5,544 / 11,576 at days 0/7/14/21 (162,
    168-174) | `season-liquidity-ramp.mjs:48-69` | CONFORMS.
38. Daily linear steps, idempotent top-up (176-178) | script `targetPool`,
    skip when `top <= 1` | CONFORMS.
39. Every open market, baseline and branches (179-180) | script fetches
    `status=open&kind=all&limit=200` | CONFORMS.
40. Ramp unscheduled anywhere (34-36) | no cron, systemd or scheduler
    reference | CONFORMS.
41. Every new market on a season workspace opens at the season b via
    `newMarketLiquidityCredits` (206, 490-491) | `routes/predictions.ts:
    963-964`; `services/proposals.ts:269-271` | CONFORMS.
42. "Branches inherit whatever the workspace auto-fund happens to be"
    (210-214) | same code; reads as a stale complaint now that the auto-fund
    is the season pool | DIVERGES [doc bug, minor: "Branches take
    `newMarketLiquidityCredits` at spawn, set to the season's opening pool."].
43. Auto top-up when one trade moves consensus > 10% of range (215-218) |
    no such logic in `services/trading.ts` or `routes/predictions.ts` |
    DIVERGES [ambiguity: mark "NOT built; Season 1" or move to the deferred
    table].
44. `maxPositionCostPerMarket = 5000`, cumulative buys, sells never refund
    headroom, reservations count (219-223, 270-271, 370) |
    `services/trading.ts:182-200` | CONFORMS.
45. "Raising b marks up every open position ... +141 credits of marked profit
    over the full ramp" (182-198) | `services/marketLiquidity.ts:12-25`
    scales the book so consensus is unchanged; the resolve-now mark
    (`lib/leaderboard.ts:70-78`) moves nobody's score; the +141 was the
    liquidation-mark gain reversed at 256 | DIVERGES [doc bug, stale after
    the F1 reversal: "An injection preserves price, so under the resolve-now
    mark a ramp step changes no standing; it changes the desk's liquidation
    number and the spread a later buy pays."].
46. "The hero market resolves 2026-10-15, a day before the season ends"
    (189-194) vs 305-312 (end is 10-01) | DIVERGES [doc bug, internal: "The
    hero market resolves 2026-10-15, two weeks after the season ends, so at
    settlement it is marked, not paid; see F3."].
47. F4 "saved by its one resolution landing a day before the end" (325-329)
    | same | DIVERGES [doc bug: "Season 0 has no resolution inside its
    window; the ramp and the marks decide it."].
48. `liquidity` in `POST /api/predictions/markets` is pool credits (500) |
    `routes/predictions.ts:1008-1009` | CONFORMS.
49. Voided market no longer occupies its slot; test exists (495-499) |
    `routes/predictions.ts:932-951`; `recreate-voided-market-slot.test.ts` |
    CONFORMS.
50. Ramp funder `lookpilot-kpi-sync` (493-494) | script `FUNDER` default |
    CONFORMS.
51. "the floor" singular vs decision 1 (all public workspaces) (179, 206) |
    the script ramps one `SEASON_WORKSPACE` | DIVERGES [unspecified: "The
    ramp covers the hero workspace only."].

Published surfaces:
52. Rules and `/api/help` say how an open position is valued (487-489) |
    rules 62-74 conform; `help-catalog.ts:1111` conforms on valuation but
    says scoring is over the PINNED set (1111, 1160), that settlement reads
    past "the 30-second display cache" (1167; it is 5 s,
    `routes/leaderboard.ts:83-84`) and that "A prize needs a season score
    strictly above zero" | DIVERGES [code bug: three stale sentences in the
    served catalog].
53. Changes announced on the season page before taking effect (24-28) |
    `SeasonPage.tsx:148-157` | CONFORMS.
54. "that file is a promise and never changes while a season runs" (6-7) vs
    24-28 and rules 3-7 | DIVERGES [doc bug, internal: "For Season 0 the
    rules may change mid-season if announced first; from Season 1 they are
    frozen at the start instant."].
55. F7 void refund enters profit, ledger append-only, correction published
    (359-362) | `lib/leaderboard.ts:170-176`; rules 19-22, 112-116 |
    CONFORMS.

Unspecified:
56. Lifecycle draft/running/settled, claim window 30 days, claim needs
    `payoutMethod`, expired claims roll | `lib/seasons.ts:10-22, 224-230`;
    `routes/seasons.ts:343-395` | add a "Lifecycle" section or state that
    the rules doc and the catalog own it.
57. Pool ceiling `poolUsd < 5000`, ladder total <= pool, `endsAt >
    startsAt` | `routes/seasons.ts:413-424, 488-500` | the 5,000 ceiling is a
    legal constraint worth one sentence.
58. Baseline snapshot semantics and tiebreak | `services/seasons.ts:58-92`;
    `lib/seasons.ts:168-174` | owned by the rules doc 76-84; fine.
59. Board cache 5 s, cleared on trade and settle | `routes/leaderboard.ts:
    83-97` | internal freedom.

### `docs/vision.md`, three areas

Verified by a separate agent; claim numbers as in its report.

Workspace announcements (490-507):
- A1 who may publish: `manage`, path workspace re-checked |
  `routes/workspaces.ts:691-693, 619-628` | CONFORMS.
- A2 `publishedBy` null for owner and master key, nickname otherwise (494) |
  `workspaces.ts:662-673` | CONFORMS.
- A3 columns (496) | `db/schema.ts:931-953` | CONFORMS.
- A4 body markdown <= 5000 (496) | `workspaces.ts:614, 631-640` | CONFORMS.
- A5 `publishedAt` server-side only (497) | `workspaces.ts:713-719` |
  CONFORMS.
- A6 first edit copies body to `originalBody`, stamps `editedAt`, both public
  (498) | `workspaces.ts:775-785, 644-654` | CONFORMS (identical-body save is
  a no-op, internal).
- A7 public read, private 403 (499) | `routes/marketplace.ts:1030-1040` |
  CONFORMS.
- A8 "a workspace whose Public group lacks `read` keeps the counts-only
  boundary" (499) | 403 'Not public' and no `announcementCount` on the
  payload either (1042-1050, 517-538) | DIVERGES [ambiguity: "gets 403 from
  the announcements route and no announcement fields on the workspace
  payload"].
- A9 newest first (494, 499) | `marketplace.ts:1056, 522` | CONFORMS.
- A10 limit | `.limit(100)` (1057), catalog says max 100, vision silent |
  DIVERGES [unspecified: "at most the 100 newest"].
- A11 no delete route, no overwrite (501) | only POST 691 and PUT 737 |
  CONFORMS.
- A12 "Migration 0057 puts a database trigger ... changes publishedBy" (501)
  | 0057:50-107 does all but `publishedBy`, which 0078:30-33 adds | DIVERGES
  [doc bug, minor: "Migration 0057 (extended by 0078 for `publishedBy`)"].
- A13 `allowLedgerAdmin` escape on workspace delete (501) |
  `workspaces.ts:974-977` | CONFORMS.
- A14 floor row: newest headline, day, link; "All N" (503) |
  `src/components/FloorAnnouncements.tsx:49-71` | CONFORMS.
- A15 headline = first sentence of the first line, cut at 90 on a word
  boundary (505) | `src/lib/announcement-headline.ts:32-58` returns the whole
  first line when it fits, otherwise leading sentences | DIVERGES [ambiguity:
  "the first non-empty line when it fits in 90 characters, otherwise its
  leading sentences cut at 90 on a word boundary"].
- A16 routes (507) | `src/App.tsx:149, 172` | CONFORMS.
- A17 page states its guarantee (507) | `AnnouncementsPage.tsx:241, 258,
  85-91` | CONFORMS.
- A18 compose and edit moved to the page (507) | `AnnouncementsPage.tsx:
  95-117, 271-283` | CONFORMS.
- A19 `latestAnnouncement`, `announcementCount` inside the read gate (499) |
  `marketplace.ts:517-538, 963-964` | CONFORMS.
- A20 notification on publish: none sent, doc silent | internal freedom;
  one sentence would help.
- A21 `:workspaceId` accepts a slug | stated at 488 | no change needed.

Participant notifications (509-546, 610-618, 823-825):
- N1 three channels; email on booleans, web and mobile in
  `notification_channels` (515) | `lib/notification-prefs.ts:26-60`;
  `routes/userauth.ts:428-470` | CONFORMS.
- N2 per-kind defaults (517-524) | `notification-prefs.ts:41-48`;
  `schema.ts:255-275` | CONFORMS.
- N3 legacy column mapping (526) | `services/notifications.ts:68-85` |
  CONFORMS.
- N4 `comment` kind, conditional markets included (519) |
  `notifications.ts:217, 244-252` | CONFORMS.
- N5 `reply` only after you first spoke (520) | `notifications.ts:219-226,
  255-262, 660-671` | CONFORMS.
- N6 `settled` with value; voided sends nothing (521) | `notifications.ts:
  488-549` (502 returns on voided); only called from
  `services/predictions.ts:140` | CONFORMS.
- N7 `decision` widened; proposer switchless; deciding owner never told (522)
  | `notifications.ts:409-436, 84` | CONFORMS.
- N8 `contract` to workspace members minus poster (523) |
  `notifications.ts:325-335` | CONFORMS.
- N9 `anyComment` claimed last (524, 539) | `notifications.ts:267-278` |
  CONFORMS.
- N10 migration 0072 (530) | `drizzle/0072:11-17` | CONFORMS.
- N11 approve, decline, spam mail the proposer with verb, ask, reason (532) |
  `notifications.ts:383-473`; `routes/proposals.ts:335, 366, 389` | CONFORMS.
- N12 withdraw and remove produce no record and no mail (534) | no mail
  (CONFORMS); but the inbox derives a `decision` row for every own proposal
  with `resolvedAt` set and status not in {pending, withdrawn}
  (`notifications.ts:936-951`), and `removeProposal` sets `resolvedAt`
  (`services/proposals.ts:726-733`), so a removed contract shows in the
  poster's bell as "Declined." | DIVERGES [code bug: at
  `notifications.ts:937` also skip `status === 'removed'`].
- N13 recipients resolve participant -> account -> email; no account skipped
  (538) | `notifications.ts:138-160` | CONFORMS.
- N14 one email per comment (539) | `wanted` map keyed by participant |
  CONFORMS.
- N15 conditional-market comment counts as the contract's (540) |
  `notifications.ts:237-253` | CONFORMS.
- N16 fire-and-forget, errors swallowed (541) | `void` at every call site;
  `lib/notify.ts:33-56` | CONFORMS.
- N17 every email names its switch and links to settings (542); links point
  at `#account` (823-825) | mails link `#emails` (`notifications.ts:286, 343,
  442, 526`); `AccountMenu.tsx:74-79` handles both | DIVERGES [doc bug at
  824: "by the `#account` hash; `#emails` opens it on the notifications
  section and is what every notification email links to"
  (`ui-conventions.md:467` repeats the stale claim)].
- N18 Resend transport, nothing sent when unset (544) | `notify.ts:33-35` |
  CONFORMS.
- N19 `/me` carries `notifications` with four keys; profile accepts the same
  (546) | six keys plus `notificationChannels` matrix (`userauth.ts:177-195,
  401-408, 428-435`; `routes/agents.ts:104-111`) | DIVERGES [doc bug: see
  proposed edits].
- N20 push subscriptions upserted on endpoint, VAPID, 404/410 cleanup (515) |
  `routes/notifications.ts:164-169`; `lib/push.ts:23-25, 55, 65-70` |
  CONFORMS.
- N21 bell filtered by web cells only (614) | `notifications.ts:610, 1027` |
  CONFORMS.
- N22 bell derives from `proposal_messages`, `market_messages`, `proposals`
  (616) | also `trades` (655) and `markets` (745-761) | DIVERGES [doc bug,
  minor: append "and, for the settled and decision kinds, `trades` and
  `markets`"].
- N23 watermark, per-item reads, sweep deletion, idempotence, migration 0064
  (616) | `notifications.ts:1031-1060`; `drizzle/0064:11` | CONFORMS.
- N24 deep link format (618) | `NotificationsBell.tsx:53-54` | CONFORMS.
- N25 "the one thing only it carries: a decision on your own contract" (612)
  vs 532 (proposer always mailed) | DIVERGES [doc bug, internal: "including
  a decision on your own contract, which the mail also always carries"].
- N26 decided contract keeps its thread open (513) | `routes/proposals.ts:
  553-592`; `TradePage.tsx:423, 1350-1355` | CONFORMS.
- N27 defaults at signup, nothing asked (528) | schema defaults;
  `CHANNEL_DEFAULTS` | CONFORMS.
- N28 no digest, no per-recipient limiter | doc silent | internal freedom.
- N29 `OWNER_NOTIFY_EMAIL` receives a mail for every new contract and every
  waitlist entry (`routes/proposals.ts:217-220`; `routes/waitlist.ts:37`;
  `notify.ts:4-9`) | vision never mentions it | DIVERGES [unspecified: add
  "Separately, `OWNER_NOTIFY_EMAIL` (when set) receives a mail for every new
  contract and every waitlist entry; it has no switch."].
- N30 bots skipped for mail (538) | inbox still derives for API-key
  participants (`routes/notifications.ts:33-40`) | CONFORMS (sentence is
  about mail).

Proposal and contract approval (210-212, 222-224, 354-357, 429, 451-466,
532-534, 626):
- P1 `POST /api/proposals` with `trade` (456, 429) | `routes/proposals.ts:
  29-31` | CONFORMS. Unspecified: title <= 80, `askUsd` whole dollars
  0..1,000,000, paid job needs a payout handle, per-participant pending cap
  answering 429, subsidy minimum (42-147) | add one sentence.
- P2 "When any participant fetches markets with `?proposalId=`, the system
  auto-creates dual-branch markets" (457) | the pair is spawned at creation
  (`routes/proposals.ts:171-176`, strict); the GET only heals a pending
  proposal with zero live markets (`routes/predictions.ts:618-637`) |
  DIVERGES [doc bug: "The pair is spawned when the contract is posted; a
  fetch with `?proposalId=` re-spawns it only for a pending contract with no
  live markets."].
- P3 clones per active leaf market, `approved` and `declined` branches (457)
  | `services/proposals.ts:146-153, 186-241` | CONFORMS.
- P4 headline impact = approved minus declined consensus (458) |
  `services/proposals.ts:1009-1010` | CONFORMS.
- P5 approver is owner or `manage` (459) | `routes/proposals.ts:319, 342,
  374` | CONFORMS.
- P6 approve voids the declined branch and refunds; approved stays (460) |
  `services/proposals.ts:488`; `services/markets.ts:110-160` | CONFORMS.
- P7 approve also buys the proposer's LP stake out on the approved branch,
  owner-funded, skipped if the owner cannot cover (`services/proposals.ts:
  490-497, 1029-1086`) | never stated | DIVERGES [unspecified: see edits].
- P8 approve pays `proposalReward` owner -> proposer, 409 if uncovered,
  nothing when proposer is owner (`services/proposals.ts:499-569`) | only
  named inside the pitch at 224 | DIVERGES [unspecified].
- P9 "the proposer is paid ... only if the proposal moved the metric" (224) |
  reward paid unconditionally at approval (542-557) | DIVERGES [doc bug].
- P10 "Proposers earn LP returns proportional to actual metric movement"
  (222) | on approve their LP rows are re-attributed to the owner
  (1079-1084) | DIVERGES [doc bug].
- P11 good-faith decline voids the approved branch (461) |
  `services/proposals.ts:617-623` | CONFORMS. `refund: true` voids both
  (610-616) | DIVERGES [unspecified: one sentence].
- P12 `declineReason` required exactly when a charter is set, rendered
  permanently (626) | `services/proposals.ts:593-608, 630`;
  `routes/proposals.ts:274` | CONFORMS.
- P13 withdraw voids both, proposer only, pending only (462, 534) |
  `services/proposals.ts:889-907` | CONFORMS.
- P14 decline as spam voids both, "all stakes refunded" (462) | also charges
  `spamPenalty` to the proposer, paid to the owner (649-684,
  `proposal_penalty`) | DIVERGES [unspecified, money moves: one sentence].
- P15 remove "produces no record" (534) | `removeProposal` (713-734) keeps
  the row with status `removed` and `resolvedAt`; hidden unless
  `?status=removed`; route `DELETE /api/proposals/:id` with `manage` never
  named | DIVERGES [ambiguity: "no decision record: the row stays only so
  ledger entries keep resolving, hidden from every listing unless asked for
  by status, no mail"].
- P16 per-proposal thread, `trade` to post (464) | `routes/proposals.ts:
  527-592` | CONFORMS.
- P17 `manage` may refresh conditionals (466) | `routes/predictions.ts:
  1377-1379` | CONFORMS.
- P18 subsidy on post, per-market liquidity with `trade`, bulk with `manage`
  (212) | `routes/proposals.ts:34, 133-147`; `routes/predictions.ts:
  1210-1211, 1072-1073` | CONFORMS.
- P19 funding fallthrough down to one nanocredit (210) |
  `services/proposals.ts:268-347`; `lib/validation.ts:119` | CONFORMS.
- P20 debited from the owner like baseline markets (210) | same
  `applyCredits(... 'liquidity')` path (365-376) | CONFORMS.
- P21 "Approving a paid job on a workspace that settles payments IS the
  payment, because the system performs it" (354-357) | no code pays
  `askUsd`; `contract_payment` declared (`services/credits.ts:45`) and never
  applied; "Who to pay" (578-608) has the owner paying by hand from `GET
  /api/admin/participants` | DIVERGES [doc bug: see edits].
- P22 timing: approve, decline, spam, withdraw refuse anything but pending;
  remove works at any status (483, 587, 645, 895, 723) | unstated |
  unspecified, one sentence.
- P23 decision recorded before mail (459, 532) | `routes/proposals.ts:
  323-335` | CONFORMS.
- P24 void refund = net cash floored at zero, LP leftover (692-694) |
  `services/markets.ts:110-160` | CONFORMS.
- P25 pair anchoring: branches open at the baseline price, approved branch
  minus the ask on dollar metrics (`services/proposals.ts:155-184`;
  `help-catalog.ts:520`) | vision silent | DIVERGES [unspecified].
- P26 "a flat set of three capabilities `read`, `trade`, `manage`" (429, 470)
  | `help-catalog.ts:50` and `lib/scopes.ts:95` have four
  (`manage_workspace`); vision 622 itself uses it | DIVERGES [doc bug].
- P27 contract edits owned by `market-integrity.md` I1b | vision silent |
  not a divergence.

### `docs/agent-telemetry-protocol.md`

1. `POST /api/admin/agent-heartbeat`, upsert by agentId, 204 (53-84) |
   `routes/admin.ts:468-516` | CONFORMS.
2. Heartbeat field list (60-76) | `admin.ts:473-491`; `schema.ts:1148-1166` |
   CONFORMS.
3. `status` enum (63) | `admin.ts:475` defaults `'idle'`, any string accepted
   | DIVERGES [unspecified: say the server does not validate it, or validate].
4. `POST /api/admin/agent-traces`, 201 `{ id }` (86-140) | `admin.ts:366-406`
   | CONFORMS.
5. Required `startedAt` (97-100) | optional, defaults to now
   (`admin.ts:371-374`) | DIVERGES [ambiguity: "optional; defaults to the
   time of receipt"].
6. Trace field list (102-112) | `admin.ts:390-404`; `schema.ts:1066-1085` |
   CONFORMS.
7. Per-entry fields (114-129) | opaque jsonb, no server validation; matches
   telarchy-agents `SessionEntry` | CONFORMS (client contract).
8. "keep entries to ~25 ... 1000 entries per trace, the DB will hold them"
   (134-139) | `admin.ts:378-383` rejects more than 40 rows or 64 KB with
   400 | DIVERGES [doc bug: "at most 40 rows and 64 KB per trace, enforced
   with 400"; the guide's "<= 25" needs the same fix].
9. Auth: master key or `X-Agent-Key` with `manage`, `X-Workspace-Id` (28-47)
   | `admin.ts:368, 470`; `middleware/auth.ts:169, 213` | CONFORMS.
10. "appears in `/admin -> Bot agents`", display rules (3-11, 207-224) | no
    component under `src/` reads heartbeats or traces; the panel was deleted
    2026-08-19 | DIVERGES [doc bug: delete the display section].
11. Retention "TBD" (233-235) | `services/maintenance.ts:28` prunes traces
    after 90 days | DIVERGES [doc bug: "traces are kept 90 days"].
12. Read endpoints `GET /api/admin/agent-heartbeats`, `.../agent-traces`
    (`admin.ts:413-466, 520-545`) | not in this doc (the guide has them) |
    CONFORMS by the guide; omission here.

### `docs/infra/deploy.md`

| Claim (line) | Source | Verdict |
|---|---|---|
| Workflow mirrors `npm run deploy` one for one (5-8) | workflow passes `--min-instances 1`, `--update-env-vars`, `--update-secrets`; `scripts/deploy-managed.sh:13` has `--min-instances 0` and neither flag | DIVERGES, doc bug |
| Hand deploy: `cd metrics-tracker && npm run deploy` (14) | repo dir is `telarchy-app`; the script needs `GCP_PROJECT` and `CLOUDSQL_INSTANCE`, unstated | DIVERGES, doc bug |
| Every workflow runs on self-hosted runners (22) | every job is `runs-on: ubuntu-latest` (`deploy-cloudrun.yml:45, 69, 87`, `test.yml:33, 60, 80`, `docker-publish.yml:20`) | DIVERGES, doc bug (false) |
| ghcr image `reblexis/metrics-tracker-server` (45, 488) | `docker-publish.yml:36` and `docker-compose.yml:31` use `ghcr.io/reblexis/telarchy-app` | DIVERGES, doc bug |
| WIF pool `github-actions`, repo `Reblexis/metrics-tracker` (59-106) | contradicted at 513-520 (pool `github`, repo `Reblexis/telarchy-app`) | DIVERGES, doc bug (self-contradiction) |
| Runtime account `429618975282-compute@` (388, 418, 423) | 497-499 and 397 say `telarchy-api@` | DIVERGES, doc bug (self-contradiction) |
| `cancel-in-progress` (481-483) | workflow 32-34 `cancel-in-progress: false` | DIVERGES, doc bug |
| Workflow passes no env flags (585-586) | workflow 244-245 passes four | DIVERGES, doc bug |
| Cron hourly (552-553) vs `.env.example:126-129` daily | managed vs self-hosted never distinguished | DIVERGES, ambiguity |
| `AUTO_MIGRATE`, entrypoint, compose, port 8080, `BUILD_BETA` | `docker-entrypoint.sh:7-10`; Dockerfile 42 cites this doc for `/beta` | DIVERGES, unspecified |
| Migrations run in CI against prod and beta before deploy (157, 218-220) | workflow 146-195 | CONFORMS |
| `--no-traffic --tag candidate`, smoke on `/api/public-config` (159-163) | workflow 237, 261, 279 | CONFORMS |
| Memory 512Mi, cpu 1, max-instances 4 in two places (235, 643, 652-655) | workflow 239-242, `deploy-managed.sh:13` | CONFORMS |
| `DATABASE_BETA_URL`, `lib/request-env.ts`, `X-Telarchy-Store` (189-206) | present; `app.ts:135` | CONFORMS |
| `POST /api/admin/publish`, `GET /api/admin/release` (265, 329) | `routes/admin.ts:679, 661` | CONFORMS |
| Retention 30 d visits, 90 d traces, 40 rows / 64 KB (258-259) | `services/maintenance.ts:26, 28`; `routes/admin.ts:378-383` | CONFORMS |
| `ASK_MODEL` default, `ASK_LIMIT_MAX` 6 per 5 min (617-620) | `lib/ask.ts:25`; `app.ts:254` | CONFORMS |
| Env var names throughout | all present in `.env.example` | CONFORMS |

### `docs/about-page.md`

1. `/about` headline, pitch, steps, vision, why now, name, who builds it |
   `src/pages/AboutPage.tsx:30-79` identical | CONFORMS.
2. `/contact` rows (77-79) | `ContactPage.tsx:40, 47` paraphrase ("Join the
   owner waitlist"; "Every endpoint is documented, no account needed to
   read") | DIVERGES [doc bug: quote the rows as rendered, or say they are
   described].
3. Discord invite shared with market pages (75-76) | `ContactPage.tsx:5-8`
   hardcodes its own copy | CONFORMS (same value; duplication is internal).
4. Home page `.pubws-foot` footer list (83) | `FloorsPage.tsx:360` has it;
   `AboutPage.tsx:84` footer differs ("The live markets, Contact, Terms,
   Privacy") and the doc lists neither about nor contact footers | DIVERGES
   [doc bug, minor].
5. `AboutPage.tsx:9-13` repeats the doc's dated revision record | CONFORMS
   (a record in two places, see doc quality).

### Guides and legal derivation

1. `docs/guides/*.md` -> `functions/src/content/guides.ts` via
   `scripts/build-guides.mjs` (every file but README, sorted, front matter
   required, body stripped of one trailing newline) | regenerated into the
   scratchpad and diffed: identical, 16 sections; `guides-content.test.ts`
   pins it; both last touched by `b4a9ca5` | CONFORMS.
2. `docs/legal/privacy-policy.md:3` `2026-08-11 (version 1.2)` |
   `routes/legal.ts:75` serves `2026-08-17 (version 1.5)`; body otherwise
   identical; no script and no test compare them (legal.ts:6-8 "update
   both") | DIVERGES [doc bug: update the stamp; structurally, generate
   `legal.ts` from `docs/legal` the way guides are].
3. `docs/legal/terms-of-service.md` and `season-0-rules.md` | identical to
   `routes/legal.ts:12-71, 130-246` (the doc hardcodes the contact email the
   code substitutes) | CONFORMS.
4. `docs/guides/api-reference.md` vs `help-catalog.ts` | 78 of ~160 paths,
   nine verified omissions, and `deposit`/`withdraw` contradicting the terms
   | DIVERGES [doc bug: generate from the catalog or delete].
5. `docs/guides/onboarding.md:9` vs Step 3 (90-107) | paused vs default path
   | DIVERGES [doc bug: internal contradiction].

## Meta rule

Nothing in the codebase consumes `./docs` at run time.

- `grep -rn "readFileSync|readdirSync|readFile(" functions/src` outside
  tests: one hit, `server.ts:330`, reading the built `index.html`.
- `grep -rn "docs/" functions/src` outside tests: 40 hits, all inside
  comments naming the governing doc as provenance (`routes/workspaces.ts:92,
  213, 661, 683`; `routes/predictions.ts:324`; `routes/system.ts:128`;
  `lib/formula/*.ts`; `services/credits.ts:22`; `middleware/route-policy.ts:
  40` in a string reason; and so on). Allowed by the practice.
- `Dockerfile`: `COPY docs/guides ./docs/guides` and
  `COPY scripts/build-guides.mjs` happen in the `frontend-builder` stage
  only, so `npm run build` can regenerate `guides.ts`; the runtime stage
  copies `lib/` from `backend-builder`, `drizzle/`, `assets/`, the entrypoint
  and the two bundles. No `docs/` reaches the image. Note: the
  `backend-builder` stage copies `functions/src` as committed, so the API
  serves the COMMITTED `content/guides.ts`, not the copy regenerated in the
  frontend stage; the commit-time sync test is what keeps them equal.
- Otto's prompts are hand-maintained string constants (`lib/ask.ts:37-56`,
  `lib/setup-brief.ts:24+`), not derived from a doc and not read from one.
  The practice would have them be a derived document generated from the
  spec; today the spec that would generate them does not exist (see
  `otto.md`).
- The data room's prose is a TypeScript module (`content/data-room.ts`) by
  design (`data-room.md:38-40`), not a doc; fine.

## Derived artifacts

Observed at the start of the audit (tree at `055e4b1`):

- HTML mirror of `./docs`: MISSING (no `browse/`, no docs `index.html`; the
  only `index.html` files were the Vite app's).
- README practice footer: MISSING. The README ended with "## Docs govern"
  and "## License"; the practice was not linked.
- `./docs` statement that contributors follow the practice: MISSING.
  `CONTRIBUTING.md:10` linked ddd-practice, but that file is outside
  `./docs`.

Observed after `4bf63b9` (21:42:30) and `6a703e3` (21:50:09):

- Mirror: PRESENT at `browse/index.html` (620 KB, one page, every markdown
  file under `docs/` sorted and recursive), built by
  `scripts/build-docs-mirror.py` (markdown-it, no model, no network).
  Exactness check: the script was copied to the scratchpad with `OUT`
  repointed and run at 21:48 against the working tree; the output differed
  from the committed mirror by exactly the nine lines `e7d6845` (21:43:40)
  added to `docs/infra/deploy.md`. So the first doc commit after adoption
  landed without regenerating the mirror, and `6a703e3` repaired it seven
  minutes later. The practice rule ("same commit") needs a guard: a test or
  a pre-commit hook that rebuilds and diffs. The script also crashes at its
  final `print` when `OUT` is outside `ROOT` (`OUT.relative_to(ROOT)`),
  harmless for the real path. The mirror carries the 59 em dashes the docs
  carry (practice: "does not use em dashes unless necessary"); the count per
  file is in the doc-quality section.
- README footer: PRESENT (`README.md:124-133`): links ddd-practice, describes
  the `docs/` hierarchy, names the mirror and the script. Beyond the footer
  the README still has a "## Docs govern" section (`README.md:113-115`)
  stating the docs-win rule; the practice says the README does not mention
  the practice elsewhere. Borderline: it does not name the practice, it
  states the rule. Recommend folding those two sentences into the footer.
- Contributor statement in `./docs`: PRESENT (`docs/README.md:4-9`).
- Guides: exact (see derivation above). Legal: hand-copied, one stale stamp,
  no generator, no test.
- Changelog (`content/changelog.ts`): generated by `predeploy`, committed;
  not re-verified against `git log` (would require running the script).

## Verified conforming

Areas where every checked claim held, so they can be trusted as written:

- Formula grammar, precedence, arity, rejection messages with column, leaf
  detection, NaN and parse-failure handling, the parser as the only
  interpreter.
- Attribution end to end (`source` slug, `ta_ref` 30-day cookie, register
  and create inheritance, activated-participants script).
- Auth resolution order; nanocredit unit; signup grant and unclaimed grant
  defaults; register requiring a workspace and auto-joining the Public
  group; private self-join hidden as 404; going private dropping `trade`;
  transfer and transfers endpoints; market history cap and gating.
- Data room: content module, known blocks, public route, 60 s cache,
  `removed` exclusion, `null` rendering, shared human filter, 30-day purge,
  never-purged daily rollup, Otto's tool and tool-less last round, changelog
  generation and `[private]`.
- Limit orders: reservation at placement, refunds on cancel/expiry/resolve/
  void, direction semantics, deepest-first fills, buy-to-limit, per-fill
  savepoints, release-then-re-reserve, cap counting reservations, one
  `executeTradeInTx`, all three routes in the catalog and the skill, ticket
  toggle and resting-order list.
- Market integrity: words edit in place with revisions and no-op on
  unchanged text; rename syncs `markets.metricName`; machinery 409 naming
  field and market; contract edits (who, when, re-anchor rule, title/ask
  agreement, payout handle untouched); all three I2 refusals with named
  reasons; the loud escape with a published reason; reset-economy gone; the
  single credits door, closed reason set, `balance_after`, `'platform'`
  scope, migration 0060 backfill, triggers on four ledgers, SQL-side
  reconciliation, the five named tests, the documented open gap.
- Seasons: score formula and grant-blind profit; settled/open split on board
  and profile; resolve-now valuation; house-account flag, migrations 0069
  and 0070, non-hidden ineligibility; owner eligibility; standings and
  settle on all public workspaces; pinned set kept with `workspacesDropped`;
  draft standings; no endsAt or duplicate-email guard; draft-only date
  edits; cron auto-start; ToS 1.5 clause; every number in the three LMSR
  tables; ramp schedule, linearity, idempotence, scope, unscheduled status,
  funder; pool-credits unit; voided-slot fix; position cap semantics;
  deferred decisions absent from code.
- Vision, announcements: capability, attribution, body cap, server
  timestamp, edit semantics, no delete, trigger rules, workspace-delete
  escape, ordering, floor row, page routes and copy.
- Vision, notifications: matrix storage and defaults, all six kinds'
  recipient rules, one mail per event, conditional-market attribution,
  fire-and-forget, Resend gating, push upsert and cleanup, bell filtering by
  web cells, watermark and per-item reads, deep links, decided-contract
  threads.
- Vision, proposals: capability gates, pair creation shape, delta,
  approve/decline/withdraw branch voiding, charter-gated decline reason,
  liquidity fallthrough to a nanocredit, per-market vs bulk liquidity
  capabilities, refresh, void refund math, decision-before-mail ordering.
- Telemetry: both write endpoints, their field lists, auth, agreement with
  the telarchy-agents consumer.
- Deploy: CI migrations before deploy, zero-traffic candidate and smoke,
  resource limits, beta store plumbing, publish and release endpoints,
  retention numbers, Otto model and rate limit, env var names.
- Guides: exact derivation; `guides/README.md` mechanism claims.
- Legal: terms and season rules exact.

## Proposed doc edits

Each: file; current sentence; proposed sentence; why. Intent-changing ones
are marked (owner) and are decisions, not corrections.

1. `docs/vision.md:354-357`. Current: "Approval executes only when ... 1.
   The platform moves the money. Approving a paid job on a workspace that
   settles payments *is* the payment, because the system performs it."
   Proposed: "Today no workspace settles contract payments: approving
   records the contract as owed (`approvedUsd` on `GET
   /api/admin/participants`) and the owner pays by hand; the
   system-performed payment is the end state, not the current one." Why: no
   code pays `askUsd`; `contract_payment` is declared and never applied.
2. `docs/vision.md:224`. Current: "the proposer is paid (via LP returns or
   via the optional `proposalReward`) only if the proposal moved the
   metric". Proposed: "the proposer is paid the optional `proposalReward` on
   approval; only a position they take on the approved branch pays in
   proportion to how the metric actually moves." Why: reward is paid at
   approval (`services/proposals.ts:542-557`).
3. `docs/vision.md:222`. Current: "Proposers earn LP returns proportional to
   actual metric movement vs the conditional consensus they helped fund".
   Proposed: "A proposer's subsidy is a refundable LP position; on approve
   the owner takes it over at cost, on decline it rides the declined branch
   to resolution." Why: `services/proposals.ts:1079-1084`.
4. `docs/vision.md:460`, append: "On approve the owner buys out the
   proposer's liquidity stake on the approved branch (skipped if the owner
   cannot cover it), and, if the workspace sets `proposalReward`, pays it
   to the proposer (409 when the owner cannot cover it). Decline as spam
   additionally charges the proposer the workspace's `spamPenalty`, capped at
   their balance, paid to the owner. `refund: true` on decline voids both
   branches. Approve, decline and withdraw act only on a pending contract;
   `DELETE /api/proposals/:id` (remove, `manage`) acts on any." Why: three
   money movements and two rules at decision time the vision never states.
5. `docs/vision.md:457`. Current: "When any participant fetches markets with
   `?proposalId=<id>`, the system auto-creates dual-branch conditional
   markets". Proposed: "The pair is spawned when the contract is posted (a
   subsidy that cannot be covered fails the post with 400); a fetch with
   `?proposalId=` re-spawns it only for a pending contract that has no live
   markets. Each branch opens at the baseline market's current price; the
   approved branch of a paid job opens lower by its ask on metrics that burn
   dollars." Why: `routes/proposals.ts:171-176`; `services/proposals.ts:
   155-184`.
6. `docs/vision.md:429` and `470`. Current: "a flat set of three
   capabilities, `read`, `trade`, `manage`". Proposed: "a flat set of four
   capabilities: `read`, `trade`, `manage`, and `manage_workspace`
   (lifecycle: delete the workspace, change visibility, configure auto-fund
   and default liquidity; not implied by `manage`)." Why: `help-catalog.ts:
   50`, `lib/scopes.ts:95`, vision 622.
7. `docs/vision.md:546`. Current: "`GET /api/auth/me` and `GET /api/agents/me`
   carry `notifications: { commentOnMyProposal, replyToMyComment,
   newProposal, anyComment }`, and `POST /api/auth/profile` accepts the same
   object with any subset of the four keys". Proposed: "`GET /api/auth/me`
   carries `notificationChannels`, the resolved matrix (`{ kind: { web,
   email, mobile } }` for the six kinds), and, for older clients,
   `notifications` with the six email switches (`commentOnMyProposal,
   replyToMyComment, newProposal, anyComment, marketResolved,
   contractDecided`); `GET /api/agents/me` carries the same `notifications`
   object. `POST /api/auth/profile` accepts either object with any subset of
   cells." Why: `routes/userauth.ts:177-195, 401-435`.
8. `docs/vision.md:824`. Current: "by the `#account` hash (which is what
   unsubscribe links point at)". Proposed: "by the `#account` hash;
   `#emails` opens it on the notifications section and is what every
   notification email links to." Why: `notifications.ts:286, 343, 442, 526`.
   Same fix at `docs/ui-conventions.md:467`.
9. `docs/vision.md:612`. Current: "plus the one thing only it carries: a
   decision on your own contract". Proposed: "including a decision on your
   own contract, which the mail also always carries". Why: contradicts 532.
10. `docs/vision.md:616`, append to the table list: "and, for the settled
    and decision kinds, `trades` and `markets`". Why: `notifications.ts:655,
    745-761`.
11. `docs/vision.md:501`. Current: "Migration 0057 puts a database trigger
    ...". Proposed: "Migration 0057 (extended by 0078 for `publishedBy`) puts
    a database trigger ...". Why: the `publishedBy` rule lives in 0078.
12. `docs/vision.md:499`. Current: "a workspace whose Public group lacks
    `read` keeps the counts-only boundary". Proposed: "a workspace whose
    Public group lacks `read` gets 403 from the announcements route and no
    announcement fields at all on the workspace payload; the route returns at
    most the 100 newest." Why: `marketplace.ts:517-538, 1042-1057`.
13. `docs/vision.md:505`. Current: "the first sentence of the first line,
    markdown furniture stripped, cut at 90 characters on a word boundary".
    Proposed: "the first non-empty line when it fits in 90 characters,
    otherwise its leading sentences cut at 90 on a word boundary, markdown
    furniture stripped". Why: `src/lib/announcement-headline.ts:32-58`.
14. `docs/vision.md:534`. Current: "it is not a decision, so it produces no
    record". Proposed: "it is not a decision, so it produces no decision
    record: the row stays with status `removed` only so ledger entries keep
    resolving, is hidden from every listing unless asked for by status, and
    sends no mail." Why: `services/proposals.ts:713-734`.
15. `docs/vision.md`, email section, add: "Separately from participant
    notifications, `OWNER_NOTIFY_EMAIL` (when set) receives a mail for every
    new contract and every waitlist entry; it has no switch." Why:
    `routes/proposals.ts:217-220`, `routes/waitlist.ts:37`.
16. `docs/vision.md:202, 220`: remove the references to `go-to-market.md`
    and `docs/canvas/value-prop-canvas.html` or point them at the umbrella
    notes where they live. Why: neither exists under `docs/`.
17. `docs/seasons.md`, Status block, add: "Amended 2026-08-22 (owner): the
    score-above-zero bar is gone; place alone decides the prize, negative
    scores included. Only `agents.platform_operated` disqualifies." and
    rewrite 385, 404, 413-417 (with two entrants rungs 1 and 2 are both
    live, $750 of claim). Why: `lib/seasons.ts:142-144`; rules 9-12, 51-54.
18. `docs/seasons.md:6-7`. Current: "that file is a promise and never changes
    while a season runs". Proposed: "For Season 0 that file may change
    mid-season if announced first (see the 2026-08-21 revision); from Season
    1 it is frozen at the start instant." Why: contradicts 24-28 and the
    rules doc.
19. `docs/seasons.md:189-194`. Proposed: "The hero market resolves
    2026-10-15, two weeks after the season ends, so at settlement it is
    marked, not paid; see F3." And 325-329: "Season 0 has no resolution
    inside its window; the ramp and the marks decide it." Why: the end moved
    to 10-01 (305-312) and these two paragraphs were not updated.
20. `docs/seasons.md:182-198`. Proposed replacement: "An injection preserves
    price (`liquidityStateAfterPoolContribution` scales the book), so under
    the resolve-now mark a ramp step changes no standing. What it changes is
    the desk's liquidation number and the spread a later buy pays. The 48h
    mark and washing-out arguments applied to the liquidation mark, which was
    reversed." Why: stale after the F1 reversal at 256.
21. `docs/seasons.md:291-292`. Current: "Entry already requires payment
    details on the account plus explicit rules acceptance (2026-08-19)".
    Proposed: "Entry requires rules acceptance, an 18+ confirmation and a
    contact email; payment details are asked only at claim time, so a
    sybil's cost is one more email address, not one more payout identity."
    Why: `routes/seasons.ts:289-294`.
22. `docs/seasons.md:301-302`. Current: "Final standings are read at one
    fixed timestamp inside a transaction." Proposed: "Settlement reads the
    board once, uncached, then writes every final in one transaction; the
    read itself is not snapshot-isolated." Why: `routes/seasons.ts:570-606`.
23. `docs/seasons.md:215-218`. Mark item 3 "NOT built; Season 1" or move it
    to the deferred table. Why: no auto top-up logic exists.
24. `docs/seasons.md:431-434`. Current: "`platformOperatedIds` is the only
    reader". Proposed: "`platformOperatedIds` is the only reader on the money
    path (standings, prize column, settlement); admin listing and attribution
    read the column for display and filtering only." Why: `routes/admin.ts:
    742`, `lib/attribution.ts:84-101`.
25. `docs/seasons.md:210-214`. Proposed: "Branches take
    `newMarketLiquidityCredits` at spawn, which is set to the season's
    opening pool." Why: stale complaint.
26. `docs/seasons.md:245`. Drop the line number (`TradeTicket.tsx:287` is now
    348). Why: line numbers in docs rot.
27. `docs/seasons.md`, add one sentence each: "The ramp covers the hero
    workspace only; other public floors keep their own
    `newMarketLiquidityCredits`." and "Deletion freeze
    (`market-integrity.md`) still reads the pinned set, so a floor that goes
    public mid-season is scored but not protected from deletion until Season
    1." and "The lifecycle (draft, running, settled; 30-day claim window;
    claim requires payout details; pool below 5,000 USD; ladder within pool)
    is owned by `legal/season-0-rules.md` and the `/api/help` catalog." Why:
    unspecified behavior others depend on.
28. `docs/limit-orders.md:61`. Current: "No matching engine and no cron
    loop." Proposed: "No matching engine. Every trade triggers a fill pass
    in its own transaction, and an in-process sweep runs the same pass on
    every open market every 12 seconds, so an order crossed by a resolution,
    a liquidity change or a fill elsewhere does not wait for the next trade."
    Why: `server.ts:161-170`.
29. `docs/limit-orders.md:66-68`. Current: "Load open orders on that market
    whose `limitValue` lies in `[c0, c1]` (the range the price just
    crossed)". Proposed: "Load every open order on that market whose limit
    the current price has reached or passed". Why: `trading.ts:425-437`.
30. `docs/limit-orders.md:38`. Current: "`open` | `filled` | `cancelled` |
    `expired`". Proposed: "`open` | `filled` | `cancelled` | `expired` |
    `voided` (the market was voided; remainder refunded)". Why:
    `trading.ts:541-583`.
31. `docs/limit-orders.md:121-125`. Replace "Choosing `at my price`" with
    "Choosing `Limit`" and quote the confirm as rendered: "Buy Higher with 25
    cr under $65,000". Why: one control, two names.
32. `docs/limit-orders.md:136-140`. Current: "The chart draws each resting
    order ... Above a handful of orders, draw the trader's own only."
    Proposed: "The chart draws the viewer's own resting orders as faint
    horizontal rules at their limits, in the direction's colour." Why:
    `MarketChart.tsx:30-33`.
33. `docs/limit-orders.md:106`, append: "`status` defaults to `open`;
    `status=all` returns every state." Why: `predictions.ts:523-524`.
34. `docs/market-integrity.md:70-72`. Current: "On a computed metric, setting
    `value` by hand overrides the formula and counts as machinery." Proposed:
    "On a computed metric `value` is not settable: a value in the request is
    ignored and the stored value is the formula's result." Why:
    `routes/metrics.ts:258, 128`.
35. `docs/market-integrity.md:144`. Current: "Holders are still refunded in
    full". Proposed: "Holders are refunded their net cash at stake, as any
    void does (`vision.md`, void refund rule)". Why: `services/markets.ts:
    110-160`.
36. `docs/market-integrity.md:219-225`, Reconstruction: add
    `proposal_revisions` to the list of append-only tables once the trigger
    exists (code fix 1). Why: I1b promises append-only.
37. `docs/agent-economy.md:13`, append: "Paused: `POST /api/onboard` answers
    403 unless the instance sets `OWNER_ONBOARDING_OPEN=1`; owners create a
    workspace with `POST /api/workspaces` after signing up." Why:
    `routes/onboard.ts:50-58`.
38. `docs/agent-economy.md:15`. Current: "3-30 chars, `[A-Za-z0-9_-]`".
    Proposed: "3-30 chars, `[A-Za-z0-9_-]`, starting with a letter or
    digit". Why: `lib/validation.ts:21`.
39. `docs/agent-economy.md:62`, append: "Every other marketplace read
    answers 403 on a private workspace; only the join hides the id." (owner:
    or make them all 404, code fix 5). Why: `marketplace.ts:359, 1037, 1095`.
40. `docs/agent-economy.md:72`. Shape becomes `{ id, body, publishedAt,
    editedAt, originalBody, publishedBy }`, "newest first, at most 100". Why:
    `marketplace.ts:1056-1069`.
41. `docs/data-room.md:110`. Current: "He gets at most three tool rounds".
    Proposed: "He gets at most six tool rounds". Why: `lib/ask.ts:90`.
42. `docs/data-room.md:134`. Current: "computed in
    `functions/src/routes/data-room.ts`". Proposed: "computed in
    `functions/src/services/data-room.ts`". Why: the route is a 22-line
    shell.
43. `docs/formulas.md:45`. Current: "The formula editor shows the error; a
    stored formula that fails to parse evaluates to 0 and logs an error
    server-side". Proposed (owner): "A formula that does not parse is
    refused by `POST` and `PUT /api/metrics` with 400 carrying the message
    and column; a stored formula that fails to parse (possible only for rows
    that predate the check) evaluates to 0 and logs an error." Why: no
    editor exists and the API stores anything; this is code fix 6 if
    accepted. Alternative without a code change: "There is no formula
    editor; the API stores the string as given and ...".
44. `docs/formulas.md:24-25`, append: "In a time-preference projection, a
    leaf with no market on the sampled date contributes 0." Why:
    `metrics-engine.ts:51`.
45. `docs/metrics.md:3`. Current: "this doc is the canonical definition and
    computation". Proposed: "this doc is the canonical definition; none of
    the engagement or network-quality metrics is computed by the platform
    today". And add the definition of `weeklyActiveVerifiedTraders` (the
    metric the self-sync actually pushes). Why: no code computes the five;
    the synced one is undocumented.
46. `docs/agent-telemetry-protocol.md:134-139`. Proposed: "A trace carries at
    most 40 entries and 64 KB; more is refused with 400." Same number in
    `docs/guides/agent-telemetry.md`. And 233-235: "Traces are kept 90 days
    (`services/maintenance.ts`)." And delete 3-11 and 207-224 (the panel is
    gone) or reword as "stored for the admin read endpoints". And 97-100:
    `startedAt` optional, defaults to receipt time. Why: `routes/admin.ts:
    371-383`; `services/maintenance.ts:28`.
47. `docs/infra/deploy.md`: fix the eight wrong or self-contradictory facts
    (mirror claim 5-8; hand-deploy path and required env 14; runners 22;
    image name 45, 488; WIF pool and repo 59-106 vs 513-520; runtime account
    388-423 vs 497-499; concurrency 481-483; env flags 585-586); state which
    cron cadence is managed and which is self-hosted (552-553 vs
    `.env.example`); add `AUTO_MIGRATE`, the entrypoint and `BUILD_BETA`
    since the Dockerfile cites this doc.
48. `docs/legal/privacy-policy.md:3`. Current: "_Last updated: 2026-08-11
    (version 1.2)_". Proposed: "_Last updated: 2026-08-17 (version 1.5)_".
    Why: the served text (`routes/legal.ts:75`) moved on.
49. `docs/guides/api-reference.md`: generate from `help-catalog.ts` or delete;
    at minimum remove `deposit`/`withdraw` (42-44) which the terms deny.
50. `docs/guides/onboarding.md:90-107`: state that Step 3 is the paused path
    and lead with `POST /api/workspaces`. Why: contradicts line 9.
51. `docs/about-page.md:77-79`: quote the `/contact` rows as
    `ContactPage.tsx:40, 47` renders them, or say the rows are described.
52. `docs/README.md:22`: `otto.md` does not own Otto; either replace the file
    with a spec (doc-quality section) or point the row at `vision.md`.
53. `README.md:113-115` "## Docs govern": fold into the footer. Why: the
    practice keeps README mentions to the footer.

Doc-quality dispositions (records out of `./docs`) are listed per file in
the doc-quality section and are not repeated here; they are the larger job.

## Proposed code fixes

1. `proposal_revisions` append-only: new migration attaching
   `telarchy_ledger_append_only` (as 0055/0060 do) to `proposal_revisions`;
   extend `ledger-append-only.test.ts` to the third table. Governing
   sentence: `market-integrity.md:90-92`.
2. `routes/leaderboard.ts:277-280` `currentSeasonPrizes`: score over
   `publicNow` (as `seasonStandings` at 404-409) instead of the pinned set;
   add a test that a workspace made public mid-season moves the
   `seasonPrizeUsd` column. Governing sentence: `seasons.md:19-23`.
3. `lib/help-catalog.ts:1111, 1160, 1167`: replace "over the season's PINNED
   workspace set" with "over every public workspace at read time", "the
   30-second display cache" with "the 5-second display cache", and delete "A
   prize needs a season score strictly above zero". Governing sentences:
   `seasons.md:19-23`; `legal/season-0-rules.md:9-12, 51-54`.
4. `services/notifications.ts:937`: also skip `status === 'removed'` when
   deriving `decision` inbox rows. Governing sentence: `vision.md:534`.
5. (owner) `routes/marketplace.ts:359, 1037, 1095` and the other private
   branches: answer 404 instead of 403 if the doc's "a UUID is not a secret"
   rationale is meant to cover every read. Otherwise doc edit 39.
6. (owner) `routes/metrics.ts` create and update: call `validateFormula`
   and answer 400 with the message and column for a formula that does not
   parse. Otherwise doc edit 43's alternative.
7. `scripts/build-docs-mirror.py:186`: print `OUT` without `relative_to` so
   the script can be run against another output path; add a test (or
   pre-commit hook) that rebuilds the mirror and fails on a diff, so the
   "same commit" rule is mechanical.
8. `lib/validation.ts:26`: replace the en dash between 3 and 30 with a hyphen (a dash in a served
   error string; repo style rule).
9. `scripts/season-liquidity-ramp.mjs:41`: comment says $2,588 and $1,330
   for b = 4,000 and 8,000; the correct values are $2,766 and $1,469
   (`seasons.md:168-174`).
10. Legal derivation: generate `routes/legal.ts` constants from
    `docs/legal/*.md` the way `build-guides.mjs` does, with a sync test, so
    edit 48 cannot recur.
