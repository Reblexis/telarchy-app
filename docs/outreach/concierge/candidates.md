# Concierge candidates (private — gitignored)

Status: WIP. Started 2026-04-29 during memory dump phase.

## Captured from memory dump

| # | Name | Company / Context | Warmth | Fit notes | Status |
|---|------|-------------------|--------|-----------|--------|
| 1 | Jiří Helmich | Founder, B2B Minds (ex-Mews CPO 2019-2023) | warm | Real KPIs, real decisions at Mews; B2B Minds thesis is on-thesis with Telarchy alignment-layer framing | **CALL BOOKED 2026-05-13 17:00** (invite to jirka@helmich.io). Owes: Lean Canvas + Value Prop Canvas before call. Jirka noted he tried something similar pre-AI in different scope. |
| 2 | (CEO) | Qminers — Czech quant/AI | lukewarm | Founder-mode CEO, smaller co; better founder-pricing fit than 1 | TODO confirm name |
| 3 | (Person at) | Second Foundation — Czech VC fund OR portfolio co (disambiguate) | lukewarm | Disambiguate: VC partner = portfolio decisions; portfolio co founder = product KPIs | TODO disambiguate + name |
| 4 | (Founder) | Rossum — doc AI, Czech-origin, $100M Series A | warm | Likely Tomáš Gogár / Petr Baudiš / Tomáš Tunys; large co, real KPIs, technical | TODO confirm which founder |
| 5 | Honza Široký | Czech VC investor (fund TBD — Presto / Reflex / Bohemia / other?) | unknown | Investor not founder — portfolio decisions not product KPIs; lower fit for headline use case but useful pressure-test | TODO confirm fund |

## Skip / awkward (not concierge candidates)

- **(CEO) SCS Software** — warm, but planning to invest in Viktor's other startup. Pitching Telarchy as a separate concierge target would create awkward signal of divided focus. Keep relationship clean for the investment conversation.

## Edge case (not concierge, but check status)

- **Brother — Wallpaper Animator** — there's already a `Wallpaper Animator / Weekly revenue` workspace LIVE on prod telarchy.com (per 04-19 eval findings). Either Viktor set it up for him as a placeholder, or his brother is already actively using it. If actively using, that's de facto user-zero — but family doesn't count as concierge validation. Worth confirming status.
  - **Action:** Check whether the Wallpaper Animator workspace has real metric updates, real trades, real activity — or if it's seed data. `curl https://telarchy.com/api/marketplace/workspaces/public` and inspect.

## LinkedIn Basic export analysis (2026-04-29)

