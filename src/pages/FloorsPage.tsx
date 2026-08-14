import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { TopBar, settleDayOf } from './TradePage';

/**
 * The floor selection at /marketplace (owner direction 2026-08-14,
 * redesigned from scratch; see docs/ui-conventions.md "the marketplace is
 * two doors"). Not a directory: a lobby with one door per floor. Each door
 * carries the floor's own headline grammar (metric in Fraunces, live
 * number in big accent mono, one mono line saying when it settles) and
 * nothing else.
 *
 * Nothing here reaches the old console UI, for anyone, admin included.
 */

interface Door {
  workspaceId: string;
  slug: string | null;
  name: string;
  metricName: string | null;
  value: number | null;
  unit: string;
  /** "settles 31 August 2026", from the market's own resolve date. */
  settles: string | null;
}

function currencyOf(metricName: string): string {
  const tail = metricName.match(/\(([^)]*)\)\s*$/)?.[1] ?? '';
  return /\busd\b|\$/i.test(tail) ? '$' : '';
}

function fmtValue(v: number, unit: string): string {
  const decimals = Math.abs(v) >= 100 ? 0 : 1;
  return unit + v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/* The settle day comes from the floor's own settleDayOf (imported): one
   wording for the same fact on both surfaces, "31 August 2026". */

export function FloorsPage() {
  const { user, loading: authLoading } = useAuth();
  const [doors, setDoors] = useState<Door[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    api.getPublicWorkspaces()
      .then(list => {
        if (cancelled || !Array.isArray(list)) return;
        const base: Door[] = list.map(w => ({
          workspaceId: w.workspaceId,
          slug: w.slug ?? null,
          name: w.name,
          metricName: null,
          value: null,
          unit: '',
          settles: null,
        }));
        setDoors(base);
        // Each door fills in its own number as it arrives, so the lobby
        // never waits on the slowest floor.
        base.forEach(door => {
          api.getMarketplaceWorkspace(door.slug || door.workspaceId)
            .then((ws: { markets?: Array<{ metricName: string; consensus: number | null; targetDate?: string }> }) => {
              if (cancelled) return;
              const m = ws.markets?.[0];
              if (!m) return;
              setDoors(cur => (cur ?? []).map(d => d.workspaceId === door.workspaceId
                ? {
                    ...d,
                    metricName: m.metricName.replace(/\s*\(.*\)\s*$/, ''),
                    value: m.consensus,
                    unit: currencyOf(m.metricName),
                    settles: m.targetDate ? settleDayOf(m.targetDate) : null,
                  }
                : d));
            })
            .catch(e => console.error('floor fetch failed:', e));
        });
      })
      .catch(e => console.error('public workspaces fetch failed:', e));
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="pubws">
      <TopBar user={!!user} ready={!authLoading} />
      <main className="lobby">
        <h1 className="lobby-head">Pick a floor</h1>
        <p className="lobby-lead">
          One number, run in the open. Bet on where it lands, or propose a job
          and get paid if the owner approves.
        </p>

        {doors === null ? null : doors.length === 0 ? (
          <p className="lobby-empty">No public floors right now.</p>
        ) : (
          <div className="lobby-doors">
            {doors.map(d => (
              <Link
                key={d.workspaceId}
                className="lobby-door"
                to={`/${d.slug || `marketplace/${d.workspaceId}`}`}
              >
                <span className="lobby-door-name">{d.name}</span>
                {d.value !== null && (
                  <span className="lobby-door-value">{fmtValue(d.value, d.unit)}</span>
                )}
                {d.metricName && <span className="lobby-door-metric">{d.metricName}</span>}
                {d.settles && <span className="lobby-door-settles">settles {d.settles}</span>}
              </Link>
            ))}
          </div>
        )}

        <p className="lobby-own">
          Want a floor for your own numbers? <Link to="/manage">Get set up</Link>
        </p>
      </main>
    </div>
  );
}
