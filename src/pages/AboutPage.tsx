import { Link } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';

/**
 * telarchy.com/about: what this site is, said once, for the cold visitor who
 * wants the story rather than a market. Canonical copy lives in
 * docs/about-page.md; revising it means editing both in the same commit.
 *
 * Revised 2026-08-22 (Viktor, approved on the design canvas): left-aligned,
 * shorter, and framed around the handful of metrics that decide the most,
 * never "one number" (owner: "one number is deceiving"). The vision sits
 * after the mechanism, not in the hero, per go-to-market.md: the vision is
 * the why-it-matters layer; lead with the wedge.
 */
export function AboutPage() {
  const steps = [
    'You list the metrics that matter, for a company, a project, or something personal.',
    'Someone proposes a paid job. For each metric, a market prices where it lands if the ' +
      'job is approved and where it lands if it is declined.',
    'You read the gap and decide. Right forecasts earn, wrong ones lose, and a decline ' + 'comes with its reason.',
  ];

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        <header className="pubws-hero pubws-hero--left">
          <h1 className="pubws-name">About Telarchy</h1>
          <p className="pubws-pitch">
            A market prices what a proposed action would do to your numbers, and you approve or decline on that price.
            The proposer can be a person or a bot.
          </p>
        </header>

        <section className="pubws-section">
          <h2 className="pubws-h2">How it works</h2>
          <ol className="pubws-steps">
            {steps.map((s, i) => (
              <li key={i}>
                <span className="pubws-step-n">{i + 1}</span>
                <p>{s}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">The vision</h2>
          <p>
            You define what matters and AI does the rest, and you can trust that what got done is what you wanted,
            because every action was priced against your goals first.
          </p>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">Why now</h2>
          <p>
            Forecasting got cheap: many AI forecasters can price every proposal. And an AI forecaster can price a
            confidential number without leaking it.
          </p>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">The name</h2>
          <p>
            Telos, purpose, plus archy, rule. Futarchy minus the vote: the owner defines the metrics directly, so the
            same machinery serves a company, a team, or one person.
          </p>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">Who builds it</h2>
          <p>
            Telarchy is built by Viktor Cihal. LookPilot, his previous company, runs its numbers in the open here today.
            Questions, bugs, and numbers you want listed: <Link to="/contact">contact</Link>.
          </p>

          <h2 className="pubws-h2">The code</h2>
          <p>
            Telarchy is open source (AGPL-3.0): the same code that serves this site is at{' '}
            <a href="https://github.com/Reblexis/telarchy-app?ref=about" rel="noopener">
              github.com/Reblexis/telarchy-app
            </a>
            , with docker compose for your own instance.
          </p>
        </section>

        {/* /about explained the thing and then stopped, leaving a convinced
            reader nowhere to go (design audit, 2026-08-30). The two doors are
            the two sides of the market, in the page's own plain register. */}
        <p className="pubws-aud-cta">
          <Link to="/" className="pubws-cta pubws-cta--small">
            See the live markets
          </Link>
          <Link to="/" className="pubws-aud-link">
            List your own numbers
          </Link>
        </p>

        <footer className="pubws-foot">
          <Link to="/">The live markets</Link> · <Link to="/contact">Contact</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/privacy">Privacy</Link>
        </footer>
      </main>
    </div>
  );
}
