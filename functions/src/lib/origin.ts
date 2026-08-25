/**
 * Instance identity, from the environment, with the managed instance's values
 * as defaults so telarchy.com behaves exactly as before anything is set.
 *
 * A self-hosted instance sets these three and is visibly its own: share cards
 * and notification links point at it, mail comes from its domain, and its
 * privacy page names its contact. Contract: docs/vision.md ("Self-hosting")
 * and .env.example.
 */

/** Public origin for links in mail, share meta and handoff text. */
export function publicOrigin(): string {
  return (
    process.env.PUBLIC_ORIGIN?.trim().replace(/\/+$/, '') ||
    process.env.BETTER_AUTH_URL?.trim().replace(/\/+$/, '') ||
    'https://telarchy.com'
  );
}

/** The From header for outbound mail; the domain must be verified at the mail provider. */
export function mailFrom(): string {
  return process.env.MAIL_FROM?.trim() || 'Telarchy <floor@telarchy.com>';
}

/** The address named in the privacy policy and terms as the data-protection contact. */
export function privacyContact(): string {
  return process.env.PRIVACY_CONTACT?.trim() || 'viktor.cihal@gmail.com';
}
