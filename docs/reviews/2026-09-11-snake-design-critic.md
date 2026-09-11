# Target and evidence scope

Target: https://telarchy.com/snake, public live deployment observed on 11 September 2026, approximately 13:13 to 13:29 UTC. No build identifier was visible or verified. This is an independent first-visit critique, not measured user research. The reviewer had the task brief but no implementation history or requested target score.

Device: rented da-linux-web-interactive-1, Chromium, Linux desktop at 1024 × 768. Narrow testing used Chromium's iPhone 12 Pro viewport, 390 × 844 CSS pixels, displayed at 100% with its lower portion outside the available desktop height. A roughly 500-pixel ordinary window was also inspected. Signed out throughout. No signup, bet submission, post, or purchase occurred.

Screenshots: `/home/cihalvi/.cache/codex-design-critic/20260911-151251-codex/shots/`, numbered 01 through 58. References below identify these files by number and descriptive suffix. All product observations come from rendered UI and real clicks. Developer tools were opened only to configure the responsive viewport; incidental source text in the adjacent panel is not evidence for this report. No source inspection or DOM extraction informed the findings.

Browser setup artifacts 21 and 27–35 are excluded from product judgments. A malformed address-bar entry was a tooling mistake. Temporary clipping during responsive setup disappeared after resetting browser zoom and reloading. It is not reported as a product defect. Tool round trips varied from about one to five seconds, so elapsed flow times below include observation and automation overhead and are not page-performance benchmarks.

# Coverage

The initial checklist was: signed-out landing and title information; NOW and MARKET'S CALL; LIVE board, food, arrow, countdown and decision/move transitions; replay selection, scrub, Play, speed and Live; VALUE and CALL charts; current and decided proposal lists; proposal conditional prices and ticket; floor ticket; repeat landing, live/replay and proposal inspection at phone width; look for populated, empty, stale and error states.

## Covered

- [x] Desktop landing, headline, NOW, MARKET'S CALL and segment row: 01, 22. The page was populated by the first screenshot, roughly several seconds after opening. Exact first-paint time was not measured.
- [x] Title information on desktop and phone: 02, 17, 37, 57. One click opens it, but the underlying headline is drawn across the explanation.
- [x] Desktop LIVE board, snake, food and arrow: 03–04. Reaching the countdown required seven wheel notches in two scroll actions. The board cannot fit with its controls at this desktop height.
- [x] Countdown changes and movement across minutes: 04–05, 10, 39–50. At phone width the snake grew after reaching food, later turned, and advanced upward after a decided state. The arrow agreed with forward relative to its current heading.
- [x] Decision-to-move transition: 48 shows a countdown, 49 says “Next move: continue forward, decided,” and 50 shows the snake one cell farther upward and a restarted countdown. Exact synchronization to wall-clock :58 and :00 was not measured; screenshot and remote-control latency preclude that claim.
- [x] Desktop replay: open selector, select Game 1, drag scrubber, Play, change 1x to 10x, return Live: 05–10. Six actions, about 80 seconds including screenshot inspection. Labels advanced from Step 202 to 251, 252 and 271. No empty replay occurred.
- [x] Phone replay: the same six actions, about 50 seconds: 41–46. Board positions and food changed with replay. The status line wrapping shifted the controls.
- [x] VALUE and CALL render populated charts: 23–25. One click per segment; visible response by the next screenshot. VALUE shows historical changes between approximately 1, 2 and 3. CALL shows a flat 2 and a time axis. CALL also rendered at narrow width: 26, 36.
- [x] Floor ticket: Higher default, select Lower, drag stake, inspect preview, without submitting: 11–13. Two input actions, about 35 seconds. Selecting Lower changes the selected color; dragging previews 4 cr and 1.01 with a payoff strip. The ticket is below the board at 1024 pixels, not in a visible right column.
- [x] Three current proposals and decided disclosure: 14–15. Show expands declined rows and their “open” links. The three direction choices refresh with the minute.
- [x] Desktop proposal navigation and conditional prices: 16–19. Navigation retains the prior scroll position; a separate Ctrl+Home was needed to find the title and 2.00 approved/2.00 declined values. Two actions, about 25 seconds.
- [x] Phone landing and information at 390 pixels: 36–38. Headline fits after browser setup; settlement metadata is ellipsized.
- [x] Phone current proposals and Turn left detail: 51–58. One scroll sequence from the floor ticket exposes all three choices. Opening Turn left retains the old scroll position. Scrolling upward finds the ticket, with Higher selected and “if approved.” Dragging previews 6 cr → 4.71 and a payoff range from -6 cr to +114 cr. Later, the decided page shows 3.00 approved and 3.00 declined.
- [x] Populated, zero-activity and expiring states: initial floor had zero volume and zero participants; selected replay was populated; proposal countdowns reached “now”; the Turn left ticket vanished as the proposal decided: 54–56. Read age reached 1m and later returned to just now: 24–25, 36–37. No observed 5m stale read, captcha, 403, or visible error screen.

