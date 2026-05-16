# Pre-read pro Jana Černého

**Status:** draft v1. Před odesláním projít s Jirkou Helmichem (souhlasil s kontrolou).
**Komu:** Jan Černý, Managing Partner, Pale Fire Capital. Intro přes Jirku Helmicha.
**Cíl:** efektivní zpětnovazební hovor (~30 min). Jan si pre-read přečte async, sezení pak řeší jenom to, kde je jeho úhel pohledu nejhodnotnější.
**Tone:** vykání. Stručné, konkrétní, žádný marketing.

---

> **Pozn. Viktor pro Jirku (smazat před odesláním Janovi):** Jirko, díky za propoj. Tohle je první nástřel pre-readu, prosím o feedback. Cílím na 2 stránky, struktura na konkrétní otázky aby session měla maximum signálu. Cokoliv změníš nebo škrtneš berem.

---

# Telarchy — feedback pre-read

Připravil: Viktor Číhal · viktor.cihal@gmail.com · 16. 5. 2026

## TL;DR

Telarchy je alignment layer pro AI a lidi. Firma (nebo jednotlivec) si nastaví metriky, které chce hýbat; účastníci, lidé i AI, přes prediktivní trhy odhadnou, jak každá navržená akce ty metriky pohne, **ještě než se rozhodne**. Vlastník schvaluje na základě kalibrovaného odhadu, ne pocitu z meetingu.

- **Stav:** MVP běží na `telarchy.com`, struktura kompletní (LMSR trhy, podmíněné trhy, API, AI účastníci, audit). Před uživateli.
- **Fáze:** čtyřtýdenní concierge program (29. 4. – 27. 5.), ručně onboarduju malou skupinu zakladatelů a tlačím přes ně reálná rozhodnutí. Verdikt 27. 5. binární: buď founder governance jako headline, nebo pivot na AI-agent-eval.
- **Co od Vás potřebuju:** 30 minut ostrého feedbacku na tři konkrétní otázky níže. Ne investiční rozhovor, ne demo. Spíš: kde to z Vašeho úhlu cinká falešně.

## Co Telarchy dělá (90 sekund čtení)

Mezi "máme cíl" (OKR) a "máme retro" (co se trefilo) dnes není nic kromě intuice a hierarchie. Telarchy tu mezeru zaplňuje **predikční vrstvou**:

1. Vlastník workspace nadefinuje 2-5 metrik, které opravdu chce hýbat (KPI strom).
2. Účastníci — lidé i AI agenti registrovaní přes API — navrhují akce.
3. Každý návrh otevře podmíněný prediktivní trh: "pokud schválíš a provedeš X, kde bude metrika Y za N týdnů?"
4. Účastníci obchodují s kredity (skin in the game). LMSR cena se ustaluje na kalibrovaném odhadu.
5. Vlastník vidí: očekávaný dopad, jistotu, kdo drží jakou pozici, jejich historickou přesnost. Schválí nebo zamítne.
6. Po horizontu se trh resolvuje proti reálnému číslu. Špatní forecasteři ztrácejí kredit, dobří jej akumulují.

**Klíčový rozdíl od typických "AI governance" nástrojů:** ty se ptají *"je tohle zakázané?"*. Telarchy se ptá *"je tohle to, co vlastník maximalizuje?"*. Defenzivní compliance vs. ofenzivní alignment.

## Proč teď

Dvě věci se sešly:

1. **Inteligence je nejlevnější v historii.** Prediktivní trhy historicky padly na nedostatku forecasterů. AI agenti za marginální cenu řeší cold start — každý workspace má hned likviditu.
2. **AI jako privacy primitiv.** Pre-AI interní prediktivní trhy padly na soukromí: nikdo nedá citlivé KPI před zaměstnance. AI účastník běží uvnitř workspace, vidí KPI a po session kontext zapomene. To otevírá rozhodování, na které dřív nebyl reálný forum.

## Stav a trakce

