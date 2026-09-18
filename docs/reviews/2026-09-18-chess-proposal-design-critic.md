# Chess and move proposal design critique

## Target and evidence scope

Target: https://telarchy.com/chess and its linked proposal, participant, account, replay and bot surfaces. Reviewed on 2026-09-18, approximately 13:48 to 14:01 Europe/Ljubljana, through the rented vd-persona-1 desktop. Chromium ran on a 1024 by 768 display. Narrow checks used Chromium's iPhone XR viewport, 414 CSS pixels wide, at 100% preview scale. This is browser emulation, not a physical phone test.

Production build identity was not exposed in the reviewed UI, so no commit or build number is claimed. The game advanced during inspection, from game 58 into game 59. Findings concern those observed production states. The reviewer was independent of the implementation, but had the brief's explanation of the mechanism. No application source or private API data was used to judge the product. Developer tools were opened solely to set the narrow viewport; incidental source text in those screenshots is not evidence for any finding. The publicly linked bot guide was read as user documentation.

Screenshots: `/home/cihalvi/.cache/codex-design-critic/20260918-134750-codex/shots/`. Numbers below refer to numbered PNG files in that directory. There are 108 captures, including browser setup and intermediate navigation captures. Screenshots 01 and 02 precede successful browser launch and are not product failures. Initial mobile emulation captures 68 through 76 had a setup scaling problem; they are excluded from product scoring. Fresh navigation corrected it. Valid narrow evidence begins with 77, with legible 100% captures from 79 onward.

Only invented signup data was used. Signup supplied 100 free credits. One credit bought Higher on Bg4 in proposal #854, game 58 move 13. Screenshot 58 records the successful trade. No real payment, public discussion post, or bot execution was performed. Creating the throwaway account and this permitted free-credit trade were the only intentional product mutations. The balance subsequently displayed 124 credits; this review did not establish the source of the additional credits and does not call it a defect.

## Coverage

The initial checklist was: signed-out workspace and its full scroll; current and decided proposals; option selection and chart controls; backing a move through signup; bot routes from both pages; proposal, profile and browser-back navigation; narrow workspace and proposal; empty and finished states. The following records actual coverage, rather than treating that plan as completed work.

- [x] Signed-out workspace: headline, info disclosure, live board, ranked moves, score explanation, countdown, trade ticket, proposal list, settlement explanation, leaderboard area, season offer, bot links and footer. Screenshots 03 through 09 and 27 through 32 cover these areas. The page was traversed to its bottom, though not every footer destination was opened.
- [x] Current proposal #848: leading Bf5, all 22 options exposed, Nb1 selected, Value and Call charts, Live board, countdown and live transition to a decision. Screenshots 11 through 20. The expanded grid changed from leader-first presentation to an order that placed the leader near the end.
- [x] Decided proposals #848 and #849: chosen/voided labels, refunds, chart and closed-trading state. Screenshots 17 through 26. Also inspected #852, #853 and #854 while moving between current and decided states.
- [x] Current proposal #854: selected Bg4, entered a one-credit amount, submitted successfully, opened Limit and Sell modes, inspected the resulting position. Screenshots 54 through 62. No further sell or limit order was submitted.
- [x] Finished-game transition: game 58 stopped, the public record changed from 57 played/45 lost to 58 played/46 lost, and the page said it was waiting for the next game. Inspected #854 after that transition on narrow and desktop layouts. Screenshots 90 through 103.
- [x] New-game transition on an old proposal: #854 retained its game 58 decision while its board switched to game 59's opponent, maia5. Screenshots 106 through 108.
- [x] Account path: login, create-account link, three fields, successful throwaway registration, free balance and return to the bot setup destination. Screenshots 33 through 42. Signup was reached from the bot path, not the proposal's signed-out signup button.
- [x] Bot path from the workspace: both the chess-specific GitHub guide and generic Build your own route. Read the guide's prerequisites, feed, keys, funding, dry-run quote, live switch and Stockfish example. Screenshots 29 through 34. The guide requires curl/jq for examples, a participant key and funded credits for trades; the reference example uses Python and Stockfish. It clearly distinguishes dry runs from spending and includes beta-access caveats.
- [x] Bot path from a proposal: Add your own trading bot led to `/agents?market=chess#agent-setup`, with the chess guide, optional name, starting credits, and Create bot & get key. Screenshots 104 and 105. No key or bot was created.
- [x] Navigation: proposal Back to the market, live-feed trade row into another proposal's Activity tab, participant vi0 profile, browser back, and links between proposal rows. Screenshots 19 through 27 and 48 through 54. Clicking the feed's proposal heading and its "open" text did not navigate in 49 through 51; its trade row did in 52.
- [x] Narrow layout: workspace headline, board, move rankings, statistics, replay picker, betting ticket, decided proposal, position, Positions, Activity and Discussion tabs. Screenshots 79 through 100. Narrow coverage used the signed-in throwaway account.
- [x] Finished-game replay: chose game 57 versus maia1, labeled lost; played it, changed speed to 10x, scrubbed to move 3, and returned to Live. Screenshots 84 through 90.
- [x] Empty states: Discussion (0) and no bots/no keys. Screenshots 100 and 105. Selected Nb1 showed zero volume and no traders, but that is an empty option, not proof of a wholly untraded proposal.
- [ ] Every option, chip, metric control, date range, trade row and outgoing link: sampled, not exhaustive. In particular, not all 22/30 move options or Value date ranges were clicked. The Call 1D control was attempted but remained on All, and it was not established whether the control was disabled for insufficient history. No separate date or metric picker was encountered.
- [ ] Entirely untraded proposal: not found in the inspected live/decided examples. Do not infer its appearance from an untraded option.
- [ ] Signed-out narrow signup-to-trade continuity, OAuth, email recovery, keyboard-only use, screen reader use and a real mobile device: not tested.
- [ ] Every footer, Lichess, leaderboard, season, Otto and own-AI destination: not opened. No public message, season entry or assistant action was submitted.
- [ ] Final account ledger/payout reconciliation, limit execution, selling and actual bot operation: not verified. The permitted one-credit buy was verified on the real surface.

