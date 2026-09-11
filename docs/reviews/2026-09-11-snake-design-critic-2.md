# Target and evidence scope

Target: https://telarchy.com/snake, live public deployment on 11 September 2026, approximately 16:54 to 17:04 Europe/Ljubljana. No build identifier was exposed in the reviewed UI. This is an independent review of the rendered product, without implementation changes, signup, betting, or posting.

Device: rented da-linux-web-interactive-1 Linux desktop, Chromium, 1024 × 768 display. Desktop browser content was approximately 1024 × 654. Narrow testing used Chromium's 390 × 844 device viewport after the outer window refused to shrink below approximately 500 px. The emulated viewport extended below the available screen; this is not a physical-phone test.

Screenshots: `/home/cihalvi/.cache/codex-design-critic/20260911-165339-codex/shots/`, numbered 01 through 43. Screenshot numbers below identify files with that prefix. Screenshots 20–24 document viewport setup rather than product findings. DevTools was opened solely to set the viewport; its initial Elements panel appeared incidentally. Source text and issue counts were not used as review evidence. All product findings come from visible page content and actual UI actions through deskctl.

The first ten seconds communicate a polished financial-looking Snake page and two values of 2.00. They do not readily communicate the entertaining premise: a market controls the game. That explanation requires opening a small info control. Once found, the tie explanation and conditional proposal question help considerably.

# Coverage

Checklist established before interaction:

- [x] Signed-out desktop landing, title question, NOW, MARKET'S CALL, segment row, and title info disclosure: 01–02.
- [x] Populated LIVE board, snake, food, arrows, next-move line, ticking countdown and tie explanation: 03–05, 10, 29–31.
- [x] Movement across a minute boundary: the snake moves one cell right between 30 and 31, consistent with “continue forward.” Multiple changing minute and attempt states were encountered across the session.
- [x] Replay game selection, drag scrubber, Play, 1x to 10x, and Live return: 05–10. The sole listed game was Game 1, 12×12, best 5. Scrubbing changed Step 202 to 295; playback progressed to 300 and then 365 after increasing speed.
- [x] VALUE and CALL charts: proposal desktop charts 17–18; floor narrow charts 40–42, plus floor CALL on 26. Charts rendered populated data.
- [x] Three current proposal rows and expanded decided rows on desktop: 14–15. Narrow proposal rows: 43.
- [x] Open proposal, read if-approved and if-declined numbers, inspect ticket: desktop Continue forward 16–19; narrow Turn left 32–36. Return using “Back to the market”: 38–39.
- [x] Floor Higher/Lower selection and stake adjustment without submission: 11–13. Lower changed the ticket color; dragging produced a 6 cr preview and changed 2.00 to 1.95.
- [x] Narrow title, metadata, info disclosure, LIVE board, timing line, Turn left proposal, and its Higher ticket: 25–36.
- [x] Expired/decided proposal state: ticket disappeared while inspecting it; page later showed DECLINED and decision timestamp 17:02:58: 35–38.
- [ ] Exact visual sequence at :58 versus :00 was not captured with second-level sampling. Countdown decreases and actual movement are verified; exact lock timing and intermediate approval feedback remain unverified. The decided timestamp supports a :58 decision, not a full observation of the transition.
- [ ] Replay controls were fully exercised on desktop, only inspected on narrow. Mobile stake drag coincided with expiry, so a successful narrow stake change is not established.
- [ ] Floor charts were inspected at narrow width; desktop chart evidence is from the proposal page, not a second desktop floor pass.
- [ ] Empty replay, network failure, captcha, and stale-read states were not encountered or artificially created. No “read 5m ago” was observed. No authenticated or transactional states were tested, as instructed.
- [ ] Keyboard-only access, screen reader output, measured contrast, physical touch, other browsers, nonzero market participation, and a full 60-move attempt were outside this observation.

Timing and friction: these are approximate review-session elapsed times including remote-tool and screenshot overhead, not instrumented page latency or a benchmark of normal users. Initial landing was populated by the first screenshot, within roughly ten seconds of launch. Info took one click, roughly ten seconds to capture and read. Reaching the desktop board and timing row took two scroll gestures, about 45 seconds during inspection. Replay took six actions including opening the selector, selecting, dragging, playing, changing speed and returning Live, about 110 seconds. Floor Lower and stake preview took two actions, approximately 25 seconds. Proposal discovery required another scroll and opening decided rows; inspection consumed about one minute and crossed a refresh. Opening the narrow Turn left shortcut took one click, but reaching its title and then ticket required three scrolling gestures and about 40 seconds. It expired while being inspected. The narrow reload initially showed only the title and question (25); data was present by the next observation about ten seconds later (26). Exact network load time was not measured.

