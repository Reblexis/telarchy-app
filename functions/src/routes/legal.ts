import { Router } from 'express';
import { privacyContact } from '../lib/origin';

export const legalRouter = Router();

// Keep the canonical source in `docs/legal/*.md`. These constants mirror those
// files; update both when revising legal text. Inlined here so the runtime
// image does not need `docs/` copied in.

const CONSENT_VERSION = '1.7';

const TERMS_OF_SERVICE = `# Terms of Service

_Last updated: 2026-08-28 (version ${CONSENT_VERSION})_

These Terms govern your use of \`telarchy.com\` (the "Service"), operated by the Telarchy team ("we", "us"). By creating an account or using the Service you agree to them; if you do not agree, do not use the Service.

## 1. Eligibility and accounts

You must be at least 18 years old. You are responsible for your login credentials and for all activity under your account. We may suspend or terminate accounts that violate these Terms or put the Service or its users at risk.

## 2. Credits

Credits on the Service are play-money. They have no cash value, cannot be purchased, and cannot be exchanged for money, goods, or services; no deposits into or withdrawals out of credits exist. A workspace manager may buy market liquidity for their workspace: a non-refundable service that places credits into that workspace's market pools only, never into any account balance, purchased to sharpen prices on their own markets. Buying liquidity is not buying credits, confers no contest entry, standing, or score, and accounts that manage a workspace take no prize in seasons whose rules say so (section 3a). Markets on the Service are a forecasting game played with these credits; they are not securities, derivatives, or gambling products, and prices on them are not financial advice.

## 3. Paid job proposals

A participant may propose a job with a price in US dollars. Approving such a proposal is a commitment by the workspace owner (not by us) to pay the proposer that price, settled directly between them outside the Service using the payment details the proposer stored in their account. We are not a party to that payment: we hold, transmit, escrow, and process no funds, charge no fee on the payment, and are not a money transmitter, payment processor, or employer of record. The proposer is responsible for delivering the work and for taxes on amounts received; the owner is responsible for compliance with laws on commissioning and paying for services; disputes over payment or delivery are between them. Credits staked, traded, or rewarded around the jobs board remain play-money under section 2.

A proposal must be lawful. Do not propose a job, action, or contract that is illegal, or whose performance would violate the terms, rules, or policies of any third-party platform or service it involves (for example, selling or transferring another platform's virtual currency against that platform's rules). We and the workspace owner may decline or remove such a proposal at any time, and repeat submissions are grounds for suspension under section 1.

Approving or declining a proposal is the workspace owner's decision alone, made at their sole discretion. Market prices on the Service are forecasts, not votes: however a market prices a proposal's expected impact, that price creates no obligation on the owner or on us to approve it, and no participant acquires a right to approval, payment, or any other outcome by trading on a proposal's markets.

## 3a. Prize contests

We may run contests (each a "season") in which cash prizes are awarded for performance on the Service's forecasting markets. Seasons are optional and are entered only by explicit opt-in.

Entry is free. There is no entry fee, no purchase, and no stake: you do not pay anything, and you do not risk anything you own, to enter or to compete. Credits are not exchanged for a prize and are never redeemed; section 2 continues to apply to them in full. A prize is awarded for your performance under a scoring rule published in advance (a place on a ladder, or a share of the pool in proportion to your score), not in exchange for credits and never as a function of your credit balance, so a season is a skill contest rather than a wager or a lottery. No element of chance decides who is paid or how much.

Before a season starts we publish its rules: the dates, the total prize pool, how the pool is divided (the prize for each place, or the formula for each entrant's share), the scoring rule, who is eligible, how ties are broken, and how and when winners are paid. Those rules do not change while the season runs, unless the season's own published rules state that they may change (an experimental season says so explicitly); any mid-season change is announced publicly before it takes effect. You must be at least 18 years old to enter. Participants operated by us or run as part of the platform are not eligible. We may disqualify entries that we determine, acting reasonably, are operated by one person as several accounts, or that collude to distort prices, and we may cancel or void a season, in which case no prize is owed.

We run seasons as the contest operator and pay prizes ourselves, from our own funds, outside the Service, using the payment details the winner stored in their account. We hold, transmit, escrow and process no third-party funds in doing so: a prize is our own money paid as a contest prize, not a payment we process for anyone else, and we are not a money transmitter or payment processor. Winners are responsible for taxes on amounts received; where the law applicable to us requires withholding on a prize, we withhold the required amount and the season's rules say so.

## 4. Acceptable use

Do not use the Service to break the law; do not submit unlawful, harassing, defamatory, or infringing content; do not probe or compromise the Service's security, circumvent rate limits, or interfere with other participants; do not collude to distort prices or defraud other participants; do not impersonate anyone; scrape only through the public API within its documented rate limits.

## 5. Your content

You own the proposals, descriptions, and other content you submit, and grant us the license needed to store, process, and display it in order to operate the Service. Content on public floors (proposals, prices, decisions and their published reasons) is publicly visible by design.

## 6. Disclaimers and liability

THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. To the maximum extent permitted by law, we are not liable for indirect, incidental, consequential, special, or punitive damages, or lost profits, revenue, data, or goodwill, and our total aggregate liability for any claim shall not exceed one hundred US dollars (USD 100). You will indemnify us against claims arising from your content, your use of the Service, or your violation of these Terms.

## 7. Termination

You may delete your account at any time in the app. We may suspend or end your access for violations, legal requirements, or discontinuation of the Service.

## 8. Changes

We may update these Terms; material changes are announced in-app or by email, and continued use after an update is acceptance.

## 9. Governing law

These Terms are governed by the laws of the State of Delaware, USA; disputes belong exclusively to the state or federal courts located in Delaware.

## 10. Contact

\`${privacyContact()}\`
`;

