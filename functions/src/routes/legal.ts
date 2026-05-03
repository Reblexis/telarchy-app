import { Router } from 'express';

export const legalRouter = Router();

// Keep the canonical source in `docs/legal/*.md`. These constants mirror those
// files; update both when revising legal text. Inlined here so the runtime
// image does not need `docs/` copied in.

const CONSENT_VERSION = '1.0';

const TERMS_OF_SERVICE = `# Terms of Service

_Last updated: 2026-04-11 (version ${CONSENT_VERSION})_

These Terms of Service ("Terms") govern your use of the Telarchy managed instance at \`telarchy.com\` (the "Service"), operated by the Telarchy team ("we", "us"). By creating an account or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.

## 1. Eligibility

You must be at least 18 years old to create an account and use the Service. By signing up you represent that you meet this requirement.

## 2. Accounts

You are responsible for maintaining the confidentiality of your login credentials and for all activity that occurs under your account. Notify us immediately if you suspect unauthorized access. We may suspend or terminate accounts that violate these Terms or that we reasonably believe pose a risk to the Service or other users.

## 3. Play-money credits; no redemption value

Credits on this managed instance are for simulation and educational use only. They have no redemption value, no cash value, and cannot be exchanged for money, goods, or services. No real-money deposits, withdrawals, or payouts are permitted through this instance. Prediction markets on this instance are a simulation game; they are not securities, derivatives, or gambling products.

## 4. Acceptable use

You agree not to:

- use the Service in violation of any applicable law or regulation;
- upload or transmit content that is unlawful, harassing, defamatory, or infringing;
- attempt to probe, scan, or compromise the security of the Service, circumvent rate limits, or interfere with other users' participation;
- use the Service to manipulate markets off-platform, collude to distort prices, or defraud other participants;
- scrape the Service except via the public API in accordance with our documentation and rate limits;
- impersonate another person or misrepresent your affiliation with any individual or entity.

## 5. User content

You retain ownership of the metrics, descriptions, proposal text, and other content you submit. You grant us a limited, worldwide, royalty-free license to store, process, and display that content solely as needed to operate the Service for you and your workspace members.

## 6. Disclaimers

THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. Market prices, consensus values, and forecasts are not investment advice, financial advice, or predictions of real-world outcomes, and we do not guarantee their accuracy. You should not rely on the Service for decisions with material real-world consequences without independent verification.

## 7. Limitation of liability

To the maximum extent permitted by law, we shall not be liable for any indirect, incidental, consequential, special, or punitive damages, or any loss of profits, revenue, data, or goodwill, arising out of or related to your use of the Service. Our total aggregate liability for any claim arising out of or related to these Terms or the Service shall not exceed one hundred US dollars (USD 100).

## 8. Indemnification

You agree to indemnify and hold us harmless from any claims, damages, losses, liabilities, and expenses (including reasonable legal fees) arising out of or related to your use of the Service, your content, or your violation of these Terms.

## 9. Termination

You may stop using the Service and delete your account at any time via the in-app account deletion flow. We may suspend or terminate your access if you violate these Terms, if we are required to do so by law, or if we discontinue the Service.

## 10. Changes to these Terms

We may update these Terms from time to time. Material changes will be announced in-app or via the email associated with your account. Continued use of the Service after an update constitutes acceptance of the updated Terms.

## 11. Governing law and disputes

These Terms are governed by the laws of the State of Delaware, USA, without regard to conflict of laws principles. Any dispute arising out of or related to these Terms or the Service shall be resolved in the state or federal courts located in Delaware, and you consent to their exclusive jurisdiction.

## 12. Contact

Questions about these Terms can be sent to \`viktor.cihal@gmail.com\`.
`;

const PRIVACY_POLICY = `# Privacy Policy

_Last updated: 2026-04-11 (version ${CONSENT_VERSION})_

This Privacy Policy explains what information the Telarchy managed instance at \`telarchy.com\` (the "Service") collects about you, how we use it, and your rights regarding it.

## 1. Information we collect

We collect only what is necessary to operate the Service:

- **Account data**: email address, optional display name (nickname), and a password hash (managed by BetterAuth). If you sign in with Google or GitHub, we receive the profile fields that provider returns (typically email, name, and user id).
- **Consent record**: the timestamp and version of Terms and Privacy Policy you agreed to at signup.
- **Workspace and trading data**: metrics, formulas, market prices, trades, positions, proposals, and messages you create or interact with inside your workspaces.
- **Request logs**: IP address, user-agent, and basic request metadata retained for security, rate limiting, and debugging.
- **Optional wallet address**: only collected if you choose to use USDC settlement on an instance where it is enabled. The managed instance runs with USDC settlement disabled by default, so no wallet address is collected there.

We do not use third-party analytics, tracking cookies, or advertising SDKs.

## 2. How we use your information

We process your information to:

- authenticate you and keep your account secure;
- operate the prediction market, metrics, and proposal features you and your workspace use;
- enforce acceptable use, rate limits, and platform integrity;
- respond to support requests and legal obligations.

## 3. Legal bases (EEA/UK users)

Where GDPR or equivalent applies, we process personal data on the following legal bases: consent (at signup), performance of a contract (to deliver the Service you requested), and legitimate interest (to secure the Service and prevent abuse).

## 4. Sharing and third parties

We do not sell personal data. We share data only with service providers strictly necessary to run the Service:

- **BetterAuth** (authentication library running inside our own backend).
- **Google Cloud Platform** (Cloud Run hosting and Cloud SQL for PostgreSQL), which processes data on our behalf.
- **Base RPC provider**, only for read/write operations against the Base blockchain when USDC settlement is enabled on the instance.
- **OAuth providers** (Google, GitHub) if you choose to sign in through them.

We may also disclose information where required by law or to protect our rights and the safety of users.

## 5. Retention

Account data is retained while your account is active. When you delete your account via \`DELETE /api/auth/me\`, we detach your login credentials and profile from the underlying participant record so you can no longer sign in; market trading history remains associated with an anonymized participant identifier for platform integrity. Request logs are retained for a rolling window (typically 30 days) for security and debugging purposes.

## 6. Your rights

You have the right to:

- **Access** your data (\`GET /api/auth/me/export\`).
- **Delete** your account (\`DELETE /api/auth/me\` from the in-app account page).
- **Rectify** inaccurate information by editing it in-app or contacting us.
- **Object** to or restrict certain processing, and to lodge a complaint with your local data protection authority.

To exercise any right not covered by an in-app control, contact us at \`viktor.cihal@gmail.com\`.

## 7. Security

We use industry-standard safeguards, including TLS in transit, encryption at rest provided by our managed infrastructure, hashed password and API key storage, and strict internal access controls. No system is perfectly secure; if you believe your account has been compromised, contact us immediately.

## 8. International transfers

Data is hosted on Google Cloud infrastructure and may be processed in regions where that infrastructure operates. By using the Service you acknowledge these transfers.

## 9. Children

The Service is not intended for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has provided us information, contact us and we will delete it.

## 10. Changes to this Policy

We may update this Policy from time to time. Material changes will be announced in-app or via email. Continued use of the Service after an update constitutes acceptance of the updated Policy.

## 11. Contact

Privacy questions and requests can be sent to \`viktor.cihal@gmail.com\`.
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
