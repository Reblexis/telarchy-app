import { Link } from 'react-router-dom';
import { useEarnAvailable } from '../hooks/useEarnAvailable';

export function formatCreditCount(value: number): string {
  return value >= 10_000
    ? `${Math.round(value / 1000).toLocaleString('en-US')}k`
    : Math.round(value).toLocaleString('en-US');
}

/** Current funds and the next earning opportunity are distinct lines of one link. */
export function CreditsBalanceLink({ balance, accountId }: { balance: number; accountId?: string }) {
  const available = useEarnAvailable(true, accountId);
  const hint = available === null ? 'Get credits' : `Earn +${formatCreditCount(available)}`;
  const label = `${Math.round(balance).toLocaleString('en-US')} credits. ${available === null ? 'Get credits' : `Earn ${Math.round(available).toLocaleString('en-US')} more credits`}`;
  return (
    <Link className="acctmenu-credits" to="/earn" aria-label={label} title={label}>
      <span className="acctmenu-balance">{formatCreditCount(balance)} cr</span>
      <span className={`acctmenu-earn${available === null ? '' : ' has-reward'}`}>
        {hint}
        <svg
          width="9"
          height="9"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M2 10 10 2M3 2h7v7" />
        </svg>
      </span>
    </Link>
  );
}