const PRIVACY_POLICY = `# Privacy Policy

_Last updated: 2026-08-17 (version ${CONSENT_VERSION})_

What \`telarchy.com\` (the "Service") collects about you, why, and your rights.

## 1. What we collect

- **Account**: email, optional display name, nickname, and picture, and a password hash; if you sign in with Google or GitHub, the profile fields that provider returns.
- **Consent record**: the version and timestamp of the Terms and this Policy you accepted.
- **Activity**: the trades, positions, proposals, and messages you create on the Service. On public floors, proposals, prices, and decisions are publicly visible by design.
- **Payment details for paid jobs**: only if you choose to store them (for example a PayPal or Wise email, an IBAN and holder name, a crypto address, or a Revolut handle). They exist solely so a workspace owner can pay you for an approved job, and are visible only to you, to managers of a workspace where you propose a paid job, and as a snapshot on paid jobs you list. Never public.
- **Contact requests**: an email you leave on a public floor asking to be set up, used only to contact you about that.
- **Manifold link**: if you choose to import a Manifold record, we fetch that account's public profile (username, bio, balances) from Manifold's public API to verify ownership and set starting credits, and store the link and granted amount.
- **Request logs**: IP address, user agent, and request metadata, kept for security and debugging for a rolling window (typically 30 days).

We use no third-party analytics, tracking cookies, or advertising.

## 2. Why we process it

To run the Service you asked for (contract), to keep it secure and prevent abuse (legitimate interest), and per the consent you gave at signup. That is the whole list; we do not sell personal data.

## 3. Who processes it for us

- **Google Cloud Platform** (hosting and database), on our behalf.
- **Resend** (transactional email), which processes recipient addresses when the Service sends operational email such as owner notifications.
- **Google or GitHub**, only if you sign in through them.

We may disclose information where the law requires it or to protect users and the Service.

## 4. Retention and deletion

Your data is kept while your account exists. Deleting your account (in the app, or \`DELETE /api/auth/me\`) removes your login, nickname, bio, and stored payment details; trading history stays under an anonymized participant id for market integrity, and payment details already snapshotted onto a paid job you listed remain as that transaction's payment record.

## 5. Your rights

Export your data (\`GET /api/auth/me/export\`), delete your account, correct anything in-app, and object or complain to your data protection authority. For anything without an in-app control: \`${privacyContact()}\`.

## 6. Security and transfers

TLS in transit, encryption at rest, hashed credentials, strict access control. Data is hosted on Google Cloud and may be processed where that infrastructure operates.

## 7. Children

The Service is 18+; we do not knowingly collect children's data.

## 8. Changes

Material changes are announced in-app or by email; continued use after an update is acceptance.

## 9. Contact

\`${privacyContact()}\`
`;

export const CURRENT_CONSENT_VERSION = CONSENT_VERSION;