## Not covered and why

- [ ] Exact second-level :58 approval and :00 movement accuracy. The state sequence was observed, but remote screenshots were not a continuous timed recording.
- [ ] A desktop proposal ticket's side and stake interactions before expiration. The inspected desktop proposal decided while being explored. The live Higher stake interaction was exercised on the phone viewport instead.
- [ ] Switching the phone proposal ticket to Lower. The attempted click coincided with the ticket disappearing on decision, so success is not claimed. Floor Lower was verified separately.
- [ ] A separate earlier game. The selector offered only Game 1; its recorded earlier steps were tested.
- [ ] Empty replay, network failure, lapsed proposal and prolonged stale-read recovery. These did not naturally occur; no failures were manufactured.
- [ ] Physical touchscreen, screen reader, keyboard-only completion and contrast measurement. Small text and layout observations are visual findings, not a completed accessibility audit.
- [ ] Signed-in flows and transaction execution, deliberately outside scope.

Coverage is substantial but partial. Scores are provisional for the untested behavior above.

# Blockers

1. The primary onboarding explanation is materially obscured. On desktop and phone the headline paints across the open information popup (02, 37, 57). A newcomer asking what the market-controlled game means receives overlapping text at the exact point of explanation. Give the popup an opaque surface above all page content, or use an inline disclosure that moves the headline.
2. The proposal ticket does not explain the consequence of Higher at the point of selection. “Turn left,” “if approved,” a credit-to-number arrow and a distant settlement paragraph must be combined to infer what is being bought (53–55). For a first-time visitor, interpreting Higher as support for turning left is a material risk. Add a plain sentence stating the conditional reached-length exposure, the preview's meaning and what happens if the proposal is declined. No erroneous transaction was performed or inferred.

# Visual design

## Score

6/10, provisional.

## Evidence

The warm serif headings, dark surface, monospaced market numbers and orange emphasis form a coherent identity (01, 23–25). The green snake with eyes and coral food are immediately recognizable (03, 39). The page is pleasant to look at.

Hierarchy does not consistently serve the game. At 1024 × 768 the header and question occupy enough space that only the top of the board appears in the first screen. The 12 × 12 board then exceeds the useful viewport height (01, 03–04). Small muted uppercase metadata is harder to scan than the oversized numbers. At 390 pixels the settlement information is truncated (36), and the popup collision spoils otherwise restrained styling (37).

## Moves to 8

- Size the desktop board against available viewport height so the snake, countdown and replay controls fit together.
- Fix the information popup's stacking and opaque background.
- Wrap the market settlement label on narrow screens and increase the size and contrast of essential timing text.

## Moves to 9

- Put each direction first in proposal rows, with game, attempt and move in secondary metadata.
- Keep a stable two-line space for live and replay status so adjacent controls never move.

## Moves to 10

- Tune the game, proposal and chart layouts as one responsive system across short desktops and phones, including long labels and expanded help, with no clipping or competing fixed overlays.

# Friction

## Score

5/10, provisional.

## Evidence

Replay and chart actions need few clicks and visibly respond (05–10, 23–25). Signed-out stake previews are available without signup (13, 55), which supports exploration.

The main cost is distance and lost context. The desktop countdown is seven wheel notches below landing. The floor ticket and proposals require still more scrolling (01–14). Both desktop and phone proposal navigation preserve a deep scroll position, requiring an explicit return upward to understand the destination (16–17, 53–54). Exploration competes with a one-minute decision window; the ticket disappears before the user finishes inspecting it (55–56). The observed six-action replay loop took about 80 seconds on desktop and 50 seconds on phone, including remote-tool and screenshot overhead.

## Moves to 8

- Keep the board, live status and three active direction summaries together.
- Scroll new proposal navigation to its heading and expose a clear return-to-game link.
- Replace an expired ticket in place with its decision status and a link to the next move's proposal, preserving the user's context.

## Moves to 9

- Provide a compact proposal preview beside or below the game that includes conditional prices and the explanatory stake preview.
- Add replay jump points for attempt starts, food and deaths, reducing trial-and-error scrubbing.

## Moves to 10

- Preserve replay selection and preview settings across inspection and return, with clear labels showing what is historical and what is live.

# Intuitiveness

## Score

4/10, provisional.

## Evidence

Within ten seconds, the title establishes Snake and the two large values establish current versus forecast numbers. It does not clearly establish why a market controls this snake, what “reached length” means across deaths, or why a future time matters (01). The info popup should bridge that gap but overlaps the question (02).

