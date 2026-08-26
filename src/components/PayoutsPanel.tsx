/**
 * What Telarchy owes this participant from workspace prize pools
 * (docs/workspace-pools.md). Renders nothing until there is something to
 * say; the money tab is about payment details first.
 */

import { useEffect, useState } from 'react';
import { api, type PayoutSummary } from '../lib/api';
import { usd } from '../lib/money';

export function PayoutsPanel({ hasPayoutMethod }: { hasPayoutMethod: boolean }) {
  const [summary, setSummary] = useState<PayoutSummary | null>(null);
  useEffect(() => {
    api
      .getMyPayouts()
      .then(setSummary)
      .catch(e => console.error('payouts fetch failed:', e));
  }, []);
  if (!summary || (summary.accruedCents === 0 && summary.paidCents === 0)) return null;
  return (
    <section className="acctdlg-payouts">
      <p className="acctdlg-hint">
        <strong>{usd(summary.accruedCents)}</strong> earned from prize pools, not yet transferred
        {summary.paidCents > 0 ? `; ${usd(summary.paidCents)} paid so far` : ''}.{' '}
        {summary.payable
          ? 'A transfer is due within 30 days.'
          : summary.accruedCents > 0 && !hasPayoutMethod
            ? 'Save payment details above and it will be transferred.'
            : summary.accruedCents > 0
              ? `Transferred once it reaches ${usd(summary.minPayoutCents)}; nothing is lost while it waits.`
              : ''}
      </p>
    </section>
  );
}
