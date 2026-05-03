# Persona: Noor, the privacy-conscious EU user

Arrives from a privacy-oriented newsletter. Desktop. Will actually read the Terms and Privacy Policy before signing up.

## Context

- **Device**: desktop, 1440x900, Firefox, Berlin timezone, browser language `de`. Has tracker-blocker on.
- **Referral**: link in a "privacy-first tools of the week" newsletter. Lands on `https://telarchy.com/`.
- **Attention budget**: 10 minutes. Most of it is spent reading legal pages, not the product.
- **Trust level**: neutral-to-positive on the concept but skeptical of compliance. Will bounce on any consent-dark-pattern or missing PII inventory.

## Background

Works adjacent to compliance (e.g. security engineer, DPO-curious, GDPR-aware PM). Knows what a DPA is. Has filed a subject-access request before. Defaults to email signup over SSO because they don't want Google to know about every app they touch.

## Mental model

**They already know**:
- That GDPR requires a specific set of things in a Privacy Policy: PII inventory, purpose, retention, third parties, lawful basis, data subject rights.
- That consent to ToS must be separate and auditable; a preticked box or buried-in-signup consent violates Article 7.
- That "deletion" should be real deletion or clearly documented pseudonymization, not a button that does nothing.
- That encryption-at-rest + encryption-in-transit is table stakes.

**They don't know**:
- Anything about prediction markets; they will read the product brief if it's well-written.
- Whether Telarchy processes data outside the EEA (answer: yes, GCP US-central). They'll want to see this disclosed.

## Success path

Noor reads ToS and Privacy in full, finds them consistent with the live product, signs up with an email alias, exercises the data-export endpoint to confirm it actually returns their data, and keeps the tab open. A soft win is completing the read-through with no trust break; a hard win is signup + successful export.

## Session script

- **T+00:00 — Land on `/`.** Scroll to footer, look for Terms and Privacy links. If absent: major trust break, but Noor is curious enough to keep looking.
- **T+00:15 — Click "Privacy Policy".** Page must render. Check for PII inventory, third-party processors, retention, data-subject rights.
- **T+01:00 — Click "Terms of Service".** Check eligibility age, play-money clause, governing law. A stale `[GOVERNING_LAW]` or `[CONTACT_EMAIL]` placeholder is a blocker.
- **T+02:00 — Check signup flow.** Go to `/signup`. Is there a single required checkbox for ToS + Privacy + age, with inline links? Or are these preticked? Is the consent labeled per Article 7 (clear, specific, affirmative)?
- **T+03:00 — Create account** with `qa+09-<ts>@example.test`. Does the app confirm consent was recorded? (Not required to be user-visible, but the DB must store it.)
- **T+05:00 — Test data export.** Find the setting / endpoint (`GET /api/auth/me/export`). Does it return JSON with the user's actual data? If the export claims "complete" but omits trades/positions/proposals, that's a false statement in the Privacy Policy.
- **T+07:00 — Test data deletion.** Find the `DELETE /api/auth/me` endpoint or UI button. Does it work? Does the Privacy Policy accurately describe what happens (hard delete vs detach)?
- **T+09:00 — Decide.** If Privacy Policy is honest about the partial-deletion state (detach, leaves orphan agent row), Noor respects the transparency. If it claims "full deletion" and the live code does detach, trust breaks.

## Friction triggers

- **Blocker**: Privacy Policy contains unresolved placeholders (`[GOVERNING_LAW]`, `[CONTACT_EMAIL]`, etc.) on the live site. Noor assumes the legal pages are not real.
- **Blocker**: ToS / Privacy pages 404 or render as raw markdown without styling.
- **Blocker**: Consent checkbox is preticked, or consent is a tiny-text click-wrap below the submit button.
- **Blocker**: Privacy Policy lists third parties but omits the hosting provider or the auth provider.
- **High**: Privacy Policy says "we do not use analytics" but page source includes a tracker (check `browser_network_requests`).
- **High**: Retention policy in Privacy Policy is vaguer than what the live code does.
- **High**: `GET /api/auth/me/export` exists but returns a subset of stored data without saying so.
- **High**: Privacy Policy says "data is deleted upon request" but the actual deletion is a detach, undocumented.
- **High**: the footer has "Terms" but no "Privacy", or vice versa.
- **Medium**: governing-law jurisdiction is set to a venue obviously hostile to EU users (e.g. a US state that makes enforcement of EU judgments impractical) without a GDPR-adequacy note.
- **Medium**: no mention of data residency or cross-border transfer (GCP US-central).
- **Low**: ToS says "you" in sentence case but sometimes "You" capitalized; inconsistency is noticed but not disqualifying.

## Conversion criteria

Noor finishes the read-through, signs up, confirms export works, and keeps the account. Soft win: reads the pages and bookmarks the site.

## Bounce criteria

Bounces if any legal page is missing, obviously boilerplate AI-generated slop, or demonstrably inconsistent with live behavior.

## Executor notes

- Live files: `docs/legal/terms-of-service.md`, `docs/legal/privacy-policy.md`, `functions/src/routes/legal.ts` (inlined markdown), `src/pages/LegalPage.tsx`, `src/pages/SignupPage.tsx` (consent checkbox).
- Grep the rendered pages for `[.*_.*]`-style placeholders before running. Any survivor is a blocker.
- Use `browser_network_requests` while logged-in to detect analytics beacons.
- Run `GET /api/auth/me/export` with a fresh account and compare the returned object against the DB schema; every claim in the Privacy Policy under "PII we collect" must map to exported data or be explicitly scoped.
- Re-run after any edit to `functions/src/routes/legal.ts`, `userauth.ts`, or the two markdown files in `docs/legal/`.
