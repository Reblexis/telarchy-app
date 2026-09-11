# Agents page design review, 2026-09-09

Viktor requested a clearer, more enjoyable agents page and an independent critic scoring it from 1 to 10, with iteration until at least 8.

The critic used ease (40%), frictionlessness (40%) and enjoyment (20%). These are heuristic assessments of the rendered desktop/mobile states and implementation, not measured user-testing results.

- Baseline: 4.8/10. Setup was hidden from newcomers, management actions had equal visual weight, and account keys competed with owned bots.
- First revision: 7.4/10. Separate task views, bot-first management, selected-access summary and copy feedback improved purpose. Remaining issues were mobile height, hover contrast and transfer instructions shown outside a transfer.
- Final revision: 8.2/10. Ease 8.4, frictionlessness 8.1, enjoyment 8.0. Compact mobile setup, readable button states, contextual funding instructions and clear separation of personal keys addressed the blockers.

The final assessment covered desktop/mobile setup, populated connections and expanded keys, with copy-feedback behavior inspected in source. The beta administration banner was excluded from the agent-page rating. The critic reported no remaining design blockers. Possible future refinements were a more compact setup introduction on very short phones and disclosure of technical key metadata; richer activity must depend on actual telemetry.

The governing behavior is in `docs/audience-pages.md` and `docs/ui-conventions.md`.

## Manual setup and key summaries

Viktor requested a manual path beside Copy setup prompt, simpler key summaries and less transfer prose. The manual path adds preview commands for macOS/Linux and Windows, reuses the connection form, and provides a keyed preview with live commands only for trading access. Key summaries show names, plain-language permissions and workspace names, with technical metadata disclosed on request. The routine refresh button is removed; recovery actions appear only when needed. Funding shows the source balance, with return mechanics in details.

The independent critic reviewed the new desktop/mobile renders and scored 8.4/10: ease 8.6, frictionlessness 8.3, enjoyment 8.2. They reported no remaining design blockers.

## Floor style alignment

The independent critic reviewed desktop and mobile setup and management screenshots against the `kalshi-floor` branch. Overall: **8.5/10** (ease 8.6, friction 8.6, enjoyment 8.1), with no design blockers. Compact section labels, segmented choices, hairlines, and inline balances/actions now follow the floor. Setup actions appear sooner while the selected identity consequence remains visible. This is a heuristic review, not measured user testing.
