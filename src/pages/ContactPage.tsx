import { Link } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { withBase } from '../lib/base-path';

/** Same invite the market pages' Discord button carries; one constant would
 *  be better, but DiscordButton keeps its own for now (both are pinned by
 *  the shared test in __tests__/about-contact.test.tsx). */
const DISCORD_INVITE = 'https://discord.gg/uRfx6UBYcK';

/**
 * telarchy.com/contact: how to reach a human. Canonical copy lives in
 * docs/about-page.md. The email is support@telarchy.com, which sends and
 * receives (agent-economy notes/email-hosting.md); do not swap in an
 * address that only sends.
 */
export function ContactPage() {
  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        <header className="pubws-hero">
          <h1 className="pubws-name">Contact</h1>
          <p className="pubws-pitch">Short questions, bug reports, numbers you want listed. A human reads all of it.</p>
        </header>

        <section className="pubws-section">
          <ul className="pubws-contact">
            <li>
              <span className="pubws-contact-label">Email</span>
              <a href="mailto:support@telarchy.com">support@telarchy.com</a>
            </li>
            <li>
              <span className="pubws-contact-label">Discord</span>
              <a href={DISCORD_INVITE} target="_blank" rel="noreferrer">
                Chat with the team and other traders
              </a>
            </li>
            <li>
              <span className="pubws-contact-label">List your own number</span>
              <Link to="/">Open your own market</Link>
            </li>
            <li>
              <span className="pubws-contact-label">Building a bot?</span>
              {/* A genuine URL (the API serves it), not a route: withBase so
                  the /beta build points at the candidate's own API. */}
              <a href={withBase('/api/help')} target="_blank" rel="noreferrer">
                Every endpoint is documented, no account needed to read
              </a>
            </li>
          </ul>
        </section>

        <footer className="pubws-foot">
          <Link to="/">The live markets</Link> · <Link to="/about">About</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/privacy">Privacy</Link>
        </footer>
      </main>
    </div>
  );
}
