/**
 * Join Discord (owner ask 2026-08-11): a transparent Discord glyph in the
 * top bar that expands to "Join Discord" on hover/focus and opens the
 * invite in a new tab. Icon-only at rest so it stays quiet beside the
 * account area; the label slides in so the affordance is legible.
 */

const DISCORD_INVITE = 'https://discord.gg/uRfx6UBYcK';

export function DiscordButton() {
  return (
    <a
      className="pubws-discord"
      href={DISCORD_INVITE}
      target="_blank"
      rel="noreferrer noopener"
      aria-label="Join our Discord"
    >
      <svg className="pubws-discord-icon" viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
        <path
          fill="currentColor"
          d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.211.375-.454.88-.622 1.28a18.27 18.27 0 0 0-5.53 0A12.6 12.6 0 0 0 9.11 3a19.7 19.7 0 0 0-4.435 1.37C1.87 8.59 1.11 12.7 1.49 16.75a19.9 19.9 0 0 0 6.06 3.08c.49-.67.926-1.383 1.302-2.132-.716-.27-1.4-.603-2.045-.99.171-.126.34-.257.502-.392a14.2 14.2 0 0 0 12.18 0c.164.14.332.27.502.392-.647.389-1.332.722-2.047.99.376.75.812 1.462 1.302 2.132a19.85 19.85 0 0 0 6.062-3.08c.447-4.7-.766-8.775-3.19-12.38ZM8.02 14.26c-1.183 0-2.157-1.086-2.157-2.42s.955-2.42 2.157-2.42c1.21 0 2.176 1.095 2.157 2.42 0 1.334-.955 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.086-2.157-2.42s.955-2.42 2.157-2.42c1.21 0 2.176 1.095 2.157 2.42 0 1.334-.946 2.42-2.157 2.42Z"
        />
      </svg>
      <span className="pubws-discord-label">Join Discord</span>
    </a>
  );
}
