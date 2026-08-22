import { useEffect, useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
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
  const navigate = useNavigate();
  const [email, setEmail] = useState('');

  // /manage is the owner door: the waitlist pitch for strangers, the
  // cockpit for platform admins (trader-first flip, 2026-08-08). It used to
  // send them to /overview, which the console took with it when it was
  // deleted, so the owner was bounced to the floor instead; /admin is the
  // surface that exists (2026-08-19).
  useEffect(() => {
    if (!user) return;
    api.getProfile()
      .then((p: { platformAdmin?: boolean }) => {
        if (p.platformAdmin === true) navigate('/admin', { replace: true });
      })
      .catch(e => console.error('profile check failed:', e));
  }, [user, navigate]);
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
        <header className="pubws-hero">
          <h1 className="pubws-name">Run your own workspace</h1>
          <p className="pubws-pitch">Your metrics. Your proposals. A market prices every move before you make it.</p>
        </header>

        <section className="pubws-act">
          {done ? (
            <p className="pubws-pitch">You&rsquo;re on the list. We open workspaces one at a time and you&rsquo;ll hear from us directly.</p>
          ) : (
            <form className="pubws-waitform" onSubmit={handleSubmit}>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                aria-label="Email"
              />
              <button className="pubws-cta" type="submit" disabled={submitting}>
                {submitting ? 'Joining…' : 'Join the waitlist'}
              </button>
            </form>
          )}
          <p className="pubws-fineprint">
            Workspaces are invite-only while we grow the trader side. Waitlist first, invited in order.
          </p>
        </section>

        <footer className="pubws-foot">
          Just want to trade? <Link to="/marketplace">The live markets are open</Link>.
        </footer>
      </main>
    </div>
  );
}