const SEASON_0_RULES = `# Season 0: official rules

_Published 2026-08-17, renamed to Season 0 on 2026-08-19 and amended that day
and on 2026-08-21, before the season started. Season 0 is experimental: we may
adjust these rules while it runs. Every change is announced on the season page
before it takes effect, and changes are applied so as to minimize harm to
entrants and standings._

_Amended 2026-08-22, mid-season: a prize no longer requires a score above
zero; place alone decides the prize. The change only increases what is paid,
never reduces anyone's standing or prize, and is announced on the season
page._

_Amended 2026-08-25, mid-season: accounts that own or administer a workspace
are explicitly eligible. The rule never excluded them, but it did not say so;
this change widens who may enter and reduces nobody's standing or prize. It is
announced on the season page._

_Amended 2026-08-28, mid-season: the ranking now pays for being right, not
for holding marks. Effective immediately, the season score is SETTLED
profit: what markets that actually resolved during the season paid you,
minus what you paid on them. Open positions are still marked on the boards,
but a mark scores nothing until its market resolves. Trades placed in a
market's final 6 hours no longer count toward the season score. Announced on
the season page; the Scoring section below has the details._

_Amended 2026-09-01, mid-season (second amendment that day): **profit taken
out of a market you funded is not score, up to what you put into that
market's pool.** This does not change who may enter or win; it makes the
Terms' existing sentence effective, which has always said that buying
liquidity confers no score. It changed no entrant's score or prize: when it
took effect, nobody had traded a market they had funded that resolved inside
the season. It reduces a score only where someone profited from a book they
paid for themselves._

_Amended 2026-09-01, mid-season: **every trade counts, and the 6-hour cutoff
is removed.** A market now resolves the moment a reading dated inside its
period is filed, so there is no interval in which an already-visible answer
can be traded against, which is the only thing the cutoff protected. It also
cost something: "does not count" ignored late SELLING as well as late buying,
so a position sold before resolution was still scored as if held. Your score
is now what your trades actually did, all of them. This can REDUCE the score
of an entrant who sold out inside a cutoff and kept the win, which is why it
is called out here rather than folded in quietly. It moved three scores when
it took effect, by at most 12.90 credits and about $10 of prize._

_Amended 2026-08-28, mid-season (second amendment that day): prizes are no
longer fixed amounts by place. The $1,000 pool is split among entrants in
proportion to positive settled season score, so every entrant in the green
is paid their share rather than only the top five. Shares below $50 are not
paid and roll into the next season's pool; no single prize exceeds $2,000.
Prizes are now paid by Telarchy directly, from its own funds, rather than by
the workspace owner. Effective on announcement on the season page; the
Prizes and Getting paid sections below have the details._

_Amended 2026-08-28, mid-season (third amendment that day): the minimum
paid share drops from $50 to $1, and the $2,000 single-prize cap is
removed. Where the law requires withholding on a prize (Czech law does,
above CZK 50,000), we withhold the required amount and pay the rest. Both
changes only increase what can be paid; nobody's share shrinks._

**Season 0 is the first one, and the platform is still being launched.** Expect
rough edges, apologies in advance. If something looks wrong, tell us through
the feedback channel in the app; where a bug affects standings we say so
publicly and publish the correction.

## The deal

Trade on the public Telarchy floor; entrants are paid real money in
proportion to the settled trading profit they earn while the season runs
(amended 2026-08-28; originally a five-place prize ladder). The season runs from
its published start instant to its published end instant, both UTC, shown on
the season page. Entries close when the season ends; settlement and prizes
follow.

## Free means free

You pay nothing to enter and risk nothing you own. Credits are play money:
they cannot be bought, have no cash value, and are never exchanged for a prize
or redeemed. A prize is for where you place under the scoring rule, not for
credits, and your credit balance is unaffected by winning or losing.

## Prizes

Total pool: **$1,000 USD**.

\`\`\`
your prize = pool x your positive settled season score
                  / the sum of all entrants' positive settled season scores
\`\`\`

(Amended 2026-08-28, replacing the original fixed ladder of $500 / $250 /
$125 / $75 / $50 by place.) The pool is split in proportion to settled
season score: earn twice the settled profit of another entrant, be paid
twice their prize. A zero or negative score is paid nothing and does not
shrink anyone else's share. Three boundary rules:

- A computed share below **$1** is not paid and rolls into the next
  season's pool (a prize smaller than the cost of sending it helps nobody;
  lowered from $50 by the third 2026-08-28 amendment).
- There is no upper cap on a single prize. A prize large enough to trigger
  a legal withholding duty (Czech law: 15% above CZK 50,000) is paid net
  of the required withholding.
- Anything otherwise unassigned, including the whole pool if no entrant has
  a positive score, rolls into the next season's pool.

## Scoring

\`\`\`
season score = what the season's resolved markets paid you - what you paid on them
\`\`\`

(Amended and in force 2026-08-28; before that day the previous
marked-to-market rule applied.)

Your score counts only markets that RESOLVED, or were cancelled and
refunded, inside the season window: resolution payouts on your shares, plus
refunds from cancelled markets, minus the net cash you paid on those
markets. A position still open when the season ends counts nothing, however
high the board marks it: a prediction is paid when reality arrives, not
before. Resolutions at the season's end instant count; anything resolving
later does not.

- **Credits the platform granted you never enter the score**, as before.
- **Every trade counts, whenever you made it.** There is no cutoff. A market
  stays open and tradeable right up until it resolves, and it resolves the
  moment a reading dated inside its period is filed - so there is never a
  window in which the answer is visible and the book is still open, and
  nothing can be farmed off a reading you can already read. Your scored
  position in a market is what you actually held when it resolved: sell out
  beforehand and the sale counts too, so it cancels what the purchase would
  have earned.
- **Entering late changes nothing**: the score counts what resolved inside
  the window, whenever you opted in.
- **The boards keep showing your open positions at their marked value.** The
  mark is information for the owner and other traders; the score is what
  settled. The all-time leaderboard is unchanged and still ranks total
  profit including open marks; only the season ranking pays out.
- The score runs over every public workspace on the platform, including
  workspaces that become public while the season runs, as before.

Worth knowing before you trade: buying moves the price, so a large buy shows
a gain on the boards the moment it lands. That marked gain is display, not
score: nothing enters your season score until a market you traded actually
resolves.

Only entrants who explicitly opted in are ranked or paid. Equal scores are
paid equal shares, so a tie needs no breaking for money; the displayed rank
order breaks ties by earlier entry, then by participant id, both automatic
and identical on any recount.

## Entering

- 18 or older, with a Telarchy account, explicitly opted in. Entry opens when
  the season is announced, before it starts.
- Entering means agreeing to these rules, and we record when you agreed. Entry
  asks for a contact email, used to tell you if you win. No payment details
  are needed; winners are asked at claim time. Leaving is one click.
- Participants operated by us or run as part of the platform are **not
  eligible**.
- Accounts that own or administer a workspace **are eligible**, and their
  trades in that workspace count like any other; the score already runs over
  every public workspace. Being a workspace owner is not being the platform.
- We may disqualify entries that we determine, acting reasonably, are one
  person running several accounts, or collude to distort prices.

## Getting paid

Winners have **30 days** after settlement to claim, by adding payment
details to their account and pressing claim; Telarchy then pays them
directly, from its own funds, outside the Service, using those details
(amended 2026-08-28; previously the workspace owner paid). Telarchy holds,
transmits, escrows and processes no third-party funds: a prize is our own
money paid as a contest prize. An unclaimed prize rolls into the next
season's pool. Winners are responsible for taxes on amounts received; where
Czech law requires withholding on a prize (above CZK 50,000), we withhold
the required amount and pay the rest.

## The operator's side

We do not void markets during a running season, except to correct a declared
error, and we announce it if we do. We may end or void a season; if we do, we
say so on the season page, and no prize is owed. Disputes: write to us through
the feedback channel in the app; we answer, and we publish any correction to
standings rather than making it silently.
`;

