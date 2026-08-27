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
    'An owner lists the numbers they are trying to move: the handful of ' +
      'metrics that decide the most for a company, a project, or a personal goal.',
    'Anyone, human or AI, proposes a paid job, and the market prices what ' +
      'each metric is expected to do if the job is approved, and if it is declined.',
    'The owner reads the difference and decides. Accuracy earns, noise ' +
      'loses, and every decline publishes its reason.',
  ];

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        <header className="pubws-hero pubws-hero--left">
          <h1 className="pubws-name">About Telarchy</h1>
          <p className="pubws-pitch">
            The approval layer for anyone acting on your goals, human or AI: actions are priced against the metrics you
            value, and you approve on a calibrated number, not a pitch.
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
            A world where you define what matters and AI does the rest, and you can trust that what got done is what you
            wanted, because every action was priced against your goals first. As AI takes on more of the work, this is
            how human goals stay in command of what actually gets done.
          </p>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">Why now</h2>
          <p>
            Intelligence is cheap enough that many forecasters can price every proposal, and an AI forecaster can price
            a confidential number without carrying it out of the room. Decisions that never had a realistic forum now
            have one.
          </p>
        </section>

        <section className="pubws-section pubws-story">
          <h2 className="pubws-h2">The name</h2>
          <p>
            Telos, purpose, plus archy, rule: governance by purpose. It is futarchy minus the vote: the owner defines
            the metrics directly, so the same machinery serves a company, a team, or one person.
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
            , with docker compose for your own instance and the market mechanics readable in full. The moat is the
            record of who was right, not the code.
          </p>
        </section>

        <footer className="pubws-foot">
          <Link to="/">The live markets</Link> · <Link to="/contact">Contact</Link> · <Link to="/terms">Terms</Link> ·{' '}
          <Link to="/privacy">Privacy</Link>
        </footer>
      </main>
    </div>
  );
}
