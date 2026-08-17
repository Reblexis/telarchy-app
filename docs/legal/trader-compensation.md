# Paying traders: the legal paths, and what to do until one opens

_Opened 2026-08-15. Owns the question "how do forecasters on a Telarchy floor
earn real money, and how are they motivated before they can." The published
legal texts are `terms-of-service.md` and `privacy-policy.md`; this doc governs
the posture behind them. **None of this is legal advice.** Nothing here is
implemented, and no path below is taken without counsel first._

## The constraint we already published

Two commitments are live on telarchy.com and cannot be quietly reversed:

- **ToS section 2:** credits "have no cash value, cannot be purchased, and
  cannot be exchanged for money, goods, or services; no deposits into or
  withdrawals out of credits exist."
- **The LookPilot charter** cites the 2008 CFTC refusal to Google and Microsoft
  as the reason, in the owner's own first person, on the public floor.

That posture is correct and is the reason the floor could open at all. Any move
toward paying traders is a public reversal of a stated position, so it needs a
better reason than "traders would like money," and it needs to be announced as a
change rather than discovered by a user.

## Where the law actually is (checked 2026-08-15)

The window is closing, not opening.

- The CFTC issued a **proposed** rule on event contracts on 2026-06-10
  (amendments to Reg 40.11 plus a new Part 40 Appendix F), following a March
  2026 ANPR that drew ~3,500 comments. Comments closed 2026-07-27. It is **not
  final**, and it governs contracts listed on *CFTC-registered* venues, which
  Telarchy is not and will not become.
- **The federal-state war is escalating.** Kentucky's AG sued Kalshi and
  Polymarket in June 2026; Minnesota is defending its Prediction Market Statute
  against CFTC preemption. State AGs in Arizona, Kentucky and Tennessee are
  prosecuting.
- **The sweepstakes escape hatch is being welded shut.** Connecticut, Montana,
  New Jersey, California and New York moved in 2025; Indiana, Maine, Oklahoma
  and Iowa enacted in 2026. New York's statute reaches **service providers**,
  not just operators, so payment processors and platform vendors carry
  liability. The American Gaming Association has publicly framed prediction
  markets as the next target using the same playbook.

**Conclusion: the dual-currency / sweepstakes model is off the table.** It is
the one path that looks superficially easy and it is being actively destroyed.
Do not let anyone reinvent it in a design meeting.

