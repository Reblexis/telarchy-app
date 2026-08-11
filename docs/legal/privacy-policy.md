# Privacy Policy

_Last updated: 2026-08-11 (version 1.1)_

This Privacy Policy explains what information the Telarchy managed instance at `telarchy.com` (the "Service") collects about you, how we use it, and your rights regarding it.

## 1. Information we collect

We collect only what is necessary to operate the Service:

- **Account data**: email address, optional display name (nickname), and a password hash (managed by BetterAuth). If you sign in with Google or GitHub, we receive the profile fields that provider returns (typically email, name, and user id).
- **Consent record**: the timestamp and version of Terms and Privacy Policy you agreed to at signup.
- **Workspace and trading data**: metrics, formulas, market prices, trades, positions, proposals, and messages you create or interact with inside your workspaces.
- **Request logs**: IP address, user-agent, and basic request metadata retained for security, rate limiting, and debugging.
- **Optional wallet address**: only collected if you choose to use USDC settlement on an instance where it is enabled. The managed instance runs with USDC settlement disabled by default, so no wallet address is collected there.
- **Payment details for paid jobs**: only if you choose to store them, we collect the payment method you enter (for example a PayPal or Wise email, an IBAN and account holder name, a crypto address, or a Revolut handle). They exist solely so a workspace owner can pay you for an approved job. They are never public: they are visible only to you, to managers of a workspace where you propose a paid job, and as a snapshot on paid jobs you list.
- **Contact requests**: if you leave your email on a public floor asking to be set up, we store that email and use it only to contact you about it.
- **Manifold import**: if you choose to link a Manifold account, we fetch that account's public profile (username, bio, balances) from Manifold's public API to verify ownership and set your starting credits, and we store the link and the granted amount.

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
- **Resend** (transactional email delivery), which processes recipient email addresses on our behalf when the Service sends operational email (for example notifying a workspace owner of a new proposal or signup request).

We may also disclose information where required by law or to protect our rights and the safety of users.

## 5. Retention

Account data is retained while your account is active. When you delete your account via `DELETE /api/auth/me`, we detach your login credentials and profile from the underlying participant record so you can no longer sign in; market trading history remains associated with an anonymized participant identifier for platform integrity. Stored payment details, your bio, and your nickname are deleted with the account; payment details already snapshotted onto a paid job you listed are retained as the payment record of that transaction. Request logs are retained for a rolling window (typically 30 days) for security and debugging purposes.

## 6. Your rights

You have the right to:

- **Access** your data (`GET /api/auth/me/export`).
- **Delete** your account (`DELETE /api/auth/me` from the in-app account page).
- **Rectify** inaccurate information by editing it in-app or contacting us.
- **Object** to or restrict certain processing, and to lodge a complaint with your local data protection authority.

To exercise any right not covered by an in-app control, contact us at `viktor.cihal@gmail.com`.

## 7. Security

We use industry-standard safeguards, including TLS in transit, encryption at rest provided by our managed infrastructure, hashed password and API key storage, and strict internal access controls. No system is perfectly secure; if you believe your account has been compromised, contact us immediately.

## 8. International transfers

Data is hosted on Google Cloud infrastructure and may be processed in regions where that infrastructure operates. By using the Service you acknowledge these transfers.

## 9. Children

The Service is not intended for anyone under 18. We do not knowingly collect personal data from children. If you believe a child has provided us information, contact us and we will delete it.

## 10. Changes to this Policy

We may update this Policy from time to time. Material changes will be announced in-app or via email. Continued use of the Service after an update constitutes acceptance of the updated Policy.

## 11. Contact

Privacy questions and requests can be sent to `viktor.cihal@gmail.com`.
