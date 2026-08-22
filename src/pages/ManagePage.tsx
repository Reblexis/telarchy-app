import { useEffect, useState, FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { SetupChat } from '../components/SetupChat';
import { useAuth } from '../hooks/useAuth';

/**
 * The owner side's entire surface while Telarchy is trader-first
 * (vision.md, owner decision 2026-08-08): a pitch and a waitlist form.
 * Workspace creation is invite-only until trader demand is proven, so
 * everything that used to funnel into create-workspace points here instead.
 * Reuses the share-link landing's design language (.pubws-*): same poster
 * discipline, one action.
 */
export function ManagePage() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');

  // A platform admin used to be bounced straight to /admin from here, which
  // made the operator door the one page we could not look at as ourselves
  // (2026-08-22). The cockpit gets a link at the bottom instead.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user) { setIsAdmin(false); return; }
    api.getProfile()
      .then((p: { platformAdmin?: boolean }) => setIsAdmin(p.platformAdmin === true))
      .catch(e => console.error('profile check failed:', e));
  }, [user]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      // Already on the list counts as success: the client resolves a 409.
      await api.joinWaitlist({ email });
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="pubws">
      <nav className="pubws-topbar">
        <Link to="/" className="pubws-wordmark">Telarchy</Link>
        <Link to="/login" className="pubws-login">Log in</Link>
      </nav>
      <main className="pubws-main">
        <header className="pubws-hero pubws-hero--door">
          <h1 className="pubws-name">Put your number up</h1>
          <p className="pubws-pitch">
            Name the number you answer to, and anyone can offer a job that moves
            it. The market prices the job before you decide.
          </p>
        </header>

        {/* Otto runs the setup, not a form (owner direction 2026-08-22,
            docs/operator-setup.md). Every field a form could ask for (which
            number, what ceiling, what horizon) is a question Telarchy answers
            better than a stranger on their first minute, and a form cannot
            argue with the answer. He makes the calls himself, as them. */}
        <section className="pubws-act">
          <SetupChat signedIn={!!user} />
        </section>

        {/* The human door stays: it is how the first operator arrived, and
            some people would rather write to a person. Set as one more row of
            the transcript rather than a second call to action, because a cream
            CTA beside Otto was the louder of two doors and the wrong one. */}
        <section className="pubws-act setup">
          {done ? (
            <div className="setup-turn">
              <span className="setup-who">Sent</span>
              <p className="setup-said setup-said--you">We will write back.</p>
            </div>
          ) : (
            <form className="setup-turn" onSubmit={handleSubmit}>
              <label className="setup-who" htmlFor="manage-email">Or</label>
              <span className="setup-line">
                <input
                  id="manage-email"
                  className="setup-input"
                  type="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="Write to a person instead: you@company.com"
                  aria-label="Your email, to be written back to"
                />
                <button className="setup-send" type="submit" disabled={submitting} aria-label="Send your email">
                  {submitting ? '·' : '↑'}
                </button>
              </span>
            </form>
          )}
          {error && <p className="setup-note">{error}</p>}
        </section>

        <footer className="pubws-foot">
          Just want to trade? <Link to="/">The live markets are open</Link>.
          {isAdmin && <> · <Link to="/admin">Platform admin</Link></>}
        </footer>
      </main>
    </div>
  );
}
