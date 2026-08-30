import { Link } from 'react-router-dom';
import { useEarnAvailable } from '../hooks/useEarnAvailable';

/**
 * The top bar's one door to the earn page (owner ask 2026-08-30).
 *
 * Renders NOTHING when this account has nothing left to earn, which is
 * the whole discipline of it: a permanent "Earn credits" button is
 * furniture, while a button that appears because there is money on the
 * table and disappears once it is taken is information.
 */
export function EarnDoor() {
  const available = useEarnAvailable(true);
  if (available === null) return null;
  return (
    <Link className="earndoor" to="/earn" title="Credits you have not claimed yet">
      Earn credits <span className="earndoor-n">+{Math.round(available).toLocaleString('en-US')}</span>
    </Link>
  );
}