Sources: [CRS](https://www.congress.gov/crs-product/LSB11441),
[Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2026/06/the-odds-are-in-cftc-proposes-framework-for-event-contracts-and-prediction-markets),
[Federal Register](https://www.federalregister.gov/documents/2026/03/16/2026-05105/prediction-markets),
[Venable on state escalation](https://www.venable.com/insights/publications/2026/05/states-escalate-crackdown-on-sweepstakes-casinos),
[AGA framing](https://sccgmanagement.com/sccg-articles/2026/07/09/aga-warns-sports-prediction-markets-could-follow/),
[KY AG suit](https://www.lpm.org/news/2026-06-17/kentucky-attorney-general-sues-prediction-markets-online-sweepstakes).

## First, the question is probably wrong

Before costing any of this: **trading profit was never going to be the
incentive.** The launch research measured it. Under the 250-credit per-market
position cap, the maximum profit from a correct 9-point call is about **37
credits**. Even at a generous mana-to-dollar rate that is small change, and
deepening the books enough to make it meaningful is precisely what imports the
regulatory war.

What the floor actually needs is not paid traders. It needs **enough calibrated
forecasts that a price means something**, which the research put at roughly 8
engaged traders per market. Below that, Metaculus data shows consensus is no
better than a two-trader market. Eight good forecasters is a recruiting problem
with a four-figure budget, not a licensing problem.

So the framing that follows treats real-money trading as one option among
several for buying forecast quality, and not the cheapest one.

## The paths, ranked by cost to reach

### Path A: keep credits worthless, pay for forecasting as work (available today)

**This requires no legal change at all, because the mechanism already exists and
is already lawyered.** A participant proposes a job with a price; approval is
the payment; the money moves directly between owner and proposer, outside the
service (ToS section 3).

Nothing stops that job from being forecasting work:

> "$300: I will maintain calibrated forecasts on every open market on this floor
> for eight weeks, with written reasoning on each."

That is a services contract, not a wager. There is no entry fee, no stake, no
payout contingent on chance, and Telarchy holds no funds. It is the same
transaction as commissioning a trailer, and it is already covered by the terms
that shipped in v1.2.

The elegant part: **the line between trader and contractor on a Telarchy floor
is already zero.** "Traders cannot earn real money here" is false as stated.
They can, by proposing work, and the market prices whether they are worth it.
That is the answer to the interim question and it needs nothing built.

Caveat to put to counsel: paying *by accuracy* rather than by delivery starts to
resemble a prize for performance and moves toward Path B. A flat fee for
delivered forecasts is the clean version. Keep the two distinct on purpose.

### Path B: sponsored forecasting tournament, prizes by accuracy (weeks, light counsel)

The well-trodden path, proven at scale by
[Metaculus](https://www.metaculus.com/tournament-rules/) and its sponsors
(Bridgewater, RAND). Structure:

- **No entry fee, no purchase, no stake required.** This removes *consideration*,
  the first element of gambling.
- **Prizes allocated by forecasting accuracy**, algorithmically, by published
  scoring rules. Skill predominates, which addresses the *chance* element.
- Rules published up front, eligibility geofenced where required.

Telarchy is already most of the way here: credits are free and non-purchasable,
so there is no consideration today. The work is a published rules document, a
scoring rule that is accuracy-based rather than bankroll-based, and eligibility
screening.

**The one design change this forces:** prizes must key off *calibration rank*,
not *credit profit*. Credit profit is partly a function of how much you staked,
which reads as betting returns. Calibration rank reads as a skill score. The
leaderboard already computes net worth minus platform grant; it would need an
accuracy-ranked sibling.

**OVERRIDDEN 2026-08-17 (Viktor)**: Season 1 ranks on credit profit marked to
market, the number `GET /api/leaderboard` already returns, scored as growth
across the season window. The owner took this decision twice, the second time
after being shown that a thin book makes it exploitable (buy your own position
up, have it marked at the live price, top the board with nothing resolved), and
held it against an independent Codex review that raised the same objection
cold: *"we will mitigate later by improving markets design .. for now lets keep
it this way."* Recorded rather than argued. Two things follow. Calibration rank
is not built, so this paragraph describes a Season 2 option rather than the
shipped design. And the hedge is scheduling, not code: end a season only after
at least one of its markets resolves, or the whole ladder is paid on unrealised
marks. As of 2026-08-17 the LookPilot floor shows one horizon and it resolves
2026-12-31, so this is a live constraint on Season 1's end date, not a
hypothetical.

Risk: moderate and manageable. This is the recommended first real-money step.

### Path C: route execution to a regulated venue (months, real counsel)

Telarchy generates the signal; the user trades on Kalshi or similar through
their own account and their own API keys; Telarchy never custodies funds.

The live question, and it must not be assumed: **does passive, non-discretionary
routing avoid Introducing Broker registration?** Do not reason by analogy from
the CFTC's treatment of self-custody crypto wallets. This is the single question
to put to derivatives counsel, and the answer determines whether the path exists.

Also note this path only serves markets a regulated venue will list. Nobody is
listing "LookPilot net 2026," so it is irrelevant to the current floor and only
matters if Telarchy later prices public events.

### Path D: become or partner with a licensed venue (years, extreme)

Own DCM, white-label via a partner stack, or on-chain futarchy with a
MetaDAO/Butter-style partner. Ignore until there is a Series A and a prestige
regulatory firm. Listed only so nobody proposes it as a shortcut.

### Path X: sweepstakes / dual currency. Do not.

See above. Being actively legislated out of existence, with service-provider
liability attaching in New York.

## What the constraint actually is (researched 2026-08-17)

The doc above reads as more cautious than the law supports, and the caution was
pointed at the wrong thing.

**Gambling needs three elements: prize, chance, and CONSIDERATION.** Telarchy has
no consideration. ToS section 2 already makes credits free, non-purchasable and
non-redeemable, and a season has no entry fee and no stake. That absence is the
shield, and it holds regardless of the scoring rule. The scoring rule changes how
the contest reads, not whether it is gambling. Worth remembering that regulators
assess how a contest operates rather than what it is called, which is why the
published rules have to describe the real mechanism.

**The binding constraint is a number: $5,000 of total prize value.** Above that,
New York requires sweepstakes registration and bonding 30 days ahead and Florida
7. Under it, no US state requires registration, and skill contests are generally
exempt outright. So:

- A bounded season with a pool under $5,000 needs no registration anywhere.
- A recurring $1,000/week ladder crosses the threshold in **week five**, which is
  the concrete reason Season 1 is one bounded season rather than a weekly
  commitment.
- A $500 top prize also sits under the $600 US information-reporting threshold
  that would otherwise put a 1099 obligation on a US payer. Convenient, and a
  reason not to raise the top rung without checking.

`POST /api/seasons` enforces the $5,000 limit at creation rather than leaving it
to memory, and `season-lifecycle.test.ts` pins it.

Sources: [Klein Moynihan Turco on registration and bonding](https://kleinmoynihan.com/sweepstakes-registration-and-bonding-requirements-2/),
[Walters Law Group skill gaming guide](https://www.firstamendment.com/skill-gaming-legal-guide/),
[National Law Review on skill-based contests](https://natlawreview.com/article/your-contest-really-skill-based-legal-risks-businesses-overlook).

## Jurisdiction: an unresolved inconsistency to fix

The ToS names **Delaware** governing law and exclusive Delaware jurisdiction.
LookPilot revenue flows to a **Czech** entity, and the SF campaign record treats
a Delaware C-corp as a thing to form, not a thing formed. If no US entity
exists, the choice-of-law clause is permissible but odd, and it arguably
*increases* US regulatory nexus for no benefit.

Before any real-money step, settle: which entity operates the service, in which
jurisdiction, and does the answer change the analysis. An EU-operated,
US-geofenced service faces a completely different regulatory map from a Delaware
corporation, and the whole analysis above is US-shaped by inheritance from the
SF plan rather than by a decision.

## What to ask counsel, and which counsel

Primary: **CFTC / derivatives counsel.** Secondary: gaming/gambling, then
fintech/payments only if funds are ever handled.

1. With credits free, non-purchasable and non-redeemable, and prizes awarded on
   published accuracy scoring with no entry fee, is a Telarchy tournament a
   skill contest rather than gambling or an event contract? In which states does
   that fail?
2. Does paying a participant a flat fee for delivered forecasts (Path A) carry
   any different analysis from paying them for a trailer? Where is the line
   between that and a performance prize?
3. Does passive, non-discretionary routing to a registered venue make Telarchy
   an Introducing Broker?
4. If the operating entity is Czech and US users are geofenced, which of the
   above changes?
5. Does the owner paying job proposers directly, outside the service, create
   employer-of-record, withholding, or money-transmission exposure for either
   side at volume?

## Incentives until a path opens

Ranked by strength, given that no trader can be paid for trading today.

1. **Agency, demonstrated rather than asserted.** A forecast here decides
   whether a real person gets paid to do real work on a real company. No other
   venue offers that, and it is the entire reason someone chooses this floor
   over Manifold. But it is currently a claim: **zero jobs have been approved and
   paid.** One completed approve-and-pay loop converts the strongest incentive
   from a promise into a fact, and it costs a few hundred dollars.
2. **Path A, stated out loud.** Put "you can also propose forecasting work and
   be paid for it" on the floor. Traders currently have no idea this door
   exists.
3. **A portable calibration record.** The Manifold import already treats
   forecasting reputation as portable and worth money. The reverse has never
   been built: an exportable, verifiable Telarchy record. Cheap, and it is the
   only durable asset a trader accumulates here.
4. **Named credit in the outcome.** A "priced by" byline on every approved job,
   permanently. Costs nothing, and for this audience attribution on a real
   decision is worth more than small cash.
5. **Credits themselves, honestly framed.** They buy influence over real
   decisions. That is a real thing to want, and it is currently undersold
   relative to how it is framed on Manifold.

## Open owner decisions

- Does Telarchy want paid trading at all, given the 37-credit ceiling finding
  and the cost of the regulatory path? **Undecided.**
- Path B tournament: run one, and who funds the prize pool? **DECIDED
  2026-08-17 (Viktor)**: yes. Season 1 is one bounded 4-week season, $1,000
  pool, top five at $500/$250/$125/$75/$50, funded by the owner and paid
  manually outside the Service. Shipped 2026-08-17: `prize_seasons` and
  `season_entries`, `lib/seasons.ts`, `routes/seasons.ts`,
  `GET /api/leaderboard?seasonId=`, ToS section 3a (consent version 1.3), and
  the published rules at `docs/legal/season-1-rules.md`.
- Path A (pay a participant a flat fee for delivered forecasting work): still
  available, still costs nothing to build, and still has **zero jobs approved
  and paid**. Recommended twice on 2026-08-17 as the cheaper first proof of
  "pays real money" and declined in favour of the tournament: *"i dont want
  some paid forecasting job flow.. do tournament now."* Unchanged and unblocked.
- Operating entity and jurisdiction. **Still unresolved**, but no longer
  blocking: manual payout outside the Service was chosen specifically so a
  season does not depend on the answer. It will start to matter at volume.
- When to retain derivatives counsel, and at what budget. **Undecided.** Lower
  priority than this doc previously implied, given the consideration finding
  above; an hour on state-AG posture before announcing is still worth buying.

## Known and accepted risks in Season 1

Recorded so nobody re-derives them, and so that if one of them happens it was a
decision rather than a surprise.

- **Mark-to-market ranking is exploitable on a thin book.** See the override
  above. Accepted; mitigation deferred to market-design work.
- **No Sybil defence.** Credits are free, entry is free, and an account created
  after the season starts baselines at zero, so one person running several
  accounts is the cheapest way to farm a five-place ladder on an eleven-row
  board. A linked-Manifold identity gate was offered and declined for Season 1
  ("simple setup first and ill iterate on it after"). The controls that remain
  are manual settlement (the owner reviews standings before assigning anything)
  and a disqualification clause in the published rules. Bounded at $1,000, and
  it would fail in public. Tracked in `TODOS.md` under P2 prize seasons.
- **Void asymmetry.** `computeTradingProfit` floors a void refund at zero, so a
  losing buy on a voided market reads as exactly zero rather than a loss, while
  a gain realised by selling out before the void is kept
  (`leaderboard.test.ts:388-431`). That makes the void button part of the
  contest. Handled by a commitment in the rules not to void during a running
  season except for a declared, announced error. The code fix is a TODO.
