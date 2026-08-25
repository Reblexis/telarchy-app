import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { SetupChat } from '../components/SetupChat';
import { useAuth } from '../hooks/useAuth';
import { api } from '../lib/api';

/**
 * The operator door: Otto, and nothing else.
 *
 * It was a waitlist form, then a conversation with an email box under it as a
 * fallback. The box is gone (owner, 2026-08-24: "remove this whole thing"),
 * and the page is better for it: an offer to talk to a person instead sits
 * under a thing that IS a person answering, and reads as an admission that
 * the thing above it does not work. Anyone who wants a human still has
 * /contact in the footer of every page.
 */
export function ManagePage() {
  const { user, loading } = useAuth();

  // A platform admin used to be bounced straight to /admin from here, which
  // made the operator door the one page we could not look at as ourselves
  // (2026-08-22). The cockpit gets a link at the bottom instead.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!user) {
      setIsAdmin(false);
      return;
    }
    api
      .getProfile()
      .then((p: { platformAdmin?: boolean }) => setIsAdmin(p.platformAdmin === true))
      .catch(e => console.error('profile check failed:', e));
  }, [user]);

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-main">
        {/* Otto runs the setup, not a form (owner direction 2026-08-22,
            the operator-door design note). Every field a form could ask for (which
            number, what ceiling, what horizon) is a question Telarchy answers
            better than a stranger on their first minute, and a form cannot
            argue with the answer. He makes the calls himself, as them. */}
        <section className="pubws-act pubws-act--door">
          <SetupChat signedIn={loading ? null : !!user} />
        </section>

        <footer className="pubws-foot">
          Just want to trade? <Link to="/">The live markets are open</Link>.
          {isAdmin && (
            <>
              {' '}
              · <Link to="/admin">Platform admin</Link>
            </>
          )}
        </footer>
      </main>
    </div>
  );
}
