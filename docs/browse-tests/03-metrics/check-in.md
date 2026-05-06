---
id: 03-metrics-check-in
tags: [browse, fast]
isolation: workspace
parallel-safe: true
needs: [auth, master-key, browse]
timeout: 120s
goal-horizon: short
goal-statement: |
  As a returning participant, I can update a metric value on the check-in
  page, see the change persist across reload, and see the related forecast
  react.
---

# Browse test: Metrics dashboard and Check-in flow

## What this tests

The two surfaces a returning user uses most: `/metrics` (review and edit
metric definitions, formulas, history) and `/check-in` (auto-save value
updates against leaf metrics). Covers the happy path plus the formula and
clamping edge cases.

Maps to `mvp-evaluation/plan.md` Section 3 and supersedes the one-off
`.gstack/qa-reports/qa-report-check-in-2026-04-23.md` for repeatable runs.

## Preconditions

- An authenticated user with at least one workspace populated by the `personal`
  or `startup` template (so leaf metrics exist).
- `npm run dev` running locally, OR prod with the `viktor.cihal@gmail.com`
  account from `AGENTS.md`. Both work; pick the one matching what you're
  testing.

## Setup

```bash
source "$ROOT/docs/browse-tests/_runner/lib.sh"
tt_browse_init
$B viewport 1440x900
$B goto "$TT_FRONTEND_URL/metrics"
$B wait --networkidle
$B screenshot "/tmp/$TT_NS-metrics-baseline.png"
```

The baseline should show "Metrics Dashboard" plus at least one card with
"Now: <value>" and "Outlook: <value>".

## Tests

### T1. Metrics dashboard lists every metric in the workspace

**Steps:**
1. Pull ground truth: `curl -s -b <cookie> https://telarchy.com/api/metrics | jq -r '.[].name'`.
2. `$B text` and grep for each name.

**Expected:** Every metric name from the API appears in the page text.

### T2. Card expand → graph modal opens

**Steps:**
1. `$B snapshot -i` and find the "Graph" button on a leaf metric.
2. `$B click <graph-ref>`
3. `$B is visible ".graph-modal, [data-testid='graph-modal']"`.
4. `$B screenshot /tmp/metrics-graph.png`.

**Expected:**
- A modal opens with a Chart.js canvas and at least one history point.
- No console errors (`$B console --errors`).
- Closing the modal restores the dashboard.

### T3. Edit modal updates name + formula

**Steps:**
1. Pick a leaf metric, click its "Edit" button.
2. Change name to a unique suffix, e.g. append "-edited".
3. Click Save.
4. `$B wait --networkidle`
5. `$B reload && $B text` and grep for the new name.

**Expected:**
- New name persists across reload.
- Network log shows `PUT /api/metrics/<id>` returning 200.
- Restore the original name before moving on.

### T4. Formula referencing other metrics evaluates correctly

**Steps:**
1. Open Edit on a metric named e.g. "TestComposite".
2. Set formula `{Metric A} + {Metric B}` (substitute real names).
3. Save.
4. Inspect the card's "Now" value.
5. Edit each leaf to known values, observe composite recompute.

**Expected:**
- Composite "Now" equals the arithmetic of the leaves within rounding.
- Bad formula (`foo(`) surfaces a warning, doesn't crash the dashboard.
- After test: restore previous formula.

### T5. Check-in auto-save round-trip

**Steps:**
1. `$B goto <url>/check-in && $B wait --networkidle`
2. `$B snapshot -i` to find a leaf-value input.
3. `$B fill <ref> "999"`
4. `$B press Tab` (commit the edit).
5. `$B wait --networkidle`
6. `$B network` and grep for `PUT /api/metrics/`.
7. `$B reload && $B text` and confirm the value is now 999.

**Expected:**
- One PUT, 200 within 200 ms.
- Card re-renders with "Updated just now".
- Restore the original value.

### T6. Over-max input clamped at the input layer

**Steps:**
1. From `/check-in`, find an input with `max=1000`.
2. `$B fill <ref> "9999"`
3. `$B css <ref> "value"` (current input value).
4. `$B network` and confirm no PUT was made.

**Expected:** The browser-level `max` rejects or clamps; no network write.

### T7. Theme toggle cycles without flicker or console errors

**Steps:**
1. `$B snapshot -i` and find ".theme-toggle".
2. `$B click <ref>` three times (system → light → dark → system).
3. `$B console --errors`
4. `$B screenshot /tmp/check-in-theme-{1,2,3}.png` between clicks.

**Expected:** Three transitions, no errors, screenshots show three distinct
backgrounds.

### T8. "Markets →" link drills into the right market list

**Steps:**
1. From `/metrics`, click "Markets →" on a leaf with at least one open market.
2. `$B url`
3. `$B text` and check the filter input value.

**Expected:**
- URL is `/markets?q=<metric-name>` (or the equivalent current shape).
- The markets list is filtered to that metric's markets.

## Cleanup

The auto-save tests modify real metric values. Always restore originals at
the end of T3, T4, T5. If you forget, `git diff` the metric_logs table to find
your edits and reverse them.

## Known gaps

- T4 leaks: a formula edit creates an `update` row even on revert. Fine for
  manual runs; if you automate, drop the test rows in cleanup.
- No coverage of the "Update values" multi-row modal (`UpdateValuesModal.tsx`).
  Add a test once the entry-point is stable.
- No mobile viewport assertion. The Check-in page is the most-used mobile
  surface; add a 390x844 spec when mobile-check-in becomes a focus.