Scores are provisional over the uncovered states. No formal time budget was specified in brief.md. This report records the completed sample and its gaps rather than claiming exhaustive coverage.

# Blockers

1. **Live list target instability, observed navigation hazard.** Screenshot 15 showed Turn left at the clicked location with eight seconds remaining. The subsequent click opened the next minute's Continue forward proposal, #3503 (16). The likely cause is minute refresh replacing the row before the click landed; the evidence does not isolate event timing. This can take a visitor to a different proposition than intended. Preserve row identity under the pointer and retain expired rows in place with an explicit next-round transition. No wrong bet was submitted.

2. **Conditional bet meaning is insufficiently explicit at the action point.** The proposal header asks an if-approved length question, and the ticket carries “if approved,” which are useful. But the Turn left ticket itself offers “Higher,” “0 cr → 2.00,” and large maximum payouts without stating in a complete sentence what Higher predicts (32–35). A first-time visitor can mistake Higher for a vote to turn left. Add a persistent preview such as “Predict a higher reached length if Turn left is approved,” a labeled reference value, and the applicable declined/settlement treatment. This is a material comprehension risk, not a claim that the underlying settlement is incorrect.

No login, network, or rendering failure blocked basic viewing. No material accessibility failure was established by this limited pointer-based review.

# Visual design

## Score

7/10, provisional.

## Evidence

The cream serif headings, dark surfaces, amber forecast number and bright snake give the page a coherent identity (01–03). Large values and distinct selected tabs scan well. Green and red ticket states are immediately distinguishable (11–13). The mobile proposal numbers stack cleanly (32).

The desktop grid is so tall that the initial view shows neither snake nor next-move controls, and the controls view loses most of the board (01, 03–04). Small widely spaced metadata has much less visual weight than the large payout buttons. At 390 px the crucial freshness and forecast metadata is ellipsized (28). VALUE history clusters at the far right of a mostly empty chart, particularly on narrow screens (41). The floating assistant overlaps lower-right content in desktop captures (14–19).

## Moves to 8

- Cap the desktop board using available viewport height so the whole board and next-move line fit together.
- Wrap the mobile freshness and settlement metadata instead of truncating it.
- Give proposal action names more prominence than game, attempt and move identifiers.

## Moves to 9

- Set the default chart range around available observations, with readable labels at narrow widths.
- Reserve space for the floating assistant so it does not cover chart labels or section controls.
- Increase the size and contrast of timing and settlement metadata relative to secondary identifiers.

## Moves to 10

- Verify visual hierarchy with real first-time readers at desktop and phone sizes, including long values and populated markets, and resolve any remaining clipped or competing labels.

# Friction

## Score

5/10, provisional.

## Evidence

Info, chart switching, the board's proposal shortcut and Back to the market are single-click actions (02, 17–18, 32, 39). Replay selection, scrubbing and speed all respond without signup (05–10). The floor preview can be adjusted while signed out (13).

The oversized desktop board separates task context from controls. The ticket and proposals sit further below, making a one-minute decision window costly to explore (03–19). The narrow Turn left ticket expired before the inspection finished (35–36). At 1024 px the ticket is below the board, not the brief's anticipated right column. That is observed responsive behavior, but increases travel. Expiry removes the ticket and shifts the page rather than preserving a disabled preview.

## Moves to 8

- Place next-move timing and a direct current-proposals link beside the board.
- Keep expired tickets in place with a disabled state and a “View current move” action.
- Provide a compact three-direction proposal comparison near the live game.

## Moves to 9

- Keep the selected proposal's direction, countdown and conditional prediction visible while scrolling its ticket.
- Allow replay seeking by labeled move/attempt as well as a long unlabeled slider.

## Moves to 10

- Measure time from arrival to correctly identifying the next move and inspecting its ticket with first-time users; remove remaining unnecessary scroll and navigation steps without hiding consequences.

# Intuitiveness

## Score

5/10, provisional.

## Evidence

“A snake game steered by this market” is the clearest introduction but is hidden in the info disclosure (02). The next-move copy explains that nobody has priced the step and ties play forward (04, 29). The conditional proposal question and separate approved/declined numbers are helpful (16, 32).

Three same-color arrows appear around the snake while the text chooses forward (29–31). They depict possible directions, but do not visually isolate the selected next cell. “Reached length,” “market's call,” attempt count and the time horizon require more interpretation than a casual game visitor expects. “Step 202: start” on selecting the sole replay lacks a clear relationship to game/attempt/move naming (06). The signed-out ticket says “250 cr, all you have,” making a demo allowance look like a personal balance (11, 35). The detailed explanation of what the snake would do and how the proposal decides is far below the ticket (36).