legalRouter.get('/', (_req, res) => {
  res.json({
    version: CONSENT_VERSION,
    documents: [
      { id: 'terms', title: 'Terms of Service', path: '/api/legal/terms' },
      { id: 'privacy', title: 'Privacy Policy', path: '/api/legal/privacy' },
      { id: 'season-0', title: 'Season 0: official rules', path: '/api/legal/season-0' },
    ],
  });
});

legalRouter.get('/terms', (_req, res) => {
  res.type('text/markdown').send(TERMS_OF_SERVICE);
});

legalRouter.get('/privacy', (_req, res) => {
  res.type('text/markdown').send(PRIVACY_POLICY);
});

// A season's rules are the legally load-bearing artifact: they are what makes
// the contest a published skill contest rather than an ad-hoc payout. Served
// the same way as the other legal texts, and mirrored from
// docs/legal/season-0-rules.md so the runtime image does not need docs/.
legalRouter.get('/season-0', (_req, res) => {
  res.type('text/markdown').send(SEASON_0_RULES);
});

// The season was called Season 1 until 2026-08-19 and its rules were published
// at this path. Kept serving, permanently: a rules URL that has been quoted
// anywhere must not 404, least of all the one a contest points at.
legalRouter.get('/season-1', (_req, res) => {
  res.type('text/markdown').send(SEASON_0_RULES);
});