Coverage is PARTIAL. All scores are provisional over the untested ground. This is a single critic's heuristic assessment, not measured usability research.

Flow timing is approximate wall-clock time from the screenshot sequence, including observation and capture overhead. It is not a benchmark of a typical human. First workspace inspection to the first proposal took roughly 70 to 90 seconds and seven content actions, mostly scrolling and disclosures. From the selected #854 proposal to "Placed" took about 25 seconds and four actions: two scroll groups, enter amount, submit (54 through 58). The visible deadline fell from 40 to 15 seconds in that interval. Signup from the login screen took roughly one minute, with Create account, three field entries, a scroll and submit (33 through 39). Opening the bot guide from its visible workspace link took one click and about two seconds, followed by reading time. The profile detour took two clicks from the expanded live feed, then a separate scroll-to-top action to identify the profile. Replay selection took two clicks, with one additional action each for play, speed, scrubbing and Live.

## Blockers

**Historical proposal context becomes unreliable after a game ends.** Before the end, #854 had its title, chosen move, option prices and impact (54 and 61). After the game ended, a fresh visit showed the board without that summary, an empty How this settles box, and the vague closed status "Decided: approved" (93 through 103). The personal position still said "settles at the date" without a date (97). When game 59 began, the same proposal's summary returned but the board and move rankings described the new opponent and game (106). This blocks understanding what happened to the old decision and the held position. The lifecycle association is observed; the internal cause and payout correctness are not established.

**A historical move's board can describe a different game without a clear boundary.** Screenshot 106 names game 58 move 13 and chosen Bg4 above a live board against maia5, while the old proposal description still names bernstein-2ply (107). A visitor evaluating why Bg4 was selected can inspect the wrong position. Preserve the original position and result alongside the saved decision; label any current-game widget as a separate destination.

No payment or account-access blocker was encountered. No claim of accessibility compliance or financial loss is made.

## Visual design

### Score

7/10, provisional.

### Evidence

The dark background, cream type, orange accents and green leading prices form a coherent identity. The board is readable and its move arrows turn an abstract market into something a chess player can follow (06, 81). Thin dividers and aligned numeric columns generally support scanning. The narrow board and ticket fit their available width (79 through 83).

The hierarchy favors the large impact number over the selected move and the meaning of a score (11 through 16). The expanded option grid contains a conspicuous blank filled region (12). Call-chart endpoint labels pile up below one another for nearly tied options (16 through 19). Small gray uppercase text is frequently the only explanation of a critical number. The bot guide visibly overlaps Cancel at desktop width (105), and narrow Activity content extends beyond the available reading area (99).