- **Produkt:** struktura kompletní. LMSR markets, podmíněné trhy, time preference, multi-workspace, BetterAuth, public API, `/marketplace`, `/leaderboard`, audit trail. Self-hosting komponenty hotové, ale image není zveřejněný.
- **Uživatelé:** zatím nula reálných. Concierge program ručně cílí malou skupinu (jednotky lidí, ne desítky).
- **Falsifikační kritéria (zamčená 7. 5., binární k 27. 5.):**
  - **Confirmed** (founder governance jako headline): minimálně 2 z cohorty přivedou druhé reálné rozhodnutí bez vyzvání, NEBO minimálně 1 udělá unprompted referral.
  - **Falsified** (pivot na AI-agent-eval): 0 unprompted second decisions, 0 referrals, většina cohorty studená po týdnu 2.
  - **Inconclusive** = default pivot. Záměrně, aby nedocházelo k posouvání tyček.
- **Hovořil jsem zatím s Jirkou Helmichem** (B2B Minds), který intro zařídil. Hlavní jeho výhrada: dvě věci ke kterým chci konkrétně Váš úhel — viz níže.

## Konkrétně, co mi řekněte

Tohle jsou tři otázky, na kterých Vaše perspektiva pravděpodobně přinese nejvíc.

### 1. Pozicionování: drží to nebo je to nucené?

"Alignment layer pro AI a lidi" je hlavní rámec. Jirka to vzal. Tester z agent-builder persona také. Ale obojí jsou lidi blízko produktu. Vy do toho jdete čerstvě.

- Sedne to v 5 sekundách, nebo to musíte přečíst dvakrát?
- Je tam viditelný směr, kam to roste, nebo to čte jako vágně-vše-pro-všechny?
- Není v tom past, kterou nevidím?

### 2. Wedge: founder governance, nebo AI-agent-eval?

Jsem v napětí mezi dvěma možnými headlines:

- **A) Founder governance** (současný headline): zakladatel si oceňuje rozhodnutí proti vlastním KPI než commitne. Testovaná hypotéza concierge programem do 27. 5.
- **B) AI-agent-eval**: portable evaluation surface pro AI agenty. `/leaderboard` ranks participants by Brier a earnings na resolvovaných trzích veřejných workspaců. Reputace agentů = network effect, který nelze klonovat z kódu.

Ze své pozice (PE, dlouhodobé hodnoty, R&D heavy companies) — který wedge vidíte jako defendabilnější dlouhodobě? Jaký signál bych měl hledat, který rozdíl rozhodne dřív než 27. 5.?

### 3. GTM: z 5 zakladatelů v Praze na globální produkt

Vaše veřejné motto — "běžte do světa" — je relevantní. Concierge cohorta je dnes česká/evropská. Produkt je technicky bez geografie (API, hosted SaaS, jazyk angličtina jako default).

- Která reálná překážka brzdí přechod z Prahy do US/EU founder ekosystému: distribuce, positioning, jazyk produktu, něco jiného?
- Je smysluplné z Pale Fire portfolia s něčím porovnat (Roivenue mě napadá kvůli "analytics-meets-decision" náladě, ale možná je to mimo) — kde vidíte analogii nebo varování?

## Co bych Vás prosil nedělat (z respektu k Vašemu času)

- Žádný feedback na UX / barvy / wording landing page. To řeším samostatně.
- Žádný feedback na finanční model / valuaci. Nejsem v investorské fázi a chci, aby Vaše hodina nešla na něco, co nepotřebuju.
- Žádné "obecně co si myslíš" — ty tři otázky výše jsou ostré schválně, ať session nese signál.

## Materiály (jen pokud Vás něco z výše uvedeného zaujme natolik, že chcete jít hloub)

- `telarchy.com` — produkt, můžete si projít veřejné workspace
- `telarchy.com/leaderboard` — cross-workspace ranking účastníků
- `telarchy.com/api/help` — API katalog (pro představu, jak otevřená integrace pro AI participanty je)
- Lean Canvas + Value Prop Canvas (4 varianty rozdělené podle uživatele × fáze) — pošlu v příloze, stejné, které jsem posílal Jirkovi

## Logistika

- **Délka:** 30 minut, ideálně méně, pokud to z Vašeho úhlu jde rychle.
- **Forma:** Google Meet / Zoom / cokoliv preferujete.
- **Kdy:** podle Vás. Mám flexibilní kalendář příští 2 týdny.
- **Po hovoru:** napíšu 1-stránkový follow-up s tím, co jste řekl, jak to plánuji integrovat (nebo proč ne). Pokud si přejete neztrácet tím čas, nemusíte odpovídat — slouží mi to k vlastnímu auditu.

Děkuju předem za čas. Mám zájem hlavně o to, kde Vám to z Vaší pozice cinká falešně, ne o validaci.

Viktor
