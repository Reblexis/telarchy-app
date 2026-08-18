import { Router } from 'express';

export const legalRouter = Router();

// Keep the canonical source in `docs/legal/*.md`. These constants mirror those
// files; update both when revising legal text. Inlined here so the runtime
// image does not need `docs/` copied in.

const CONSENT_VERSION = '1.4';

const TERMS_OF_SERVICE = `# Terms of Service

_Last updated: 2026-08-18 (version ${CONSENT_VERSION})_

These Terms govern your use of \`telarchy.com\` (the "Service"), operated by the Telarchy team ("we", "us"). By creating an account or using the Service you agree to them; if you do not agree, do not use the Service.

## 1. Eligibility and accounts

You must be at least 18 years old. You are responsible for your login credentials and for all activity under your account. We may suspend or terminate accounts that violate these Terms or put the Service or its users at risk.

## 2. Credits

Credits on the Service are play-money. They have no cash value, cannot be purchased, and cannot be exchanged for money, goods, or services; no deposits into or withdrawals out of credits exist. Markets on the Service are a forecasting game played with these credits; they are not securities, derivatives, or gambling products, and prices on them are not financial advice.

## 3. Paid job proposals

A participant may propose a job with a price in US dollars. Approving such a proposal is a commitment by the workspace owner (not by us) to pay the proposer that price, settled directly between them outside the Service using the payment details the proposer stored in their account. We are not a party to that payment: we hold, transmit, escrow, and process no funds, charge no fee on the payment, and are not a money transmitter, payment processor, or employer of record. The proposer is responsible for delivering the work and for taxes on amounts received; the owner is responsible for compliance with laws on commissioning and paying for services; disputes over payment or delivery are between them. Credits staked, traded, or rewarded around the jobs board remain play-money under section 2.

A proposal must be lawful. Do not propose a job, action, or contract that is illegal, or whose performance would violate the terms, rules, or policies of any third-party platform or service it involves (for example, selling or transferring another platform's virtual currency against that platform's rules). We and the workspace owner may decline or remove such a proposal at any time, and repeat submissions are grounds for suspension under section 1.

Approving or declining a proposal is the workspace owner's decision alone, made at their sole discretion. Market prices on the Service are forecasts, not votes: however a market prices a proposal's expected impact, that price creates no obligation on the owner or on us to approve it, and no participant acquires a right to approval, payment, or any other outcome by trading on a proposal's markets.

## 3a. Prize contests

We may run contests (each a "season") in which cash prizes are awarded for performance on the Service's forecasting markets. Seasons are optional and are entered only by explicit opt-in.

Entry is free. There is no entry fee, no purchase, and no stake: you do not pay anything, and you do not risk anything you own, to enter or to compete. Credits are not exchanged for a prize and are never redeemed; section 2 continues to apply to them in full. A prize is awarded for where you place under a scoring rule published in advance, not in exchange for credits, so a season is a skill contest rather than a wager or a lottery.

Before a season starts we publish its rules: the dates, the total prize pool, the prize for each place, the scoring rule, who is eligible, how ties are broken, and how and when winners are paid. Those rules do not change while the season runs. You must be at least 18 years old to enter. Participants operated by us or run as part of the platform are not eligible. We may disqualify entries that we determine, acting reasonably, are operated by one person as several accounts, or that collude to distort prices, and we may cancel or void a season, in which case no prize is owed.

As with paid job proposals, we hold, transmit, escrow and process no funds. A prize is paid directly by the workspace owner to the winner, outside the Service, using the payment details the winner stored in their account. Winners are responsible for taxes on amounts received. We are not a party to that payment, are not a money transmitter or payment processor, and charge no fee on it.

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

\`viktor.cihal@gmail.com\`
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

Export your data (\`GET /api/auth/me/export\`), delete your account, correct anything in-app, and object or complain to your data protection authority. For anything without an in-app control: \`viktor.cihal@gmail.com\`.

## 6. Security and transfers

TLS in transit, encryption at rest, hashed credentials, strict access control. Data is hosted on Google Cloud and may be processed where that infrastructure operates.

## 7. Children

The Service is 18+; we do not knowingly collect children's data.

## 8. Changes

Material changes are announced in-app or by email; continued use after an update is acceptance.

## 9. Contact

\`viktor.cihal@gmail.com\`
`;