### Moves to 8

- Put selected move, expected score, units and deadline together above the board and trade controls.
- Remove the empty slab beside Show all/Show fewer and label only the selected and leading chart endpoints by default.
- Give the bot guide its own full-width line so it cannot collide with Cancel; wrap mobile activity metadata.

### Moves to 9

- Use a stronger readable text style for explanations, settlement states and timestamps instead of uniformly tiny gray captions.
- Make the selected option distinct from the leading option with a labeled outline or selection marker, retaining green for the leader.
- Keep the mobile board and move actions adjacent; collapse player career statistics behind a disclosure.

### Moves to 10

- Verify long move names, tied prices, many options, zero trades and final results at narrow widths and enlarged text, with no clipped controls or overlapping labels.
- Provide a compact comparison view that remains readable without relying on color alone.

## Friction

### Score

5/10, provisional.

### Evidence

Signup is relatively light: three fields, immediate access, and 100 free credits (34 through 39). Once the correct ticket is visible, entering one credit and buying is fast, with immediate confirmation (56 through 58). There is no payment detour.

Reaching that ticket requires moving past substantial chart/board and activity content. A newcomer reads against a short countdown; several proposals closed while being inspected. The observed #854 flow used 25 of its remaining 40 seconds just to reach and submit the ticket. Mobile stacks career statistics and rankings between board and action (81 through 83). The workspace-wide game-score ticket appears before the move proposal list (08 and 09), making it easy to begin the wrong kind of bet. Profile navigation initially landed deep in activity and needed a separate top jump (23 and 24). Bot guidance is split between GitHub and account controls (30 and 32).

### Moves to 8

- Add a direct "Back this move" entry beside each move, opening a compact ticket with the move and deadline still visible.
- Keep a clear "Open current move" action on closed proposals, and preserve the selected destination through signup.
- Move nonessential statistics below the decision flow and place a plain free-credit explanation before signup.

### Moves to 9

- Let a new user learn the ticket in a non-spending preview before entering a timed live move.
- Preserve scroll on browser back, but start a newly opened profile at its identity header.
- Put the chess bot prerequisites, guide and key setup in one ordered flow without requiring the reader to reconcile multiple entry points.

### Moves to 10

- Verify that a fresh visitor can select, understand and back a move within one decision window on desktop and mobile without rushing.
- Offer a clearly labeled notification of the next available move when the current one closes, without silently changing the trade target.

## Intuitiveness

### Score

4/10, provisional.

### Evidence

The explanation "0 loss, 50 draw, 100 win" and "highest price is played" is genuinely helpful (06). The proposal question names the selected move (13), and chosen/voided/refunded states explain part of the outcome (25). The bot guide explains expected score with a concrete win/draw example.

The signed-out headline "What score will I reach this game?" leaves "I" undefined until lower content explains TelarchyRookie (04). Terms such as Value, Call, last read, pool, volume, "behind it", and "impact by until settled" require market knowledge. The prominent +0.32 remains about the leader when another option is selected (13), while the ticket changes below. The ticket's "1 cr -> 20.4" does not label the latter as a resulting price (57). Signed out, it says "250 cr, all you have" despite no account being present (09); signup then actually supplies 100 (39). Finally, a proposal's Live feed can show a different move, and its board later shows another game (20 and 106). Those context changes are difficult to predict.

### Moves to 8

- Lead with "TelarchyRookie is White. Traders choose its next move" and label the score as expected result on the 0/50/100 scale.
- Label ticket values "You spend", "Price after your bet", "If we lose/draw/win" and state the refund rule for unchosen moves beside submission.
- Replace the anonymous "all you have" claim with an explicit signup allowance or a neutral preview limit.
- Separate "Leading move" from "Your selected move", and label global activity as activity across the workspace.

### Moves to 9

- Add concise definitions for price, pool, volume and last result, accessible by click and keyboard focus.
- Keep the historical board, decision-time prices, played move and actual game result together on decided proposals.
- Rename Value and Call in the chess context to distinguish past game results from market forecasts.

### Moves to 10

- Have first-time chess players explain the trade's cost, possible payout, influence on the move and refund conditions before they submit; refine the exact labels where they guess.
- Show why the winner won with its decision-time price and tie rule, without implying that popularity proves chess strength.

## Bugs and weird behaviour

### Score

4/10, provisional.

### Evidence