Higher on Turn left is interpretable as a prediction of a higher reached length conditional on that proposal being approved, rather than simply choosing the left direction. The header supports this reading. The precise economic consequences are not sufficiently clear from the compact ticket alone, and were not tested through submission.

## Moves to 8

- Show the one-sentence market-controlled-game explanation by default.
- Highlight only the currently selected next-cell arrow; render alternatives distinctly and label them as options.
- Add a full conditional prediction sentence and labeled price/reference value inside the ticket.
- Label signed-out credit amounts explicitly as a preview or starting allowance, as appropriate to the actual product.

## Moves to 9

- Explain reached length, attempt reset and settlement horizon next to the headline using one concrete example.
- Rename replay positions using the same game, attempt and move vocabulary as proposals.
- Distinguish “decision locks in” from “snake moves in” with visible states for both events.

## Moves to 10

- Validate that new visitors can explain Higher on Turn left, identify the impending move, and explain what happens after decline without opening help; revise language until those misunderstandings disappear.

# Bugs and weird behaviour

## Score

6/10, provisional.

## Evidence

The countdown ticks (04–05, 29–30), the snake advances (30–31), replay controls work (06–10), charts populate (17–18, 41–42), and decisions appear with a :58 timestamp (38). There was no observed crash, captcha or persistent blank replay.

The most significant observed anomaly is the proposal target changing between reading the list and opening a row (15–16). Expiry removes a ticket in the middle of inspection and shifts unrelated text into its position (35–36). At narrow reload, the page briefly displays a title and question with a large blank area before values and chart populate (25–26). Initial replay step numbering is surprising but cannot be called a backend error from screenshots alone. Identical 2.00 predictions and a flat CALL chart are consistent with the visible zero volume and unpriced-step explanation; they are not evidence of a stale-data bug.

## Moves to 8

- Stabilize live proposal rows across round changes and preserve the clicked proposal identity.
- Replace disappearing expired tickets with a stable decided state and clear status message.
- Reserve loaded component space with an explicit loading state when data is pending.

## Moves to 9

- Show the previous move, its decision and the resulting board update together so users can reconcile the transition.
- Add a visible delayed-update state and recovery affordance if expected live data does not arrive.

## Moves to 10

- Verify precise :58/:00 transitions, slow connections, reconnects and clicks during refresh on desktop and touch devices; retain predictable selection and layout throughout.

# Fun

## Score

5/10, provisional.

## Evidence

The simple bright snake, visible food and possibility of collective steering provide a strong premise (03, 29). Replay at 10x creates more momentum than the one-minute live cadence (09). The explicit tie explanation makes an inactive market understandable (04).

During this visit, zero volume and repeated forward ties left the experience mostly observational. The arrival does not quickly reveal the entertaining premise, and a single-cell move has little accompanying explanation or celebration (01, 30–31). The long waits are amplified when the controls and snake cannot be seen together. Large betting controls dominate over spectator-oriented context and highlights (04, 11). This score reflects the observed quiet market, not an active stream with participants.

## Moves to 8

- Show a short “last move and why” update when the snake advances.
- Surface a watch-only introduction and a quick replay highlight for visitors arriving mid-round.
- Keep the live board, current choice and countdown in one view.

## Moves to 9

- Add replay jumps to food, turns, crashes and best-length moments.
- Make imminent food and collision consequences legible as board annotations without implying guaranteed outcomes.

## Moves to 10

- Test the spectator experience during both quiet and active markets; tune motion, highlights and event feedback so waiting remains engaging without obscuring prices or encouraging uninformed bets.

# Overall

**5.6/10**, the arithmetic mean of 7, 5, 5, 6 and 5. This is a heuristic critic judgment, not a measurement of real users. Coverage status is PARTIAL because exact transition timing and some repeated desktop/mobile interactions remain unverified.

Ranked highest-leverage changes:

1. Stabilize proposal row identity across the minute refresh to prevent opening an unintended proposition.
2. Put the conditional meaning of Higher/Lower and the reference value directly in the proposal ticket.
3. Show “a snake game steered by a market” by default on arrival.
4. Fit the desktop board, selected direction and countdown into one viewport.
5. Visually distinguish the selected next-cell arrow from the alternatives.
6. Keep expired tickets in place with a decision summary and link to the current move.
7. Separate decision-lock timing from movement timing and show what just happened.
8. Preserve full freshness and settlement information on mobile, and label signed-out credits honestly.
9. Unify replay labels with game/attempt/move language and add highlight jumps.
10. Add compact current-proposal comparison and a last-move explanation to support watch-only visitors.