The detailed settlement explanation is useful once found far below the game (14). The proposal body explains approval and refund of the counterfactual market (16, 53). On Turn left, Higher therefore means exposure to higher reached length in the approved scenario, not simply voting for left. That interpretation is assembled across disconnected UI. “6 cr → 4.71” does not name what the right-hand number represents (55). The signed-out floor says “250 cr, all you have,” presenting a balance-like claim without explaining that this is a preview (13).

The live arrow and relative heading do agree (39–50). However, replay begins at “Step 202: start” without explaining whether this is a recording window, attempt start or game start (06, 42). Equal proposal impacts and zero participation provide little visible reason for a selected move (14, 52).

## Moves to 8

- Add one visible sentence above the game: the market chooses a direction each minute based on predicted reached length; clarify the decision and movement times.
- Add a contextual Higher/Lower sentence naming the measured outcome and approved or declined scenario, plus the refund rule.
- Label both sides of the stake preview and explicitly identify signed-out credits as illustrative.
- Explain the winning proposal and tie/default rule beside Next move.

## Moves to 9

- Distinguish attempt length, record length and settlement horizon with short labels near NOW.
- Label replay start with attempt and recorded time, and show whether earlier history is unavailable.

## Moves to 10

- Offer an optional worked example using the current three directions and their conditional prices, ending in a plainly explained decision without requiring a bet.

# Bugs and weird behaviour

## Score

5/10, provisional.

## Evidence

The important engine-facing UI works: countdowns tick, the board moves, replay changes frames, chart segments load, and stake previews recalculate (04–13, 23–25, 39–55). No visible network error or empty replay occurred.

The information popup has a reproducible overlap on both sizes (02, 37). Route changes retain scroll unexpectedly (16, 53). Status wrapping moves replay controls (43–45, 49–50). A proposal's ticket disappears while being inspected, leaving a large change in page content without an in-place outcome notice (55–56). The active proposal list refreshed around the first desktop click, and the opened proposal differed from the previously observed row, a timing hazard rather than a proven incorrect link (15–17). Exact minute synchronization remains unverified.

## Moves to 8

- Fix popup layering and route scroll restoration.
- Reserve stable status and ticket space; replace expiring content with an explicit result rather than removing it abruptly.
- Keep proposal identity stable under the pointer during refresh, or temporarily disable changing rows with a clear updating state.

## Moves to 9

- Show separate “decision locked” and “moves in” states, with a clear stale-connection indicator if live updates stop.
- Exercise keyboard focus through proposal expiration and replay status changes so controls do not vanish underneath focus.

## Moves to 10

- Verify uninterrupted behavior under reconnects, empty recordings and delayed server decisions, with visible recovery and no misleading live claim.

# Fun

## Score

6/10, provisional.

## Evidence

The snake is charming, the arrow gives anticipation, and seeing it eat, grow and later turn provides a small satisfying payoff (39–46). Replay at 10x is the strongest immediate exploration feature because it compresses waiting (09, 45).

The live minute feels quiet. Zero visible participants and volume, flat market values and equal impacts make the social decision process hard to feel (14, 25, 52). “Decided” acknowledges a transition but offers little celebration or explanation (49). A visitor from Twitch or X must scroll and wait before discovering the interesting part.

## Moves to 8

- Show the current three directions and winning rationale beside the snake throughout the countdown.
- Add concise, optional visual feedback for food, death, new attempts and a record.
- Expose a “watch the last attempt” replay shortcut near the first screen.

## Moves to 9

- Add a small recent-events strip linking memorable outcomes to their replay positions.
- Explain low-activity or tied rounds honestly so the game still tells a coherent story when no one trades.

## Moves to 10

- Make an entire attempt understandable as a short replay story with decisions, growth and outcome, while retaining reduced-motion and quiet viewing options.

# Overall

**5.2/10**, the arithmetic mean of 6, 5, 4, 5 and 6. This is a heuristic assessment of the observed experience, not a measurement of real users. The game and market controls work in the tested states, but onboarding, context and expiry behavior make a first visit harder than the visual polish suggests. Status: **PARTIAL**, because the exact timing and some proposal-ticket interactions remain unverified.

The ten highest-leverage changes, ranked:

1. Explain Higher/Lower's conditional outcome and refund rule directly in the proposal ticket.
2. Repair the title information popup so its explanation is readable on desktop and phone.
3. Fit the live board, countdown and direction choices in one useful viewport.
4. Open proposal routes at their title and provide an obvious return to the game.
5. Replace expiring tickets in place with a decision result and next-step link.
6. Show why the next move won, including equal-price and default cases.
7. Clarify reached length, attempt resets and settlement time beside the primary values.
8. Rename the stake preview quantities and mark signed-out credit balances as illustrative.
9. Keep replay controls stationary and add attempt, food and death jump points.
10. Lead proposal rows with the direction and wrap essential timing metadata on phones.