The core one-credit buy worked, the position appeared, and the replay controls responded (58, 60, 87 through 90). No crash, captcha or payment error was encountered.

The historical-state blockers are the largest defects: missing summary and empty settlement text between games, followed by an old proposal displaying the new game's board (93 through 106). Live updates also change document height under the pointer. At the decision transition, a date-range click landed after the controls moved (16 through 18); later an attempted Positions interaction coincided with a shifting proposal list (61 through 63). This is observed instability, not proof that every unexpected navigation had the same cause. The settled-position card's date placeholder and unchanged worth do not explain the completed game (97). The profile landing scroll, bot guide overlap and narrow activity overflow are smaller reproducible issues (23, 105, 99). Call endpoint text rounds 20.3 and 20.4 to "20", obscuring the difference visible in the option tiles (16).

### Moves to 8

- Keep historical proposal details available regardless of whether a new game or current metric market exists.
- Render explicit final result, settled/pending status, payout and timestamp; never render an empty settlement card or an unspecified date.
- Reserve space or defer list expansion during live updates so controls do not move while being targeted.
- Fix the bot heading collision, mobile activity overflow and chart precision mismatch.

### Moves to 9

- Make loading, between-games, overdue and fully settled states explicit and stable, including after fresh navigation.
- Freeze historical charts and boards to their proposal context, with a separately labeled live-game shortcut.
- Ensure link styling matches behavior in the live feed, and make disabled chart ranges explain why they are unavailable.

### Moves to 10

- Exercise the complete live sequence with a user present: open move, last-second update, decision, next move, game end, settlement and new game, including a held position and narrow viewport.
- Verify the same historical URL retains an intelligible decision and payout record through every transition and after browser back or reload.

## Fun

### Score

6/10, provisional.

### Evidence

Watching legal moves compete on a real board is the strongest part of the product. Arrows, a live leader and the countdown make the experiment understandable in motion (06 and 81). Free starting credits make participation approachable. The immediate "Placed" message and visible personal position reward taking an action (58 and 61). Replay provides a reason to explore previous games (84 through 89).

The excitement weakens when reading costs the remaining move window, or when a completed game does not clearly finish the story of the user's bet. Dense generic trading language and the separation between board and action interrupt the chess experience. The old proposal showing a new game prevents a satisfying review of whether the chosen move helped.

### Moves to 8

- After a decision, show "Bg4 was played" on the original board, then offer the next move.
- At game end, show the result and the user's exact gain or loss with a link to replay the move they backed.
- Make the first free-credit action easy to understand without making the countdown feel like a reading test.

### Moves to 9

- Add a compact personal history of backed moves and their outcomes, linked to the corresponding board positions.
- In replay, mark proposal decision points and show the decision-time leader beside the move played.

### Moves to 10

- Let users compare their chosen move with the market's choice and follow the consequence through the game, without inventing causal certainty or an unsupported engine verdict.
- Validate that the result screen creates a clear reason to return through learning and participation, rather than merely through prizes or urgency.

## Overall

**5.2/10**, the arithmetic mean of 7, 5, 4, 4 and 6. Provisional because coverage is partial. This is a heuristic, not a measurement of real users. The live chess idea is compelling and the permitted trade worked, but historical context and settlement comprehension prevent a confident first-time experience.

The ten highest-leverage changes, ranked:

1. Preserve historical proposal identity, options and result between games and after new games begin.
2. Pin each proposal to its original chess position; clearly separate any live board from that record.
3. Show a complete settlement receipt with result, payout, profit/loss and timestamp for the user's position.
4. Put selected move, deadline and a compact backing action together near the board.
5. Explain price and payout in the ticket, including the unchosen-move refund rule and what the post-trade number means.
6. Stabilize layout during countdown, decision and proposal-list updates so actions do not move under the pointer.
7. Add an obvious next-current-move route to every closed proposal and preserve it through signup.
8. Make the first screen explain who is playing, whose turn it is, and the 0/50/100 expected-score scale.
9. Repair option-grid gaps, chart label collisions/rounding, the bot guide overlap and mobile activity overflow.
10. Complete the participation story with a move-linked personal result and replay, making it worth returning to learn from the game.

This report changes no product behavior. Documentation validation checks its required sections, screenshot references, arithmetic and punctuation; implementation tests are not applicable to a review-only document. Evidence files remain in the supplied local screenshots directory rather than being published with the report.