export const CURRENT_CONSENT_VERSION = CONSENT_VERSION;

const SEASON_1_RULES = `# Season 1: official rules

_Published 2026-08-17. These rules do not change while the season runs._

## What this is

Season 1 is a forecasting contest on the public Telarchy trading floor. Entrants
are ranked on how much their trading profit grows while the season runs, and the
top five are paid real money.

## No entry fee, no purchase, no stake

Entry is free. You do not pay anything to enter, and you do not risk anything you
own by competing. Credits on Telarchy are play money: they cannot be bought, they
have no cash value, and they are never exchanged for a prize or redeemed. A prize
is awarded for where you place under the scoring rule below, not in exchange for
credits. Your credit balance is unaffected by winning or losing a season.

## Dates

The season runs from its published start instant to its published end instant,
both in UTC, shown on the season's standings page. Entries close when the season
ends. Settlement happens after the end, and prizes are assigned then.

## The prize pool

Total pool: **$1,000 USD**, awarded as:

| Place | Prize |
|---|---|
| 1st | $500 |
| 2nd | $250 |
| 3rd | $125 |
| 4th | $75 |
| 5th | $50 |

Any rung nobody qualifies for, and anything otherwise unassigned, rolls into the
next season's pool.

## The scoring rule

Your **season score** is:

\`\`\`
season score = your trading profit now - your trading profit when the season started
\`\`\`

Trading profit is what your positions are worth at current market prices, plus
what any cancelled markets refunded you, minus the net cash you paid for those
positions. It is the same number shown on the public leaderboard, and it counts
open positions before anything resolves. Credits the platform granted you never
enter it.

Two consequences worth stating plainly:

- **Your baseline is taken when the season starts, not when you enter.** You can
  enter at any point while the season runs, and you will still be measured from
  where the season began. This is deliberate: otherwise entering late would let
  someone pick a favourable starting point.
- **An account that did not exist when the season started has a baseline of
  zero**, so everything it earns inside the window counts.

Only entrants who explicitly opted in are ranked or paid.

## Eligibility

- You must be at least 18 years old.
- You must have a Telarchy account and must explicitly opt in to enter.
- Participants operated by us or run as part of the platform are **not
  eligible** and do not enter.
- A prize requires a season score **strictly greater than zero**. A season score
  of exactly zero, or a loss, wins nothing regardless of where it places.

We may disqualify entries that we determine, acting reasonably, are operated by
one person as several accounts, or that collude to distort prices.

## Ties

Ties on season score are broken by earlier entry into the season, and then by
participant id. Both are applied automatically and produce the same result on any
recount.

## Voided markets

We commit to not voiding markets during a running season, except to correct a
declared error. If we do void a market during a season, we announce it.

## How winners are paid

Telarchy holds, transmits, escrows and processes no funds.

After settlement, winners have **30 days** to claim, by adding payment details to
their account and pressing claim on their account page. The workspace owner then
pays the winner directly, outside the Service, using those details. This is the
same arrangement Telarchy already uses for paid job proposals (Terms of Service
section 3).

A prize not claimed within 30 days rolls into the next season's pool.

Winners are responsible for any taxes on amounts received.

## Cancellation

We may end or void a season. If we do, we say so on the standings page, and no
prize is owed.

## Disputes

Write to us through the feedback channel in the app. We will answer, and we will
publish any correction to standings rather than making it silently.
`;

legalRouter.get('/', (_req, res) => {
  res.json({
    version: CONSENT_VERSION,
    documents: [
      { id: 'terms', title: 'Terms of Service', path: '/api/legal/terms' },
      { id: 'privacy', title: 'Privacy Policy', path: '/api/legal/privacy' },
      { id: 'season-1', title: 'Season 1: official rules', path: '/api/legal/season-1' },
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
// docs/legal/season-1-rules.md so the runtime image does not need docs/.
legalRouter.get('/season-1', (_req, res) => {
  res.type('text/markdown').send(SEASON_1_RULES);
});
