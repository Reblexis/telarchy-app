import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { authPath } from '../lib/nextPath';

/**
 * The corner of a standalone page's top bar.
 *
 * Every one of these pages rendered "Log in" unconditionally, so a signed-in
 * visitor was told they were signed out on the operator door, About, Contact
 * and the legal pages (owner, 2026-08-24: "why when i click it i get signed
 * out? im signed in in telarchy.com/beta but suddenly not in the manage
 * site?"). Nothing was actually wrong with their session; the page simply
 * never asked.
 *
 * The market page's own bar has always got this right, including the part
 * that is easy to miss: nothing renders until the session check SETTLES,
 * because `user` is null while it is pending and a signed-in visitor would
 * otherwise watch "Log in" flash and vanish on every page load.
 */
export function TopBarAuth() {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <span className="pubws-login" aria-hidden="true" />;
  if (!user) {
    return (
      <Link to={authPath('login', location)} className="pubws-login pubws-fade">
        Log in
      </Link>
    );
  }
  // Signed in: the account lives on the market page, behind its own dialog.
  return (
    <Link to="/account" className="pubws-login pubws-fade">
      Account
    </Link>
  );
}
