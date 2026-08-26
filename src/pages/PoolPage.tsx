/**
 * A workspace's prize pool for one month (docs/workspace-pools.md): the pool,
 * the period, the board scored on settled outcomes, and the frozen rules.
 * Public, in the floor's frame; the leaderboard for the month, in cash.
 */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageTopBar } from '../components/PageTopBar';
import { api, type PoolBoard, type PoolBoardEntry, type PublicWorkspace } from '../lib/api';
import { floorPath, monthLabel, usd } from '../lib/money';

const EXCLUSION: Record<NonNullable<PoolBoardEntry['exclusion']>, string> = {
  owner_or_admin: 'owns or administers a workspace',
  shared_payout: 'shares payout details with an owner',
  platform_operated: 'operated by Telarchy',
  activity_floor: 'under the activity floor',
  non_positive: 'no profit this month',
};

export function PoolPage() {
  const params = useParams();
  const idOrSlug = params.slug ?? params.workspaceId;
  const month = params.month ?? '';
  const [ws, setWs] = useState<PublicWorkspace | null>(null);
  const [board, setBoard] = useState<PoolBoard | null>(null);
  const [err, setErr] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!idOrSlug || !month) return;
    let cancelled = false;
    api
      .getMarketplaceWorkspace(idOrSlug)
      .then(w => {
        if (cancelled) return;
        setWs(w);
        return api.getWorkspacePool(w.workspaceId, month).then(b => {
          if (!cancelled) setBoard(b);
        });
      })
      .catch(e => {
        console.error('pool fetch failed:', e);
        if (!cancelled) setErr((e as Error).message || 'Could not load this pool');
      });
    return () => {
      cancelled = true;
    };
  }, [idOrSlug, month]);

  // Names come from the workspace's own board, the same source the rail uses.
  useEffect(() => {
    if (!ws) return;
    api
      .getLeaderboard(500, ws.workspaceId)
      .then(r => {
        const map: Record<string, string> = {};
        for (const row of r.participants) if (row.nickname) map[row.id] = row.nickname;
        setNames(map);
      })
      .catch(e => console.error('names fetch failed:', e));
  }, [ws]);

  const back = ws ? floorPath(ws) : `/${params.slug ?? ''}`;
  const rulesHref = ws ? `/legal/pools/${ws.workspaceId}/${month}` : null;

  return (
    <div className="pubws">
      <PageTopBar />
      <main className="pubws-doc poolp">
        <Link className="annp-back" to={back}>
          {ws?.name ?? params.slug ?? 'Back to the market'}
        </Link>
        <h1 className="annp-head">Prize pool, {monthLabel(month)}</h1>
        {err && <p className="adm-err">{err}</p>}
        {board && (
          <>
            <div className="adm-figures">
              <div className="adm-fig">
                <span className="adm-fig-n">{usd(board.totalCents)}</span>
                <span className="adm-fig-l">
                  {board.status === 'settled' ? 'paid out by settled profit' : 'in the pool'}
                </span>
              </div>
              <div className="adm-fig">
                <span className="adm-fig-n">{board.status}</span>
                <span className="adm-fig-l">
                  {board.monthStart.slice(0, 10)} to {board.monthEnd.slice(0, 10)} UTC
                </span>
              </div>
            </div>
            <p className="annp-lead">
              Free to enter. Traders share the pool in proportion to the square of their net settled profit on this
              market's questions this month: only trades made inside the month on questions that resolved inside it,
              never open positions. Owners and admins trade for credits and take no cash.{' '}
              {rulesHref && board.status !== 'scheduled' && (
                <Link className="pubws-inline-link" to={rulesHref}>
                  The rules.
                </Link>
              )}
            </p>
            <section className="adm-block">
              <div className="pubws-lb-head">
                <h2 className="pubws-h2">{board.final ? 'Final board' : 'Board, live'}</h2>
                <span className="pubws-lb-meta">{board.entries.length} traded</span>
              </div>
              {board.entries.length === 0 ? (
                <p className="adm-empty">Nothing has resolved inside this month yet.</p>
              ) : (
                <ol className="adm-list">
                  {board.entries.map(e => (
                    <li className="adm-row" key={e.agentId}>
                      <div className="adm-left">
                        <span className="adm-value">
                          {e.rank ? `${e.rank}. ` : ''}
                          <Link className="pubws-inline-link" to={`/participants/${e.agentId}`}>
                            {names[e.agentId] ?? e.agentId.slice(0, 8)}
                          </Link>
                        </span>
                        <span className="adm-sub">
                          {e.eligible
                            ? `${Math.round(e.share * 100)}% of the pool`
                            : e.exclusion
                              ? EXCLUSION[e.exclusion]
                              : ''}
                        </span>
                      </div>
                      <div className="adm-right">
                        <span className={`adm-mono ${e.score > 0 ? 'is-up' : e.score < 0 ? 'is-down' : ''}`}>
                          {e.score > 0 ? '+' : ''}
                          {e.score.toLocaleString('en-US', { maximumFractionDigits: 0 })} cr
                        </span>
                        <span className="adm-mono">{e.eligible ? usd(e.payoutCents) : ''}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
