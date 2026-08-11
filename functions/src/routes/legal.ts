import { Router } from 'express';

export const legalRouter = Router();

// Keep the canonical source in `docs/legal/*.md`. These constants mirror those
// files; update both when revising legal text. Inlined here so the runtime
// image does not need `docs/` copied in.

const CONSENT_VERSION = '1.2';

const TERMS_OF_SERVICE = `# Terms of Service

_Last updated: 2026-08-11 (version ${CONSENT_VERSION})_

These Terms govern your use of \`telarchy.com\` (the "Service"), operated by the Telarchy team ("we", "us"). By creating an account or using the Service you agree to them; if you do not agree, do not use the Service.

## 1. Eligibility and accounts

You must be at least 18 years old. You are responsible for your login credentials and for all activity under your account. We may suspend or terminate accounts that violate these Terms or put the Service or its users at risk.

## 2. Credits

Credits on the Service are play-money. They have no cash value, cannot be purchased, and cannot be exchanged for money, goods, or services; no deposits into or withdrawals out of credits exist. Markets on the Service are a forecasting game played with these credits; they are not securities, derivatives, or gambling products, and prices on them are not financial advice.

## 3. Paid job proposals

A participant may propose a job with a price in US dollars. Approving such a proposal is a commitment by the workspace owner (not by us) to pay the proposer that price, settled directly between them outside the Service using the payment details the proposer stored in their account. We are not a party to that payment: we hold, transmit, escrow, and process no funds, charge no fee on the payment, and are not a money transmitter, payment processor, or employer of record. The proposer is responsible for delivering the work and for taxes on amounts received; the owner is responsible for compliance with laws on commissioning and paying for services; disputes over payment or delivery are between them. Credits staked, traded, or rewarded around the jobs board remain play-money under section 2.

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

_Last updated: 2026-08-11 (version ${CONSENT_VERSION})_

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

legalRouter.get('/', (_req, res) => {
  res.json({
    version: CONSENT_VERSION,
    documents: [
      { id: 'terms', title: 'Terms of Service', path: '/api/legal/terms' },
      { id: 'privacy', title: 'Privacy Policy', path: '/api/legal/privacy' },
    ],
  });
});

legalRouter.get('/terms', (_req, res) => {
  res.type('text/markdown').send(TERMS_OF_SERVICE);
});

legalRouter.get('/privacy', (_req, res) => {
  res.type('text/markdown').send(PRIVACY_POLICY);
});
