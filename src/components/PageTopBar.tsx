import { Link } from 'react-router-dom';
import { Logo } from './Logo';
import { TopBarAuth } from './TopBarAuth';

/**
 * The top bar every page that is not a market wears.
 *
 * One component because "the same in every place" is a property that decays
 * the moment it is five copies (owner, 2026-08-24: "telarchy logo should
 * always be in the same place, same goes for account settings, make sure it
 * is consistent on every page"). It had already decayed: the market page's
 * bar is full-bleed with a 3rem lockup, and the door, About, Contact and the
 * legal pages each hand-rolled a 660px centred bar with a 2.1rem one, so the
 * mark moved and changed size depending on where you were standing.
 *
 * The market page keeps its own bar, because it carries controls these pages
 * do not, but both now sit on the same geometry: the mark in the viewport's
 * top-left corner, the account in the top-right.
 */
export function PageTopBar() {
  return (
    <nav className="pubws-topbar">
      <Link to="/" className="pubws-logolink" aria-label="Telarchy">
        <Logo variant="lockup" height="3rem" />
      </Link>
      <TopBarAuth />
    </nav>
  );
}