**Stats:** 69 1st-degree connections, 57 with positions, 16 with founder/exec/VC signal. 9 active DM partners (most communication happens elsewhere — LinkedIn DMs are NOT Viktor's primary channel).

**Key finding:** the 5 manually-recalled candidates (Mews CPO, Qminers CEO, Second Foundation, Rossum founder, Honza Široký) are NONE of them in 1st-degree LinkedIn connections. Memory dump remains the higher-signal source; LinkedIn surfaces a separate (mostly lower-warmth) pool.

**Founder-signal candidates from LinkedIn (lukewarm — they invited Viktor, he accepted, but Viktor didn't recall them in memory dump). Status: pending Viktor's recognition pass.**

| # | Name | Company | Position | LinkedIn URL | Recognized? |
|---|------|---------|----------|--------------|-------------|
| L1 | Vilém Barnet | Stepps.ai | Co-Founder | https://www.linkedin.com/in/vilém-barnet-67184a380 | TBD |
| L2 | Marek Raja | ApexLoop | Co-founder & CEO | https://www.linkedin.com/in/marekraja | TBD |
| L3 | Jan Jirman | Voltavian | CEO | https://www.linkedin.com/in/jan-jirman | TBD |
| L4 | Šimon Falta | IQstat | CEO | https://www.linkedin.com/in/šimon-falta-84516a20a | TBD |
| L5 | Tobias Kocúr | OPSEC Lab | Founder | https://www.linkedin.com/in/tobias-kocúr-3b18b63b5 | TBD |
| L6 | Vladimír Tomko | BeCode s.r.o. | Founder & CTO | https://www.linkedin.com/in/tomkovladko | TBD |
| L7 | Adam Böhm | SikLab | Founder | https://www.linkedin.com/in/adam-böhm-3552173b7 | TBD |
| L8 | Tomas David Ye | Perseuss | Founder | https://www.linkedin.com/in/tomas-ye | TBD |
| L9 | Pavel Bureš | Edulity | Founder | https://www.linkedin.com/in/pavel-bureš-71992b311 | TBD |
| L10 | Junaid Shaikh | Crestlline | CTO | https://www.linkedin.com/in/crestllinejunaid | TBD |
| L11 | Denis Rishko | Sociaguru | Founder & CEO | https://www.linkedin.com/in/denis-sociaguru | TBD |
| L12 | David Slavík | StadiArt 3D | Co-Founder | https://www.linkedin.com/in/david-slavík-958968352 | Viktor invited 4/7/26 |
| L13 | Richard Mladek | Stealth | Founder | https://www.linkedin.com/in/richard-mladek | TBD (pre-launch likely) |
| L14 | Jaada Lawrence-Green | Events Content | Founder | https://www.linkedin.com/in/jaada-lawrence-green | TBD |

**Skip from LinkedIn (already in skip pile):**
- Pavel Sebor (SCS Software, Owner/CEO) — only message-partner overlap with founder signal, but already in conflict-of-interest skip pile.

**Cold from LinkedIn (no founder signal or weak fit):**
- Vojtěch Sýkora — AI Engineer & Product Owner at Miton (employee not founder). Skip.

**Decision (2026-04-29): SKIP entire LinkedIn batch.** Viktor confirmed he doesn't personally recognize any of L1-L14 — all are LinkedIn-handshake-only connections. Cold DM to forgotten LinkedIn-accept is low-conversion and weird. Don't burn social capital here.

**Complete LinkedIn export (~24h delivery)** will have additional fields (mutual connections, full job history) that may surface more signal on these same 69 connections. Re-run analysis when it arrives.

## Sources to add candidates from (in priority order)

- [x] **LinkedIn Basic export** (2026-04-29 — DONE, see above).
- [ ] **LinkedIn Complete export** (ETA ~24h from 2026-04-29).
- [ ] **Public discovery pass** (in progress — Czech/CEE founder ecosystem). Sources: Rockaway portfolio, Credo Ventures portfolio, Presto Ventures portfolio, Kaya VC portfolio, J&T Ventures, Reflex Capital, EnterpriseSaaS Czech founders, YC Czech alumni, Indie Hackers top makers, Product Hunt top hunters.
- [ ] **Twitter following** (manual paste of handles you follow that match founder profile).
- [ ] **Past Slack/Discord communities** (Czech founder Slacks, YC Slack if member, Bookface).
- [ ] **Conference attendees** (Web Summit, Slush, SaaStock, Czech tech meetups in last 24 months).
- [ ] **People who DM'd you for advice in last 12 months** (Twitter, LinkedIn, email).
- [ ] **Friends from previous full-time jobs who later went founder.**
- [ ] **Founders you've invested in personally** (if any angel investments).

## Scoring criteria (each /3, total /15 + bonuses)

- **Real company:** has revenue, not pre-product, not solo no-employees.
- **Real KPIs:** tracks ≥2 metrics weekly.
- **Upcoming real decision (~30 days):** spending/hiring/product bet, ≥$10K stakes or ≥10% of one quarter's effort.
- **Warmth:** how reachable. 0=cold, 3=texted last week.
- **Forecasting fit:** domain where AI/human forecasters could plausibly add signal.

Bonus +1 each: technical, has co-founder, public-facing.

Anti-flags: would ghost, regulated industry, M&A in flight, conflict-of-interest.

## Strategy (revised 2026-04-29 after LinkedIn analysis)

**The 5 warm manually-recalled names are the entire candidate pool.** Originally planned "20 names → 10 asks → 5 booked" assumed cold-outreach funnel. Viktor doesn't have one — his warm relationships aren't on LinkedIn. So don't pre-build cold lists.

**Try the warm path first:**
1. Confirm specific names/funds/roles for all 5 (Mews CPO actual name, which Rossum co-founder, which Second Foundation person, which fund Honza Široký is at).
2. Claude pulls recent public signal per founder (company news, X/blog/podcast).
3. Claude drafts 5 personalized DMs.
4. Viktor reviews, edits, sends — **all 5, this week**.
5. End of Week 0: count bookings.

**Backfill rule:** if <3 of 5 booked by end of Week 0, *then* run public discovery on Czech founder ecosystem and add cold candidates. Not before. Avoid pre-building lists you might not need.

## Confirmed candidate context (2026-04-29)

Connection channel for all 4 confirmed: **MFF UK course "From Code to Company"** (Czech startup class). Viktor was a student. Whether candidates were guest speakers or co-students is course-specific; opener "potkali jsme se na MFF ve From Code to Company" works for either dynamic.

| # | Name | Role | Hook | LinkedIn |
|---|------|------|------|----------|
| 1 | Jiří (Jirka) Helmich | Founder, B2B Minds (since Oct 2024) + Co-founder, Product Leaders Community (since Jul 2025). Ex-Mews CPO (Sep 2019 – Jul 2023, scaled co to 3500+ hotels). | B2B Minds thesis ("help orgs adopt best practices for faster/stabler growth in AI era") is on-thesis with Telarchy's alignment-layer framing — possible advisor/design partner/distribution, not just feedback giver. Mews is past-tense credibility hook. | https://cz.linkedin.com/in/jirihelmich |
| 2 | Petr Baudiš | Rossum co-founder, CTO, Chief AI Architect | Published in AlphaGo's Nature paper. Rossum's GenRewrite work accepted at ACM SIGMOD 2026. Deep ML credentials. | https://www.linkedin.com/in/petr-baudis-906a213/ |
| 3 | (TBD name) | Second Foundation | NOT a VC. Operational energy-trading co (~450 ppl, 30+ countries, EU spot-market market-making, BESS, grid balancing). They literally do conditional market making at industrial scale. Most on-thesis candidate of the pool. **NEED NAME from Viktor before drafting DM.** | second-foundation.eu |
| 4 | Honza Široký | United Founders CTO/Head of Product + Czech Founders VC IC member + LP. Former Mews CTO 2014-2022 ($100M ARR, 170 engineers). | Built UF's proprietary deal-flow platform. Investor + ex-operator + infra-builder in calibrated-decisions space. Highest-leverage candidate. Cofounder-potential flag: yes (ex-Mews-CTO, builds dealflow infra, plays in exact thesis space). | https://www.linkedin.com/in/honza-siroky/ |

**Cross-connection:** Honza Široký was Mews CTO 2014-2022 alongside Jirka Helmich (still CPO). They know each other. Pitch differentiation between DMs 1 and 4 needs to hold up if they compare notes.

## Drafted DMs (Czech, From Code to Company opener)

### DM 1: Jirka Helmich — SENT 2026-05-05

Vykání register (Viktor knows him as MFF lecturer, not peer). Mews referenced in past tense; B2B Minds is the active hook. As-sent version below — softer call ask than the reviewed draft (no exit clause, no "5 founderů v produkci" credibility signal). If reply rate across DMs 1/2/4 is low, that's a candidate variable to A/B on the next batch.

```
Dobrý den Jirko,

jmenuji se Viktor Číhal, chodím k Vám na předmět From Code to Company. Vytvářím momentálně MVP startupu: firma definuje klíčové metriky a účastníci, lidé i AI, přes predikční trhy odhadnou, jak každá navržená akce výsledky pohne, ještě než se rozhodne. Stránka: telarchy.com .

Chtěl bych se zeptat, jestli byste byl ochotný mi dát nějaký feedback. Vaše perspektiva by mě zajímala ze dvou stran, které se prolínají: jak takové rozhodování fungovalo při škálování Mews, a jak se to potkává s tím, co teď řešíte v B2B Minds, tedy jak firmy přijímají rozumné praktiky v AI éře.

Měl byste 20-30 minut na hovor?

Pro upřesnění, není to projekt v rámci předmětu, v týmu dělám na startupu Kasa Cink, Telarchy stavím vedle.

Děkuju moc za zvážení.
```

### DM 2: Petr Baudiš (codex round 2)

```
Ahoj Petře, tady Viktor z From Code to Company na MFF. Posledních pár měsíců stavím Telarchy, appku, kde si firma nastaví metriky a účastníci, lidi i AI, přes prediktivní trhy odhadují, jak každá navržená akce pohne výsledky. V sázce jsou reálné kredity, ne jen anketa. Teď to zkouším s 5 foundery. Rád bych, abys to z výzkumné a ML strany zkusil rozbít. Dáš 30 min hovor? Když to bude mimo, rychle to ukončíme.
```

### DM 3: (TBD) at Second Foundation

⚠️ **Pending name from Viktor.** Hook angle: they do conditional market making in spot energy at industrial scale; Telarchy generalizes that mechanism beyond energy.

### DM 4: Honza Široký (codex round 2)

```
Ahoj Honzo, tady Viktor z From Code to Company na MFF. Viděl jsem spuštění United Founders s €80M, gratuluju. Posledních pár měsíců stavím Telarchy, appku, kde prediktivní trhy s lidmi i AI odhadují dopad navržených akcí na metriky před rozhodnutím. Teď to zkouším s 5 foundery v produkci. Zajímá mě hlavně tvůj pohled z Mews a z vlastní deal-flow platformy ve VC. Dáš 30 min hovor? Když to nebude užitečné, po 10 minutách to zavřeme.
```

## Next steps (current)

1. **Viktor (now):** Review the 4 drafted DMs above. Mark each: SEND AS-IS / EDIT (paste edits) / SKIP.
2. **Viktor (now):** Provide name for Second Foundation contact so DM 3 can be drafted.
3. **Viktor (now):** Confirm Wallpaper Animator workspace status (real use vs placeholder). Still pending from earlier turn.
4. **Viktor:** Send all approved DMs this week (LinkedIn or email — whichever channel is warmest per candidate).
5. **Friday:** Count bookings. If ≥3, proceed to Week 1 concierge prep. If <3, public discovery backfill on Czech founder ecosystem.
